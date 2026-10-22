import { chromium, expect } from '@playwright/test';
import assert from 'node:assert/strict';
import { mkdir,writeFile,readFile } from 'node:fs/promises';
import path from 'node:path';
const origin=process.env.REPOSITORY_TEST_ORIGIN??'http://127.0.0.1:5196';
const out='C:/Users/shing/AppData/Local/Temp/claude/c--Users-shing-OneDrive--------ChatGPT-------/e5aa9c38-eb07-490c-ac06-62f047c4c161/scratchpad/shots-emphasis';
await mkdir(out,{recursive:true});
const browser=await chromium.launch({headless:true}),errors=[],results=[];
const h=['emphasizeHorizontalNumbers','emphasizeHorizontalEvery5','emphasizeHorizontalEvery10'];
const v=['emphasizeVerticalNumbers','emphasizeVerticalEvery5m','emphasizeVerticalEvery10m'];
const fixture=(mode,counting,bits)=>{
 const flags=Object.fromEntries([...h,...v].map((x,i)=>[x,Boolean(bits&(1<<(i%3)))]));
 const id=`${mode}-${counting}-${bits}`;
 return {id,version:1,title:id,updatedAt:'2026-10-06T00:00:00Z',mode,
 stage:{widthMeters:23.5,depthMeters:12.5,gridSizeMeters:.5,showGrid:true,showCenterLine:true,showStageLabels:true,audienceSide:'bottom',frontDirection:'bottom',horizontalGuideMode:counting,...flags},
 paradeSettings:mode==='parade'?{width:23.5,totalDistance:23.5,backwardDistanceMeters:12,cellSizeMeters:.5,direction:'up',rulerPosition:'both',horizontalMeasureMode:counting==='meters'?'normalMeter':'centerSplit',...Object.fromEntries(h.map(x=>[x,flags[x]])),emphasizeVerticalNumbers:flags.emphasizeVerticalNumbers,emphasizeEvery5m:flags.emphasizeVerticalEvery5m,emphasizeEvery10m:flags.emphasizeVerticalEvery10m}:undefined,
 members:[{id:'m0',name:'確認',color:'#0d8b78'}],stageObjects:[],frames:[{id:'s0',label:'シーン1',timeSec:0,positions:{m0:{x:10.5,y:6}},objectStates:{},sceneViewState:{zoom:.5,scrollTop:0,scrollLeft:0}}]};
};
const read=(page,id)=>page.evaluate(async id=>{const {IndexedDbProjectRepository}=await import('/src/repositories/indexedDbRepository.ts');const r=new IndexedDbProjectRepository();const p=(await r.get(id)).project;r.close();return p;},id);
const open=async(page,p)=>{await page.getByRole('button',{name:p.title+'を開く',exact:true}).click();await expect(page.locator('.toolbar')).toBeVisible();const notice=page.getByRole('button',{name:'お知らせを閉じる',exact:true});if(await notice.count())await notice.click();};
const back=async page=>{await page.getByRole('button',{name:'隊列一覧へ戻る',exact:true}).click();await expect(page.locator('.library-shell')).toBeVisible();};
try {
 for(const [width,height] of [[744,1133],[1032,1376],[1376,1032],[390,844]].filter(s=>process.argv.length<=2||process.argv.slice(2).includes(s.join('x')))){
  const context=await browser.newContext({viewport:{width,height}});await context.route('**/*',r=>{const u=new URL(r.request().url());return u.origin===origin||['data:','blob:'].includes(u.protocol)?r.continue():r.abort();});
  const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));await page.goto(origin);await expect(page.locator('.library-shell')).toBeVisible();
  const docs=[];for(const mode of ['stage','parade'])for(const counting of ['meters','centerSplit'])for(let bits=0;bits<8;bits++)docs.push(fixture(mode,counting,bits));
  await page.evaluate(async docs=>{const {IndexedDbProjectRepository}=await import('/src/repositories/indexedDbRepository.ts');const r=new IndexedDbProjectRepository();await r.initialize();for(const project of docs)await r.commit({project,localRevision:'1',expectedRepositoryRevision:null,operationId:project.id});r.close();},docs);await page.reload();
  for(const p of docs){
   await open(page,p);const prefix=`${p.id}-${width}x${height}`;
   const lines=await page.locator(p.mode==='stage'?'.stage-grid-line--vertical':'.parade-grid-line--vertical').evaluateAll(elements=>elements.map(el=>({position:Number(el.dataset.position),emphasis:el.dataset.emphasis,color:getComputedStyle(el).backgroundColor,width:parseFloat(getComputedStyle(el).width)})));
   for(const line of lines){const d=Math.abs(line.position-23.5/2),n=d+(p.stage.horizontalGuideMode==='centerSplit'?.5:0);const number=Math.abs(n-Math.round(n))<1e-7&&d>1e-7;const expected=number&&p.stage.emphasizeHorizontalEvery10&&Math.round(n)%10===0?'10':number&&p.stage.emphasizeHorizontalEvery5&&Math.round(n)%5===0?'5':number&&p.stage.emphasizeHorizontalNumbers?'number':'none';assert.equal(line.emphasis,expected);assert.ok(Math.abs(line.width-(expected==='10'?1.5:expected==='5'?1.25:1))<.02,JSON.stringify(line));}
   assert.ok(lines.length>20);await page.screenshot({path:path.join(out,prefix+'.png')});
   if(p.id.endsWith('-7')){
    await page.getByRole('tab',{name:'ステージ',exact:true}).click();await expect(page.locator('.settings-disclosure')).toHaveAttribute('open','');
    await expect(page.getByRole('checkbox',{name:'目盛りの数字の線を濃くする',exact:true})).toBeChecked();
    await page.getByText(p.mode==='stage'?'縦の目盛り（前後）':'縦の目盛り（距離）',{exact:true}).scrollIntoViewIfNeeded();await page.screenshot({path:path.join(out,prefix+'-settings.png')});
    for(const [index,group] of (await page.locator('.grid-emphasis-settings fieldset').all()).entries()){
     await group.getByRole('checkbox').first().scrollIntoViewIfNeeded();await page.screenshot({path:path.join(out,prefix+'-settings-group'+index+'-start.png')});
     await group.getByRole('checkbox').last().scrollIntoViewIfNeeded();await page.screenshot({path:path.join(out,prefix+'-settings-group'+index+'-end.png')});
    }
    const old=(await read(page,p.id)).frames[0].positions;
    await page.getByRole('checkbox',{name:'目盛りの数字の線を濃くする',exact:true}).uncheck();await page.locator('.toolbar-save-button').click();await expect(page.locator('.toolbar-save-button')).not.toHaveClass(/is-dirty/);
    const zip=await page.evaluate(async id=>{const {IndexedDbProjectRepository}=await import('/src/repositories/indexedDbRepository.ts');const {createTairetsuArchive,readTairetsuArchive}=await import('/src/utils/tairetsuFile.ts');const r=new IndexedDbProjectRepository(),p=(await r.get(id)).project;r.close();const file=await createTairetsuArchive(p);const loaded=await readTairetsuArchive(new File([file],'emphasis.zip'));return {before:p,after:loaded.project};},p.id);assert.deepEqual(zip.after,zip.before);
    await back(page);await page.reload();await open(page,p);const saved=await read(page,p.id);assert.equal((p.mode==='stage'?saved.stage:saved.paradeSettings).emphasizeHorizontalNumbers,false);assert.deepEqual(saved.frames[0].positions,old);
    if(width===1376){
     const exported=await page.evaluate(async p=>{const {generateA4Document}=await import('/scripts/testing/export-a4.tsx');const outputs=[];for(const format of ['png','pdf']){const result=await generateA4Document(p, format);const file=result.files[0];const data=await new Promise(resolve=>{const r=new FileReader();r.onload=()=>resolve(r.result.split(',')[1]);r.readAsDataURL(file);});outputs.push({format,data,bytes:file.size,pageCount:result.pageCount});}return outputs;},p);
     for(const file of exported){assert.ok(file.bytes>1000);await writeFile(path.join(out,prefix+'-a4.'+file.format),Buffer.from(file.data,'base64'));}
    }
   }
   if(width===390&&p.mode==='parade'){
    await page.getByRole('button',{name:'全画面',exact:true}).click();
    await page.locator('.parade-viewport').evaluate(el=>{el.scrollLeft=(el.scrollWidth-el.clientWidth)/2;el.scrollTop=(el.scrollHeight-el.clientHeight)/2;});
    await page.screenshot({path:path.join(out,prefix+'-fullscreen-center.png')});
    await page.getByRole('button',{name:'解除',exact:true}).click();
   }
   results.push({id:p.id,width,height,lines});await back(page);
  }
  await page.getByRole('button',{name:'使い方',exact:true}).click();await page.getByRole('button',{name:'ステージの見え方と設定',exact:true}).click();await page.locator('.help-page-body').evaluate(el=>{const heading=[...el.querySelectorAll('.help-page-section-heading')].find(h=>h.textContent==='ステージの見え方と設定');el.scrollTop=heading.offsetTop-el.offsetTop;});await page.screenshot({path:path.join(out,`help-${width}x${height}.png`)});await expect(page.getByText('「ステージ」タブ →「詳しい設定」（パレードも同じ場所）',{exact:false})).toBeVisible();
  await context.close();
 }
 assert.deepEqual(errors,[]);let prior=[];try{prior=JSON.parse(await readFile(path.join(out,'results.json'),'utf8'));}catch{}const map=new Map([...prior,...results].map(r=>[r.id+'-'+r.width+'x'+r.height,r]));await writeFile(path.join(out,'results.json'),JSON.stringify([...map.values()],null,2));console.log('EMPHASIS_BROWSER PASS '+results.length+' configurations; UI/save/restart/ZIP/A4 PNG/PDF; '+out);
}finally{await browser.close();}
