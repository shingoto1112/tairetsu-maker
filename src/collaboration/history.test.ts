import { describe, it, expect } from "vitest";
import * as Y from "yjs";
import fixture from "../repositories/contract/fixtures/collaboration.json";
import projects from "../repositories/contract/fixtures/commitProjects.json";
import type { Project } from "../types";
import type { CollaborationData } from "../repositories/types";
import { validateCollaboration, validateCollaborationTransition } from "../repositories/collaborationData";
import { SaveCoordinator } from "../storage/saveCoordinator";
import { MemoryProjectRepository } from "../repositories/contract/testing/MemoryProjectRepository";
import { compactCollaboration, appendCollaboration, decodeUpdate, encodeUpdate } from "./persistence";
import { prepareWriter, reclaimSent, mergeWriterOutbox } from "./writer";
import { createCheckpointDTO, checkpointFromConfirmedDocument, validateCheckpointDTO, canonicalCheckpointContent } from "./checkpoint";
import { createSharedDocument } from "./model";
// @ts-ignore Node-only test oracle; never imported by the app.
import { MockCollabBackend, actors, memberships, documentId } from "../../scripts/testing/mock-collab-server.mjs";
import { RpcError, createHandler } from "../../supabase/functions/collab-ingest/handler";

const bound = (): CollaborationData => validateCollaboration({ ...fixture.initial, transportBinding: { accountId: actors[0], membershipGeneration: memberships[0] } });
const delta = (id: string) => ({ updateId: id, bytes: fixture.updates[0].bytes, source: "local" as const });
describe("9a writer collection", () => {
  it("never validates a truncated server replay as the complete head", async () => {
    const backend=new MockCollabBackend(fixture.initial.base,RpcError), rpc=backend.rpc;
    let appends=0;
    backend.rpc=async(name: string,args: Record<string,unknown>)=>{
      if(name==='collab_v2_ingest_state')return {...backend.page('0',32),headSeq:'2',updates:[{seq:'1',bytes:fixture.updates[0].bytes}]};
      if(name==='collab_v2_append')appends++;
      return rpc(name,args);
    };
    const handler=createHandler(backend,[]),response=await handler(new Request('http://test.invalid',{method:'POST',headers:{Authorization:`Bearer ${actors[0]}`,'Content-Type':'application/json'},
      body:JSON.stringify({action:'append',documentId,generation:'1',membershipGeneration:memberships[0],updateId:'partial-head',bytes:fixture.updates[0].bytes})}));
    expect(response.status).toBe(400);expect(await response.json()).toEqual({error:'INCOMPLETE_SERVER_STATE'});expect(appends).toBe(0);
  });
  it("continues beyond 4096 ACKs, with constant sent/receipt bytes and no TTL", async () => {
    let data = prepareWriter(bound()).data;
    const backend = new MockCollabBackend(data.base, RpcError);
    const confirm = (ack: string) => backend.rpc("collab_v2_confirm_writer", { p_document: documentId, p_actor: actors[0], p_generation: "1", p_membership: memberships[0], p_writer: data.writer!.id, p_ack_through: ack });
    await confirm("0");
    for (let n = 1; n <= 4100; n++) {
      const edited = appendCollaboration(data, [delta(`update-${n}`)]), assigned = prepareWriter(edited).data;
      const entry = assigned.outbox[0], bytes = decodeUpdate(entry.bytes);
      const hash = [...new Uint8Array(await crypto.subtle.digest("SHA-256", new Uint8Array(bytes).buffer))].map(b => b.toString(16).padStart(2,"0")).join("");
      const hex = [...bytes].map(b => b.toString(16).padStart(2,"0")).join("");
      await backend.rpc("collab_v2_append", { p_document: documentId, p_actor: actors[0], p_generation:"1", p_membership:memberships[0], p_expected_head: backend.head,
        p_writer:data.writer!.id, p_writer_seq:entry.writerSeq, p_update_id:entry.updateId, p_bytes:`\\x${hex}`, p_digest:`\\x${hash}` });
      const next = reclaimSent(compactCollaboration({ ...assigned, outbox: [{ ...entry, status:"sent" }] }, true));
      validateCollaborationTransition(assigned, next);
      data = validateCollaboration(next); await confirm(data.writer!.ackThrough);
      expect(data.outbox.length).toBe(0); expect(backend.receipts.size).toBe(0);
    }
    expect(data.writer!.allocatedThrough).toBe("4100"); expect(data.writer!.reclaimedThrough).toBe("4100"); expect(backend.head).toBe("4100");
    // The real Edge returns the dedicated result BEFORE current-state replay.
    const ingest = createHandler(backend, []), result = await ingest(new Request("http://test.invalid", { method:"POST", headers:{Authorization:`Bearer ${actors[0]}`,"Content-Type":"application/json"},
      body:JSON.stringify({action:"append",documentId,generation:"1",membershipGeneration:memberships[0],writerId:data.writer!.id,writerSeq:"1",updateId:"update-1",bytes:fixture.updates[0].bytes}) }));
    expect(await result.json()).toMatchObject({result:"RECEIPT_RECLAIMED",reclaimedThrough:"4100"}); expect(backend.head).toBe("4100");
  }, 30000);
  it("never advances the ACK across a gap; transition rejects rollback, mutation and reintroduced sent", () => {
    const initial = prepareWriter(compactCollaboration(appendCollaboration(bound(), [delta("one"),delta("two")]), true)).data;
    const hole = { ...initial, outbox: initial.outbox.map((e,i) => ({...e,status:i ? "sent" as const : "pending" as const})) };
    expect(reclaimSent(hole).writer!.ackThrough).toBe("0");
    const collected = reclaimSent({...initial,outbox:initial.outbox.map(e=>({...e,status:"sent"}))});
    validateCollaborationTransition(initial,collected);
    expect(()=>validateCollaborationTransition(collected,initial)).toThrow();
    expect(()=>validateCollaboration({...collected,outbox:[{...initial.outbox[0],status:"sent"}]})).toThrow();
    expect(()=>mergeWriterOutbox(collected,initial)).toThrow();
    const staleSent = {...initial,outbox:initial.outbox.map(e=>({...e,status:"sent" as const}))};
    expect(mergeWriterOutbox(collected,staleSent).outbox).toEqual([]);
  });
  it("CAS allocates one immutable writer and distinct contiguous sequences in two tabs", async () => {
    const repo = new MemoryProjectRepository(); await repo.initialize();
    await repo.commit({project:projects.stage as Project,collaboration:bound(),localRevision:"1",expectedRepositoryRevision:null,operationId:"seed"});
    const a = new SaveCoordinator(repo,()=>{}), b = new SaveCoordinator(repo,()=>{});
    a.activate((await repo.get("project_a"))!); b.activate((await repo.get("project_a"))!);
    await a.editCollaboration([delta("a")]); await b.editCollaboration([delta("b")]);
    expect(await a.flush()).toBe(true); expect(await b.flush()).toBe(true);
    expect(await a.prepareCollaborationWriter()).toBe(true); expect(await b.prepareCollaborationWriter()).toBe(true);
    const saved = (await repo.get("project_a"))!.collaboration!;
    expect(saved.outbox.map(e=>e.writerSeq).sort()).toEqual(["1","2"]);
    expect(saved.writer!.allocatedThrough).toBe("2");
    // Upgrade adoption changes only uncommitted writer identity; both read the CAS winner.
    expect(a.collaborationProjection!.writer!.id).toBe(saved.writer!.id);
    expect(b.collaborationProjection!.writer!.id).toBe(saved.writer!.id);
  });
  it("retires old sent bytes once, retains a bounded tombstone, and holds old executable/backups", () => {
    const old = compactCollaboration(appendCollaboration(bound(),[delta("legacy")]),true);
    old.outbox[0].status="sent";
    const migrated = prepareWriter(old).data;
    expect(migrated.outbox).toEqual([]); expect(migrated.writer!.legacySentIds).toEqual(["legacy"]);
    validateCollaborationTransition(old,migrated);
    expect(()=>mergeWriterOutbox(migrated,old)).toThrow();
    expect(()=>validateCollaborationTransition({...migrated,recoveryRequired:true},{...migrated})).toThrow();
  });
});

