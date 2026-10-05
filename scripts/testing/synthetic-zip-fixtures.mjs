// Generated anonymous stage/parade files, never reads a user's Downloads or audio.
export async function syntheticZipFixtures(page) {
  const files = await page.evaluate(async () => {
    const { default: fixtures } = await import('/src/repositories/contract/fixtures/projects.json');
    const { default: commits } = await import('/src/repositories/contract/fixtures/commitProjects.json');
    const { normalizeProjectWithContext } = await import('/src/project/normalizeProject.ts');
    const { createTairetsuArchive } = await import('/src/utils/tairetsuFile.ts');
    const result=[];
    for (const mode of ['stage','parade']) {
      // Reuse the repository suite's anonymous 146-member / 18-scene fixture.
      const project=normalizeProjectWithContext(structuredClone(fixtures.large),{defaultStage:commits.stage.stage,now:()=> '2026-01-10T00:00:00.000Z',createId:p=>`${p}-synthetic`,createProjectId:()=>`synthetic-${mode}`});
      project.id=`synthetic-${mode}`;project.title=`検証${mode}`;project.mode=mode;project.audio=null;
      if(mode==='parade')project.paradeSettings={totalDistance:120,backwardDistanceMeters:5,width:18,cellSizeMeters:.5,direction:'up',rulerPosition:'both',horizontalMeasureMode:'normalMeter',emphasizeEvery5m:true,emphasizeEvery10m:true};
      project.frames=project.frames.map((f,index)=>({...f,label:`シーン${index+1}`,sceneViewState:{zoom:1,scrollTop:0,scrollLeft:0},...(mode==='parade'?{positions:Object.fromEntries(project.members.map((m,i)=>[m.id,{x:1+i%15,y:10+Math.floor(i/15)*2}]))}:{})}));
      const zip=await createTairetsuArchive(project);
      result.push({name:`synthetic-${mode}.zip`,bytes:[...new Uint8Array(await zip.arrayBuffer())]});
    }
    return result;
  });
  return files.map(({name,bytes})=>({name,mimeType:'application/zip',buffer:Buffer.from(bytes)}));
}
