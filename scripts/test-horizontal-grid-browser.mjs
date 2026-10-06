import { chromium, expect } from '@playwright/test';
import assert from 'node:assert/strict';
import { mkdir,writeFile } from 'node:fs/promises';
import path from 'node:path';
const origin='http://127.0.0.1:5193';
const out='C:/Users/shing/AppData/Local/Temp/claude/c--Users-shing-OneDrive--------ChatGPT-------/e5aa9c38-eb07-490c-ac06-62f047c4c161/scratchpad/shots-grid';
const browser=await chromium.launch({headless:true}),errors=[],results=[];
const sizes=process.argv.includes('--mobile-detail-only')?[[390,844]]:[[744,1133],[1032,1376],[1376,1032],[390,844]];
await mkdir(out,{recursive:true});
const fixture=(mode,counting,width,step,id)=>{
 const center=width/2;
 const xs=counting==='meters'?[-3,-2,-1,0,1,2,3]:[-3.5,-2.5,-1.5,-.5,.5,1.5,2.5,3.5];
 return {id,version:1,title:id,updatedAt:'2026-10-06T00:00:00Z',mode,stage:{widthMeters:width,depthMeters:8,gridSizeMeters:step,showGrid:true,showCenterLine:true,showStageLabels:true,audienceSide:'bottom',horizontalGuideMode:counting,memberDiameterMeters:.5},
 paradeSettings:{width,totalDistance:12,cellSizeMeters:step,direction:'up',rulerPosition:'both',horizontalMeasureMode:counting==='meters'?'normalMeter':'centerSplit',emphasizeEvery5m:true,emphasizeEvery10m:true},
 guideSettings:{snapGuideEnabled:false,snapToGuideEnabled:false},members:xs.map((x,i)=>({id:'m'+i,name:'人'+i,color:'#0d8b78'})),stageObjects:[],
 frames:[{id:'s0',timeSec:0,label:'シーン1',positions:Object.fromEntries(xs.map((x,i)=>['m'+i,{x:center+x,y:mode==='stage'?4:6}])),objectStates:{},sceneViewState:{zoom:1,scrollTop:0,scrollLeft:0}}]};
};
const open=async(page,title)=>{await page.getByRole('button',{name:title+'を開く',exact:true}).click();await expect(page.locator('.toolbar')).toBeVisible();const close=page.getByRole('button',{name:'お知らせを閉じる',exact:true});if(await close.count())await close.click();};
const back=async(page)=>{await page.getByRole('button',{name:'隊列一覧へ戻る',exact:true}).click();await expect(page.locator('.library-shell')).toBeVisible();};
const record=async(page,id)=>page.evaluate(async id=>{const {IndexedDbProjectRepository}=await import('/src/repositories/indexedDbRepository.ts');const r=new IndexedDbProjectRepository();const p=(await r.get(id)).project;r.close();return p;},id);
const save=async page=>{await page.locator('.toolbar-save-button').click();await expect(page.locator('.toolbar-save-button')).not.toHaveClass(/is-dirty/);};
try {
 for(const [width,height] of sizes){
  const context=await browser.newContext({viewport:{width,height}});await context.route('**/*',r=>{const u=new URL(r.request().url());return u.origin===origin||['data:','blob:'].includes(u.protocol)?r.continue():r.abort();});
  const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));
  await page.goto(origin);await expect(page.locator('.library-shell')).toBeVisible();
  const docs=[];for(const mode of ['stage','parade'])for(const counting of ['meters','centerSplit'])for(const w of [12,13])for(const step of [.5,1])docs.push(fixture(mode,counting,w,step,`${mode}-${counting}-w${w}-g${step}`));
  await page.evaluate(async docs=>{const {IndexedDbProjectRepository}=await import('/src/repositories/indexedDbRepository.ts');const r=new IndexedDbProjectRepository();await r.initialize();for(const project of docs)await r.commit({project,localRevision:'1',expectedRepositoryRevision:null,operationId:project.id});r.close();},docs);
  await page.reload();await expect(page.locator('.library-shell')).toBeVisible();
  for(const p of docs){
   await open(page,p.title);
   const ruler=page.locator(p.mode==='stage'?'.meter-ruler--horizontal':'.parade-horizontal-ruler').first();await expect(ruler).toBeVisible();
   const surface=page.locator(p.mode==='stage'?'.stage-surface':'.parade-stage').first();
   const geom=await page.evaluate(mode=>{
    const rule=document.querySelector(mode==='stage'?'.meter-ruler--horizontal':'.parade-horizontal-ruler');
    const area=document.querySelector(mode==='stage'?'.stage-surface':'.parade-stage');
    const lines=[...area.querySelectorAll(mode==='stage'?'.stage-grid-line--vertical':'.parade-grid-line--vertical')];
    return [...rule.querySelectorAll('span')].map(label=>{const r=label.getBoundingClientRect(),x=r.left+r.width/2;return {label:label.textContent,x,closest:Math.min(...lines.map(line=>{const b=line.getBoundingClientRect();return Math.abs(b.left+b.width/2-x);})),edge:Math.min(Math.abs(area.getBoundingClientRect().left-x),Math.abs(area.getBoundingClientRect().right-x))};});
   },p.mode);
   assert.ok(geom.every(g=>g.closest<1.2||g.edge<2),JSON.stringify({p:p.id,geom}));
   const name=`grid-${p.id}-${width}x${height}`;await page.screenshot({path:path.join(out,name+'.png')});
   if(width===390&&p.mode==='parade'){
    await page.getByRole('button',{name:'全画面',exact:true}).click();
    await page.locator('.parade-viewport').evaluate(el=>{el.scrollLeft=(el.scrollWidth-el.clientWidth)/2;});
    await page.screenshot({path:path.join(out,name+'-fullscreen-center.png')});
    await page.getByRole('button',{name:'解除',exact:true}).click();
   }

   // Crop and enlarge the ruler and upper grid, without altering the app or its zoom.
   const box=await ruler.boundingBox();if(box&&box.y>=0&&box.x>=0){const clip={x:Math.max(0,box.x),y:Math.max(0,box.y),width:Math.min(box.width,width-box.x),height:Math.min(160,height-box.y)};if(clip.width>0&&clip.height>0)await page.screenshot({path:path.join(out,name+'-ruler.png'),clip,scale:'css'});}
   if(width===1376&&p.stage.widthMeters===13&&p.stage.gridSizeMeters===1){
    const token=page.locator(p.mode==='stage'?'.member-token':'.parade-member').filter({hasText:'人2'}).first();await expect(token).toBeVisible();
    const box=await token.boundingBox(),area=await surface.boundingBox();assert.ok(box&&area);
    const x=box.x+box.width/2,y=box.y+box.height/2;const dx=area.width/13*.63;
    await page.mouse.move(x,y);await page.mouse.down();await page.mouse.move(x+dx,y,{steps:6});
    const preview=await token.boundingBox();await page.mouse.up();await save(page);
    const committed=await token.boundingBox();assert.ok(Math.abs((preview.x+preview.width/2)-(committed.x+committed.width/2))<1.1,'preview/commit');
    const changed=await record(page,p.id);const expected=await page.evaluate(({x,mode})=>import('/src/utils/horizontalGrid.ts').then(m=>m.snapHorizontalPositionInBounds(x,1,m.horizontalGridOriginMeters(13,mode),0,13)),{x:p.frames[0].positions.m2.x+.63,mode:p.stage.horizontalGuideMode});
    assert.ok(Math.abs(changed.frames[0].positions.m2.x-expected)<.001,JSON.stringify({p:p.id,actual:changed.frames[0].positions.m2,expected}));
    await page.locator('body').click({position:{x:2,y:2}});await page.keyboard.press('ControlOrMeta+Z');await save(page);assert.deepEqual((await record(page,p.id)).frames[0].positions,p.frames[0].positions,'Undo restores exact original');
    await token.click();await page.keyboard.press('Shift+ArrowRight');await save(page);assert.ok(Math.abs((await record(page,p.id)).frames[0].positions.m2.x-p.frames[0].positions.m2.x-1)<.001,'Shift relative step');
    await page.keyboard.press('ArrowLeft');await save(page);assert.ok(Math.abs((await record(page,p.id)).frames[0].positions.m2.x-p.frames[0].positions.m2.x-.75)<.001,'Arrow .25 relative');
    await page.getByRole('tab',{name:'ステージ',exact:true}).click();const radios=page.getByRole('group',{name:'横の数え方'}).getByRole('radio');const before=(await record(page,p.id)).frames[0].positions;await radios.nth(p.stage.horizontalGuideMode==='meters'?1:0).check();await save(page);assert.deepEqual((await record(page,p.id)).frames[0].positions,before,'mode switch coordinates');
    const zip=await page.evaluate(async id=>{const {IndexedDbProjectRepository}=await import('/src/repositories/indexedDbRepository.ts');const {createTairetsuArchive,readTairetsuArchive}=await import('/src/utils/tairetsuFile.ts');const r=new IndexedDbProjectRepository(),p=(await r.get(id)).project;r.close();const archive=await createTairetsuArchive(p);const loaded=await readTairetsuArchive(new File([archive],'grid.zip'));return {before:p.frames.map(f=>f.positions),after:loaded.project.frames.map(f=>f.positions)};},p.id);assert.deepEqual(zip.after,zip.before,'ZIP coordinate roundtrip');
   }
   results.push({id:p.id,width,height,geometry:geom});await back(page);
  }
  // Real exported mobile PNG and PDF at each viewport, both modes/counting choices.
  for(const mode of ['stage','parade'])for(const counting of ['meters','centerSplit']){
   const p=fixture(mode,counting,13,.5,'export');const exports=await page.evaluate(async p=>{const {generateFormationExport}=await import('/src/utils/formationExport.tsx');const outputs=[];for(const format of ['png','pdf']){const result=await generateFormationExport({title:'数字と線',exportedAt:'2026-10-06T00:00:00Z',scopeLabel:'現在',project:p},{target:'formation',scope:'current',purpose:'mobile',format},{signal:new AbortController().signal,onProgress:()=>{}});const file=result.files[0];const data=await new Promise(resolve=>{const r=new FileReader();r.onload=()=>resolve(r.result.split(',')[1]);r.readAsDataURL(file);});outputs.push({format,data,bytes:file.size,pageCount:result.pageCount});}return outputs;},p);
   for(const item of exports){assert.ok(item.bytes>1000);await writeFile(path.join(out,`grid-export-${mode}-${counting}-${width}x${height}.${item.format}`),Buffer.from(item.data,'base64'));}
  }
  await context.close();
 }
 assert.deepEqual(errors,[]);await writeFile(path.join(out,process.argv.includes('--mobile-detail-only')?'grid-mobile-results.json':'grid-results.json'),JSON.stringify(results,null,2));console.log('GRID_BROWSER PASS '+results.length+' editor configurations; real exports and applicable drag/preview/Undo/keyboard/mode/ZIP flows; '+out);
}finally{await browser.close();}