describe("9a checkpoint content DTO", () => {
  const metadata = {documentId,generation:"1",confirmedSeq:"0",sharedSchemaVersion:2 as const,reason:"manual" as const,serverAt:"2026-10-04T00:00:00.000Z",requestedBy:actors[0],automatic:false};
  it("includes the common song and closed shared content; excludes audio IDs, auth, device view and local extensions", async () => {
    const project = {...projects.stage, audio:{id:"private-audio-id",name:"曲.wav",type:"audio/wav",size:100},focusMemberId:"m_001",viewerPerspective:"performer",transportBinding:{accountId:"secret"},
      frames:(projects.stage as Project).frames.map(f=>({...f,sceneViewState:{zoom:5},privateExtension:"secret"}))} as unknown as Project;
    const doc=createSharedDocument(project);
    try {
      const dto=await checkpointFromConfirmedDocument(doc,metadata), text=JSON.stringify(dto);
      expect(dto.song).toEqual({name:"曲.wav",type:"audio/wav",size:100});
      for(const forbidden of ["private-audio-id","transportBinding","focusMemberId","viewerPerspective","sceneViewState","privateExtension","accessToken","outbox"]) expect(text).not.toContain(forbidden);
      expect(await validateCheckpointDTO(dto)).toEqual(dto);
      const again=await checkpointFromConfirmedDocument(doc,{...metadata,confirmedSeq:"1",reason:"automatic",requestedBy:null,automatic:true});
      expect(again.digest).toBe(dto.digest);
      expect(canonicalCheckpointContent(again)).toEqual(canonicalCheckpointContent(dto));
    } finally {doc.destroy();}
  });
  it("generates only the exact contiguous confirmed cut and validates digest/version/closed fields", async () => {
    const dto=await createCheckpointDTO({uptoSeq:"0",bytes:decodeUpdate(fixture.initial.base)},[],metadata);
    await expect(validateCheckpointDTO({...dto,deviceAudio:"leak"})).rejects.toThrow();
    await expect(validateCheckpointDTO({...dto,formatVersion:2})).rejects.toThrow();
    await expect(validateCheckpointDTO({...dto,digest:"0".repeat(64)})).rejects.toThrow("CHECKPOINT_DIGEST_MISMATCH");
    const leaked=structuredClone(dto);leaked.content.roots.settings.accessToken="not-a-shared-field";
    leaked.digest=[...new Uint8Array(await crypto.subtle.digest('SHA-256',new Uint8Array(canonicalCheckpointContent(leaked)).buffer))].map(b=>b.toString(16).padStart(2,'0')).join('');
    await expect(validateCheckpointDTO(leaked)).rejects.toThrow(); // even with a matching digest
    await expect(createCheckpointDTO({uptoSeq:"0",bytes:decodeUpdate(fixture.initial.base)},[],{...metadata,confirmedSeq:"1"})).rejects.toThrow();
    await expect(createCheckpointDTO({uptoSeq:"0",bytes:decodeUpdate(fixture.initial.base)},[{seq:"2",bytes:decodeUpdate(fixture.updates[0].bytes)}],{...metadata,confirmedSeq:"2"})).rejects.toThrow();
    await expect(createCheckpointDTO({uptoSeq:"0",bytes:decodeUpdate(fixture.initial.base)},[{seq:"1",bytes:decodeUpdate(fixture.updates[0].bytes)}],{...metadata,confirmedSeq:"1"})).resolves.toMatchObject({confirmedSeq:"1"});
  });
  it("reads legacy coordinate schema without inventing fields or song", async () => {
    const doc=new Y.Doc();doc.getMap("metadata").set("schemaVersion",1);doc.getMap("metadata").set("projectId","legacy");doc.getMap("members").set("m",new Y.Map());
    const scene=new Y.Map(), positions=new Y.Map();scene.set("positions",positions);doc.getMap("scenes").set("s",scene);positions.set("m",{x:0,y:0});
    try { expect(await createCheckpointDTO({uptoSeq:"0",bytes:Y.encodeStateAsUpdate(doc)},[],{...metadata,sharedSchemaVersion:1})).toMatchObject({sharedSchemaVersion:1,song:null}); }
    finally {doc.destroy();}
  });
});
