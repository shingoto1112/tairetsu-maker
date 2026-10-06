import { describe, expect, it } from "vitest";
import * as Y from "yjs";
import fixtures from "../repositories/contract/fixtures/emphasisProjects.json";
import old from "../repositories/contract/fixtures/commitProjects.json";
import type { Project } from "../types";
import { normalizeProject } from "../project/normalizeProject";
import { validateProjectStructure, serializeProject, decodeProjectJson } from "../project/codec";
import { createSharedDocument, joinSharedDocument, getModel } from "./model";
import { projectSharedDocument } from "./projection";
import { CollaborationCommands } from "./commands";
import { validateState } from "./serverValidation";
import { assertFullState as oldValidation } from "../../scripts/testing/fixtures/preEmphasisServerSchema2";
import { buildMaintenanceOutput } from "./maintenance";
import { checkpointFromConfirmedDocument } from "./checkpoint";
import { buildRestoreOutput } from "./restore";
import { createCollaborationData, validateCollaborationProject } from "./persistence";
import { planRecipe } from "./recipeCommands";
const documentId="dddddddd-dddd-4ddd-8ddd-dddddddddddd", snapshotId="eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",actor="11111111-1111-4111-8111-111111111111";
const cut=(doc:Y.Doc)=>({documentId,generation:"1",cutSeq:"0",documentSchema:2 as const,snapshot:{id:snapshotId,uptoSeq:"0",bytes:Y.encodeStateAsUpdate(doc)},updates:[]});
describe("emphasis persistence and schema 2 compatibility",()=>{
  it("legacy missing flags default OFF and existing parade defaults/false stay intact",()=>{
    const a=normalizeProject(old.stage as Project),b=normalizeProject(old.parade as Project);
    for(const [key,value] of Object.entries(a.stage))if(key.startsWith("emphasize"))expect(value).toBe(false);
    expect(b.paradeSettings?.emphasizeHorizontalNumbers).toBe(false);
    expect(b.paradeSettings?.emphasizeEvery5m).toBe(old.parade.paradeSettings.emphasizeEvery5m);
    expect(normalizeProject({...old.parade,paradeSettings:{...old.parade.paradeSettings,emphasizeEvery5m:false,emphasizeEvery10m:false}} as Project).paradeSettings).toMatchObject({emphasizeEvery5m:false,emphasizeEvery10m:false});
  });
  it.each(["stage","parade"] as const)("retains %s settings on codec/join/receive/Undo/Redo/compact/restore; old validator rejects",async mode=>{
    const p=normalizeProject(fixtures[mode] as Project),encoded=serializeProject(p);expect(encoded.ok).toBe(true);if(!encoded.ok)throw encoded.error;
    expect(decodeProjectJson(encoded.value)).toMatchObject({ok:true,value:p});
    const doc=createSharedDocument(p),peer=joinSharedDocument(Y.encodeStateAsUpdate(doc)),commands=new CollaborationCommands(doc);
    try{
      expect(()=>validateState(Y.encodeStateAsUpdate(doc))).not.toThrow();
      expect(()=>oldValidation(doc)).toThrow("INVALID_UPDATE");
      const dto=await checkpointFromConfirmedDocument(doc,{documentId,generation:"1",confirmedSeq:"0",sharedSchemaVersion:2,reason:"manual",serverAt:"2026-10-06T00:00:00Z",requestedBy:actor,automatic:false});
      const before=projectSharedDocument(doc,p);
      commands.applyRecipe(before,{...before,stage:{...before.stage,emphasizeHorizontalNumbers:false}});
      Y.applyUpdate(peer,Y.encodeStateAsUpdate(doc));expect(projectSharedDocument(peer,p).stage.emphasizeHorizontalNumbers).toBe(false);
      commands.undo();expect(projectSharedDocument(doc,p).stage.emphasizeHorizontalNumbers).toBe(true);
      commands.redo();expect(projectSharedDocument(doc,p).stage.emphasizeHorizontalNumbers).toBe(false);
      const output=await buildMaintenanceOutput(cut(doc),"compact",actor,"2026-10-06T00:00:00Z");
      const compacted=joinSharedDocument(output.bytes);expect(projectSharedDocument(compacted,p)).toEqual(projectSharedDocument(doc,p));compacted.destroy();
      const restored=await buildRestoreOutput(cut(doc),dto);Y.applyUpdate(doc,restored.update);expect(projectSharedDocument(doc,p).stage).toEqual(p.stage);
      expect(()=>validateState(Y.encodeStateAsUpdate(doc))).not.toThrow();
      getModel(doc).settings.set("stage.emphasizeHorizontalNumbers",{"stage.emphasizeHorizontalNumbers":"true"});expect(()=>validateState(Y.encodeStateAsUpdate(doc))).toThrow();
    } finally {commands.destroy();doc.destroy();peer.destroy();}
  });
  it("normalization does not fan out OFF atoms; toggled field alone becomes a write",()=>{
    const raw=old.parade as Project,doc=createSharedDocument(raw),after=normalizeProject(raw);
    const writes=planRecipe(doc,raw,after);
    expect(writes.filter(w=>w.target.field.includes("emphasize"))).toEqual([]);
    const changed={...after,stage:{...after.stage,emphasizeHorizontalNumbers:true}};
    expect(planRecipe(doc,after,changed).map(w=>w.target.field)).toEqual(["stage.emphasizeHorizontalNumbers"]);doc.destroy();
  });
  it("normalized OFF defaults project and save legacy documents without new atoms",()=>{
    for(const mode of ["stage","parade"] as const){
      const raw=old[mode] as Project,base=normalizeProject(raw),doc=createSharedDocument(raw);
      const seeded=createSharedDocument(base);
      expect([...getModel(seeded).settings.keys()].filter(k=>k.includes("emphasizeHorizontal")||k.includes("emphasizeVertical"))).toEqual([]);
      expect(projectSharedDocument(seeded,base)).toEqual(base);seeded.destroy();
      const bytes=Y.encodeStateAsUpdate(doc),projected=projectSharedDocument(doc,base);
      expect(projected).toEqual(base);
      expect(()=>validateCollaborationProject(createCollaborationData(doc),projected)).not.toThrow();
      expect(Y.encodeStateAsUpdate(doc)).toEqual(bytes);
      const stale={...base,stage:{...base.stage,emphasizeHorizontalNumbers:true}};
      expect(projectSharedDocument(doc,stale).stage.emphasizeHorizontalNumbers).toBe(false);
      doc.destroy();
    }
  });
  it("codec rejects malformed emphasis booleans",()=>{
    expect(validateProjectStructure({...old.stage,stage:{...old.stage.stage,emphasizeHorizontalEvery5:1}}).ok).toBe(false);
  });
});
