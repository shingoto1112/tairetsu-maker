import JSZip from "jszip";
import { expect, it } from "vitest";
import { formationExportFixture } from "./formationExportFixture";
import { normalizeProject } from "../project/normalizeProject";
import { readTairetsuArchive } from "./tairetsuFile";
for(const variant of ['missing','meters','centerSplit','alias','legacyFlag'] as const) {
  it('old ZIP and normalization preserve coordinates: '+variant,async()=>{
    const project=formationExportFixture();
    if(variant==='meters'||variant==='centerSplit') project.stage.horizontalGuideMode=variant;
    if(variant==='alias') project.stage.horizontalDisplayMode='centerSplit';
    if(variant==='legacyFlag') Object.assign(project.stage,{coneGuideEnabled:true});
    const before=structuredClone(project.frames.map(f=>f.positions));
    const normalized=normalizeProject(project);
    expect(normalized.stage.horizontalGuideMode).toBe(['alias','legacyFlag','centerSplit'].includes(variant)?'centerSplit':'meters');
    expect(normalized.frames.map(f=>f.positions)).toEqual(before);
    const zip=new JSZip();zip.file('manifest.json',JSON.stringify({fileType:'tairetsu-project',formatVersion:1,includesAudio:false}));zip.file('project.json',JSON.stringify(project));
    const file=new File([await zip.generateAsync({type:'arraybuffer'})],'old.tairetsu',{type:'application/octet-stream'});
    const imported=normalizeProject((await readTairetsuArchive(file)).project);
    expect(imported.stage.horizontalGuideMode).toBe(normalized.stage.horizontalGuideMode);expect(imported.frames.map(f=>f.positions)).toEqual(before);
  });
}
