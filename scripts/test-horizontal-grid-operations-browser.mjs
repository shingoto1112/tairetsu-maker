import { chromium,expect } from '@playwright/test';
import assert from 'node:assert/strict';
import { readFile,writeFile } from 'node:fs/promises';
const origin='http://127.0.0.1:5193',browser=await chromium.launch({headless:true}),checks=[];
const base=JSON.parse(await readFile('src/repositories/contract/fixtures/commitProjects.json','utf8')).stage;
const save=async page=>{await page.locator('.toolbar-save-button').click();await expect(page.locator('.toolbar-save-button')).not.toHaveClass(/is-dirty/);};
const read=async(page,id)=>page.evaluate(async id=>{const {IndexedDbProjectRepository}=await import('/src/repositories/indexedDbRepository.ts');const r=new IndexedDbProjectRepository();const p=(await r.get(id)).project;r.close();return p;},id);
try{
 for(const mode of ['stage','parade'])for(const counting of ['meters','centerSplit']){
  const context=await browser.newContext({viewport:{width:1376,height:1032}});await context.route('**/*',r=>{const u=new URL(r.request().url());return u.origin===origin||['data:','blob:'].includes(u.protocol)?r.continue():r.abort();});const page=await context.newPage();
  await page.goto(origin);await expect(page.locator('.library-shell')).toBeVisible();
  const p={...structuredClone(base),id:'grid-ops',title:'配置入口試験',mode,guideSettings:{snapGuideEnabled:false,snapToGuideEnabled:false},stage:{...base.stage,widthMeters:10.3,depthMeters:8,gridSizeMeters:1,horizontalGuideMode:counting},
   paradeSettings:{width:10.3,totalDistance:12,cellSizeMeters:1,direction:'up',rulerPosition:'both',horizontalMeasureMode:counting==='meters'?'normalMeter':'centerSplit',emphasizeEvery5m:true,emphasizeEvery10m:true},
   members:[{id:'m0',name:'甲',color:'#0d8b78'},{id:'m1',name:'乙',color:'#0d8b78'},{id:'m2',name:'丙',color:'#0d8b78'}],stageObjects:[],frames:[{id:'s0',label:'入口',timeSec:0,positions:{m0:{x:.15,y:4},m1:{x:9.7,y:4},m2:{x:5.4,y:4}},objectStates:{},memberVisibility:{},sceneViewState:{zoom:.1,scrollLeft:0,scrollTop:0}}]};
  await page.evaluate(async p=>{const {IndexedDbProjectRepository}=await import('/src/repositories/indexedDbRepository.ts');const r=new IndexedDbProjectRepository();await r.initialize();await r.commit({project:p,localRevision:'1',expectedRepositoryRevision:null,operationId:'ops'});r.close();},p);
  await page.reload();await page.getByRole('button',{name:p.title+'を開く',exact:true}).click();await expect(page.locator('.toolbar')).toBeVisible();const notice=page.getByRole('button',{name:'お知らせを閉じる',exact:true});if(await notice.count())await notice.click();
  if(mode==='stage')await page.getByRole('button',{name:'ステージを全体表示に戻す',exact:true}).click();
  const selector=mode==='stage'?'.member-token':'.parade-member',surface=page.locator(mode==='stage'?'.stage-surface':'.parade-stage');const a=page.locator(selector).filter({hasText:'甲'}),b=page.locator(selector).filter({hasText:'乙'}),c=page.locator(selector).filter({hasText:'丙'});
  await a.click();await b.click({modifiers:['Control']});await expect(a).toHaveClass(/is-selected/);await expect(b).toHaveClass(/is-selected/);
  const box=await a.boundingBox(),area=await surface.boundingBox();const x=box.x+box.width/2,y=box.y+box.height/2;
  await page.mouse.move(x,y);await page.mouse.down();await page.mouse.move(x+area.width/10.3*2,y,{steps:8});const preview=await a.boundingBox();await page.mouse.up();await save(page);
  const moved=(await read(page,p.id)).frames[0].positions,after=await a.boundingBox();assert.ok(Math.abs(preview.x-after.x)<1.1,'group preview/commit');assert.ok(Math.abs((moved.m1.x-moved.m0.x)-9.55)<1e-9,'relative spacing at edge');assert.ok(moved.m0.x>=0&&moved.m1.x<=10.3);
  const expected=counting==='meters'?.15:.65;assert.ok(Math.abs(moved.m0.x-expected)<1e-9,JSON.stringify({mode,counting,moved}));
  await page.locator('body').click({position:{x:2,y:2}});await page.keyboard.press('ControlOrMeta+Z');await save(page);assert.deepEqual((await read(page,p.id)).frames[0].positions,p.frames[0].positions,'group Undo exact');checks.push(mode+' '+counting+' group common-bound snap + exact spacing + preview + Undo');
  await page.locator('.group-spacing input').fill('0.37');await page.locator('.group-spacing input').blur();
  await page.getByRole('button',{name:'横1列',exact:true}).click();await save(page);
  const aligned=(await read(page,p.id)).frames[0].positions;
  assert.ok(Math.abs(aligned.m0.x-4.74)<1e-9&&Math.abs(aligned.m1.x-5.11)<1e-9,'template spacing remains .37 without grid resnap');
  await page.locator('body').click({position:{x:2,y:2}});await page.keyboard.press('ControlOrMeta+Z');await save(page);
  await c.click({modifiers:['Control']});await page.locator('.formation-tools__advanced summary').click();
  await page.getByRole('button',{name:'横均等',exact:true}).click();await save(page);
  const distributed=(await read(page,p.id)).frames[0].positions;
  assert.ok(Math.abs(distributed.m2.x-4.925)<1e-9,'equal distribution keeps existing arithmetic midpoint');
  assert.equal(distributed.m0.x,.15);assert.equal(distributed.m1.x,9.7);
  await page.locator('body').click({position:{x:2,y:2}});await page.keyboard.press('ControlOrMeta+Z');await save(page);await page.keyboard.press('Escape');
  checks.push(mode+' '+counting+' template .37 spacing + arithmetic distribution unchanged');
  await c.click();await page.getByRole('tab',{name:'詳細',exact:true}).click();const xInput=page.locator('.detail-edit-field').filter({hasText:mode==='parade'&&counting==='centerSplit'?'横位置（センター割り）':'x（中心基準）'}).locator('input');await expect(xInput).toBeVisible();await xInput.fill('0.37');await xInput.blur();await save(page);assert.ok(Math.abs((await read(page,p.id)).frames[0].positions.m2.x-5.52)<1e-9,'numeric input stays off-grid');checks.push(mode+' '+counting+' numeric input no resnap');
  await page.getByRole('tab',{name:'メンバー',exact:true}).click();await page.getByRole('button',{name:'コピー',exact:true}).first().click();
  const area2=await surface.boundingBox();await page.mouse.move(area2.x+area2.width*.63,area2.y+area2.height*.5);await page.getByRole('button',{name:'貼り付け',exact:true}).first().click();await save(page);const pasted=await read(page,p.id);const pasteId=pasted.members.find(m=>!p.members.some(before=>before.id===m.id)).id;const latest=pasted.frames[0].positions[pasteId];const originX=5.15+(counting==='centerSplit'?.5:0);assert.ok(Math.abs((latest.x-originX)-Math.round(latest.x-originX))<.001,'paste new origin');checks.push(mode+' '+counting+' paste destination grid');
  await page.getByRole('button',{name:'メンバー',exact:true}).first().click();await save(page);const added=await read(page,p.id);const id=added.members.find(m=>!pasted.members.some(before=>before.id===m.id)).id;const addedX=added.frames[0].positions[id].x;assert.ok(Math.abs((addedX-originX)-Math.round(addedX-originX))<.001,'new member origin');checks.push(mode+' '+counting+' new member');
  if(mode==='stage'){
   await page.getByRole('button',{name:'視点',exact:true}).click();
   const points=await page.evaluate(()=>{const labels=[...document.querySelectorAll('.meter-ruler--horizontal span')],lines=[...document.querySelectorAll('.stage-grid-line--vertical')];return labels.map(l=>{const b=l.getBoundingClientRect();const x=b.left+b.width/2;return Math.min(...lines.map(line=>{const r=line.getBoundingClientRect();return Math.abs(r.left+r.width/2-x);}));});});assert.ok(points.every(distance=>distance<1.1),'performer labels and reflected grid');checks.push(counting+' performer ruler and grid');
  }
  await page.getByRole('button',{name:'隊列一覧へ戻る',exact:true}).click();await page.reload();await page.getByRole('button',{name:p.title+'を開く',exact:true}).click();assert.deepEqual((await read(page,p.id)).frames[0].positions,added.frames[0].positions,'reload coordinates unchanged');
  await context.close();
 }
 console.log('GRID_OPERATIONS PASS '+JSON.stringify(checks));
 await writeFile('C:/Users/shing/AppData/Local/Temp/claude/c--Users-shing-OneDrive--------ChatGPT-------/e5aa9c38-eb07-490c-ac06-62f047c4c161/scratchpad/shots-grid/operations-results.json',JSON.stringify(checks,null,2));
}finally{await browser.close();}

