import { describe, expect, it, vi } from "vitest";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { createSampleProject } from "../sampleProject";
import { migrateLegacyStorage } from "./migrationCoordinator";
import { MemoryMigrationRepository } from "./testing/MemoryMigrationRepository";

describe("retired legacy storage boundary", () => {
  it("migrates valid items beside a corrupt item without changing either old source", async () => {
    const sample=createSampleProject();
    const project={...sample,id:"legacy-anonymous",focusMemberId:sample.members[0].id};
    const raw=JSON.stringify([project,{broken:true}]);
    const local={getItem:(key:string)=>key==="stageflow.projects.v1"?raw:null,setItem:vi.fn(),removeItem:vi.fn()};
    const text=new Map([["projects/projects.json",JSON.stringify({format:"tairetsu-projects-v1",projects:[project],savedAt:"2026-01-01T00:00:00.000Z"})]]);
    const native={readText:vi.fn(async (key:string)=>text.get(key)??null),draftNames:vi.fn(async()=>[]),writeFile:vi.fn(),deleteFile:vi.fn()};
    const repository=new MemoryMigrationRepository();
    const result=await migrateLegacyStorage({repository,readers:{local:()=>local,native,includeDrafts:false}});
    expect(result.canContinue).toBe(true);
    expect((await repository.get(project.id))?.project.focusMemberId).toBe(project.focusMemberId);
    expect(result.recoveryCount).toBeGreaterThan(0);
    expect(local.setItem).not.toHaveBeenCalled();expect(local.removeItem).not.toHaveBeenCalled();
    expect(native.writeFile).not.toHaveBeenCalled();expect(native.deleteFile).not.toHaveBeenCalled();
    expect(local.getItem("stageflow.projects.v1")).toBe(raw);
  });
  it("does not expose or reference the obsolete write APIs in application source", () => {
    const root=path.resolve("src");
    const scan=(dir:string):string[]=>readdirSync(dir,{withFileTypes:true}).flatMap(entry=>{
      const file=path.join(dir,entry.name);
      return entry.isDirectory()?scan(file):/\.tsx?$/.test(file)&&!file.includes(".test.")?[file]:[];
    });
    const obsolete=/\b(saveProjectsToStorage|saveProjectToStorage|hydrateProjectsFromNativeStorage|saveNativeProjectsMirror|writeNativeProjectsMirror)\b/;
    for(const file of scan(root)) expect(readFileSync(file,"utf8"),path.relative(root,file)).not.toMatch(obsolete);
    expect(existsSync(path.join(root,"utils/storage.ts"))).toBe(false);
    expect(existsSync(path.join(root,"platform/projectStorage.ts"))).toBe(false);
  });
});
