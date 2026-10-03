import { chromium, expect } from '@playwright/test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';

// Existing local server only. ZIPs are read through the app, never logged/written.
const origin = 'http://127.0.0.1:5179';
const url = `${origin}/?runtime=capacitor-ios`;
const output = 'output/playwright/build22';
const portrait = [[744,1133],[810,1080],[820,1180],[834,1210],[1024,1366],[1032,1376]];
const sizes = [...portrait, ...portrait.map(([w,h]) => [h,w])];
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width:1376,height:1032 }, hasTouch:true });
const page = await context.newPage();
const cdp = await context.newCDPSession(page);
const errors = [];
page.on('pageerror', () => errors.push('pageerror (private details suppressed)'));
const results = [];
let phase = 'initialization';
const wait = ms => page.waitForTimeout(ms);
const send = (type, points) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: points.map(([id,x,y]) => ({ id,x,y,radiusX:4,radiusY:4,force:1 })) });
const tap = async (x,y) => { await send('touchStart',[[1,x,y]]); await wait(35); await send('touchEnd',[]); await wait(350); };
const center = async selector => page.evaluate(selector => {
  const el = document.querySelector(selector), r = el.getBoundingClientRect();
  return { x:r.left+r.width/2,y:r.top+r.height/2 };
},selector);
const shell = async () => page.evaluate(() => {
  const root=document.scrollingElement, toolbar=document.querySelector('.toolbar').getBoundingClientRect();
  const buttons=[...document.querySelectorAll('.toolbar-label-button')].map(el=>{
    const r=el.getBoundingClientRect(); return { text:el.textContent, top:r.top,bottom:r.bottom,left:r.left,right:r.right,
      hit:el.contains(document.elementFromPoint(r.left+r.width/2,r.top+r.height/2)) };
  });
  return { top:root.scrollTop,left:root.scrollLeft,toolbarTop:toolbar.top,buttons,titleWidth:document.querySelector('.toolbar__title').getBoundingClientRect().width };
});
const checkShell = async () => {
  const s=await shell(); assert.equal(s.top,0);assert.equal(s.left,0); assert.ok(s.toolbarTop>=0);
  assert.deepEqual(s.buttons.map(b=>b.text),['ホーム','共有']);
  assert.ok(s.buttons.every(b=>b.hit&&b.top>=0&&b.bottom<=page.viewportSize().height&&b.right<=page.viewportSize().width));
  assert.ok(s.titleWidth>=140); return s;
};
const open = async kind => {
  await page.goto(url); await expect(page.locator('.formation-card--saved')).toHaveCount(3);
  await page.getByRole('button',{name:`検証${kind}を開く`,exact:true}).click();
  await page.locator('.toolbar').waitFor(); await wait(350);
};
const visibleTarget = async kind => page.evaluate(kind => {
  document.querySelectorAll('[data-touch-probe]').forEach(e=>e.removeAttribute('data-touch-probe'));
  const viewport=document.querySelector(kind==='stage'?'.stage-fit-area':'.parade-viewport').getBoundingClientRect();
  const selector=kind==='stage'?'.member-token':'.parade-member';
  const all=[...document.querySelectorAll(selector)];
  const el=all.find(el=> {const r=el.getBoundingClientRect(), x=r.left+r.width/2,y=r.top+r.height/2;
    return x>viewport.left+15&&x<viewport.right-15&&y>viewport.top+15&&y<viewport.bottom-15&&el.contains(document.elementFromPoint(x,y));});
  if(!el)return null;el.dataset.touchProbe='true';const r=el.getBoundingClientRect();return {x:r.left+r.width/2,y:r.top+r.height/2};
},kind);
const emptyPoint = async selector => page.evaluate(selector => {
  const el=document.querySelector(selector),r=el.getBoundingClientRect();
  for(const fx of [.5,.8,.2,.95])for(const fy of [.35,.5,.65]){
    const x=r.left+r.width*fx,y=r.top+r.height*fy,target=document.elementFromPoint(x,y);
    if(el.contains(target)&&!target.closest('button,input,select,[role="button"]'))return {x,y};
  }throw new Error('No empty gesture area');
},selector);
const pinch = async (selector,factor) => {
  const r=await page.locator(selector).boundingBox();
  const x=r.x+r.width*.5,y=r.y+r.height*.5,d=Math.min(80,r.width*.22);
  const tracking=selector==='.parade-viewport'?'.parade-member':'.member-token';
  await page.evaluate(tracking => {
    const members=[...document.querySelectorAll(tracking)];
    const el=members.find(e=>{const r=e.getBoundingClientRect(); return r.width>1;});
    el.dataset.pinchProbe='true';window.rafTimes=[];window.rafRunning=true;
    const tick=t=>{window.rafTimes.push(t);if(window.rafRunning)requestAnimationFrame(tick);};requestAnimationFrame(tick);
  },tracking);
  await send('touchStart',[[1,x-d/2,y],[2,x+d/2,y]]);
  for(let i=1;i<=18;i++){
    const distance=d*(1+(factor-1)*i/18);
    await send('touchMove',[[1,x-distance/2,y],[2,x+distance/2,y]]);await wait(18);
  }
  await wait(35);const before=await center('[data-pinch-probe]');
  const diagnostics=()=>page.evaluate(()=>{
    const v=document.querySelector('.parade-viewport'),s=document.querySelector('.parade-stage'),p=document.querySelector('.parade-pinch-preview');
    return v?{scroll:v.scrollTop,width:s.offsetWidth,height:s.offsetHeight,transform:p.style.transform}:null;
  });
  const beforeView=await diagnostics();
  await send('touchEnd',[]); await wait(80);const after=await center('[data-pinch-probe]');
  const delta=Math.hypot(after.x-before.x,after.y-before.y);
  const timing=await page.evaluate(()=>{window.rafRunning=false;
    document.querySelector('[data-pinch-probe]')?.removeAttribute('data-pinch-probe');
    const intervals=window.rafTimes.slice(1).map((t,i)=>t-window.rafTimes[i]).sort((a,b)=>a-b);
    return {p95:intervals[Math.floor(intervals.length*.95)]??0,max:Math.max(0,...intervals)};
  });
  const afterView=await diagnostics();
  assert.ok(delta<=2,`release delta ${delta}; ${JSON.stringify({before,after,beforeView,afterView})}`);return {delta,...timing};
};
const verifySceneView = async kind => {
  const cards=page.locator('.scene-thumbnail-card');if(await cards.count()<2)return;
  await cards.first().click();await wait(350);
  const selector=kind==='stage'?'.stage-fit-area':'.parade-viewport';
  await pinch(selector,1.3);await wait(350);
  const measure=()=>page.evaluate(kind=>{
    const v=document.querySelector(kind==='stage'?'.stage-fit-area':'.parade-viewport');
    const s=document.querySelector(kind==='stage'?'.stage-surface':'.parade-stage');
    return {width:s.offsetWidth,top:v.scrollTop,left:v.scrollLeft};
  },kind);
  const before=await measure();await cards.nth(1).click();await wait(350);await cards.first().click();await wait(350);
  const after=await measure();assert.equal(after.width,before.width);assert.ok(Math.abs(after.top-before.top)<=1);assert.ok(Math.abs(after.left-before.left)<=1);
};
try {
  await fs.mkdir(output,{recursive:true});
  await page.goto(url);await expect(page.getByRole('button',{name:'追加',exact:false})).toBeEnabled();
  phase='approved ZIP imports';
  for(const file of ['C:/Users/shing/Downloads/sailing_kobe_隊列名前入り.zip','C:/Users/shing/Downloads/2025どまつりパレード.zip']){
    await page.locator('input[type="file"][accept*=".zip"]').setInputFiles(file);
    await page.locator('.toolbar').waitFor({timeout:60000});
    await page.getByRole('button',{name:'隊列一覧へ戻る',exact:true}).click();
    await expect(page.getByRole('button',{name:'追加',exact:false})).toBeEnabled();
  }
  // Rename only the isolated browser's copies. No real data/name is emitted.
  const imported=await page.evaluate(async()=>{
    const {IndexedDbProjectRepository}=await import('/src/repositories/indexedDbRepository.ts');
    const r=new IndexedDbProjectRepository();await r.initialize(); const list=await r.list({limit:100});const meta=[];
    for(const summary of list.items){const record=await r.get(summary.id),p=record.project;
      const kind=p.mode==='parade'?'parade':'stage';
      window[`fixture_${kind}`]=structuredClone(p);
      p.title=`検証${kind}`; await r.commit({project:p,localRevision:String(Number(record.localRevision)+1),expectedRepositoryRevision:record.repositoryRevision,operationId:`rename-${kind}`});
      meta.push({kind,members:p.members.length,scenes:p.frames.length});
    }
    const {createSampleProject}=await import('/src/sampleProject.ts');
    const p=createSampleProject();p.id='long-touch-probe';p.title='検証long';p.mode='parade';
    p.paradeSettings={totalDistance:500,backwardDistanceMeters:20,width:18,cellSizeMeters:.5,direction:'up',rulerPosition:'both',horizontalMeasureMode:'normalMeter',emphasizeEvery5m:true,emphasizeEvery10m:true};
    p.frames.forEach(f=>{f.positions=Object.fromEntries(p.members.map((m,i)=>[m.id,{x:7+i,y:496}]));f.objectAssignments={};f.sceneViewState={zoom:1,scrollTop:15500,scrollLeft:0};
      Object.values(f.objectStates).forEach((o,i)=>{o.x=2;o.y=493-i*3;o.widthMeters=1;o.heightMeters=1;o.visible=true;});});
    await r.commit({project:p,localRevision:'1',expectedRepositoryRevision:null,operationId:'long-fixture'});r.close();return meta;
  });
  assert.equal(imported.find(m=>m.kind==='stage').members,146);
  for(const kind of (process.env.BUILD22_KIND ? [process.env.BUILD22_KIND] : ['stage','parade'])){
    phase=`${kind} viewport matrix`;
    for(const [width,height] of sizes.filter(([w,h])=>!process.env.BUILD22_SIZE||`${w}x${h}`===process.env.BUILD22_SIZE)){
      await page.setViewportSize({width,height});await open(kind);
      let target=await visibleTarget(kind);
      if(!target){
        // Previous viewport/pan tests can leave every performer outside the view.
        // Reposition this canvas only; no document scroll or data mutation.
        await page.evaluate(kind=>{
          const v=document.querySelector(kind==='stage'?'.stage-fit-area':'.parade-viewport');
          const m=document.querySelector(kind==='stage'?'.member-token':'.parade-member');
          const r=m.getBoundingClientRect(),b=v.getBoundingClientRect();
          v.scrollLeft+=r.left+r.width/2-b.left-b.width/2;v.scrollTop+=r.top+r.height/2-b.top-b.height/2;
        },kind);await wait(150);target=await visibleTarget(kind);
      }
      assert.ok(target,'visible member');
      await tap(target.x,target.y);await checkShell();
      const names=page.locator('.scene-visibility-chip__name');
      if(await names.count()){await names.last().click();await wait(250);}
      else {const list=page.locator('[data-member-id] button');if(await list.count()){await list.first().click();await wait(250);}}
      const s=await checkShell();
      const metrics=await pinch(kind==='stage'?'.stage-fit-area':'.parade-viewport',1.5);
      const shrink=await pinch(kind==='stage'?'.stage-fit-area':'.parade-viewport',.8);
      await checkShell();
      let pan=null;
      if(kind==='parade'){
        const p=await emptyPoint('.parade-viewport');
        const read=()=>page.locator('.parade-viewport').evaluate(e=>e.scrollTop);
        const initial=await read();await send('touchStart',[[1,p.x,p.y]]);
        for(let i=1;i<=6;i++){await send('touchMove',[[1,p.x,p.y+i*12]]);await wait(20);}
        const release=await read();await send('touchEnd',[]);await wait(150);const coast=await read();await wait(2500);const stopped=await read();await wait(150);
        assert.ok(release<initial,'one-finger scroll');assert.ok(coast<release,'inertia advances');assert.equal(await read(),stopped);
        pan={moved:initial-release,coast:release-coast,stopped};
      }
      results.push({kind,size:`${width}x${height}`,titleWidth:s.titleWidth,pinch:metrics,shrink,pan});
      if((width===744&&kind==='stage')||(width===1376&&kind==='parade'))await page.screenshot({path:`${output}/${kind}-${width}x${height}.png`});
      console.log(`PASS ${kind} ${width}x${height}`);
    }
  }
  if(!process.env.BUILD22_ROSTER){
  phase='stage scene views';await open('stage');await verifySceneView('stage');phase='parade scene views';await open('parade');await verifySceneView('parade');
  phase='parade maximum zoom';await page.setViewportSize({width:1376,height:1032});await open('parade');
  await page.getByRole('button',{name:'100%',exact:true}).click();await wait(200);
  const baseWidth=await page.locator('.parade-stage').evaluate(e=>e.offsetWidth);
  for(let i=0;i<5;i++)await pinch('.parade-viewport',2);
  assert.equal(await page.locator('.parade-stage').evaluate(e=>e.offsetWidth),baseWidth*6);
  await verifySceneView('parade');
  await page.locator('.toolbar-save-button').click();await expect(page.locator('.toolbar-save-button')).not.toHaveClass(/is-dirty/);
  await open('parade');assert.equal(await page.locator('.parade-stage').evaluate(e=>e.offsetWidth),baseWidth*6);
  }
  phase='roster default and image';await open('stage');await page.getByRole('button',{name:'共有と書き出し',exact:true}).click();
  await page.getByRole('button',{name:/^メンバー名簿/}).click();
  const dialog=page.locator('.document-export-sheet');await dialog.waitFor();
  await expect(dialog.getByRole('button',{name:'スマホで見る（LINE向け）',exact:true})).toHaveAttribute('aria-pressed','true');
  await expect(dialog.getByRole('button',{name:'画像',exact:true})).toHaveAttribute('aria-pressed','true');
  await expect(dialog.getByRole('button',{name:'メンバー名簿の画像を作成',exact:true})).toBeEnabled({timeout:60000});
  await dialog.getByRole('button',{name:'メンバー名簿の画像を作成',exact:true}).click();
  await expect(dialog.locator('.document-export-result')).toBeVisible({timeout:60000});
  const roster=await dialog.locator('.document-export-result').innerText();assert.ok(roster.includes('1枚'));
  await page.screenshot({path:`${output}/roster-default.png`});
  // Inspect the real layout/drawn count boxes without outputting any roster text.
  const heading=await page.evaluate(async()=>{
    const {IndexedDbProjectRepository}=await import('/src/repositories/indexedDbRepository.ts');
    const r=new IndexedDbProjectRepository();const all=await r.list({limit:100});
    const p=(await r.get(all.items.find(p=>p.title==='検証stage').id)).project;r.close();
    const {createRosterExportSnapshot}=await import('/src/utils/rosterExportSnapshot.ts');
    const {prepareMemberMobilePlan,drawMemberMobilePage}=await import('/src/utils/memberMobileExport.ts');
    const s=createRosterExportSnapshot(p.title,'members',p.members,p.memberGroups??[]);
    const plan=await prepareMemberMobilePlan(s,{signal:new AbortController().signal,onProgress:()=>{}});const sheet=drawMemberMobilePage(s,plan);document.body.append(sheet);
    const counts=[...sheet.querySelectorAll('[data-member-group] span')];
    const valid=counts.every(e=>getComputedStyle(e).whiteSpace==='nowrap');
    const count=sheet.querySelectorAll('[data-member-id]').length;sheet.remove();return {count,valid,width:plan.width,height:plan.height,font:plan.fontSize};
  });assert.equal(heading.count,146);assert.equal(heading.valid,true);
  if(process.env.BUILD22_ROSTER){console.log('PASS roster');process.exitCode=0;}
  phase='long parade';await open('long');await page.getByRole('button',{name:'100%',exact:true}).click();await wait(100);
  phase='drag, selection, long press, lock, wheel';
  const positionViewport=async()=>{await page.locator('.parade-viewport').evaluate(v=>{v.scrollTop=15500;v.scrollLeft=0;});await wait(350);};
  await positionViewport();let target=await visibleTarget('parade');assert.ok(target);
  // First finger must not select; adding the second finger discards selection.
  await tap(...Object.values(await emptyPoint('.parade-viewport')));
  target=await visibleTarget('parade');
  const probe=page.locator('[data-touch-probe]').last();
  await send('touchStart',[[1,target.x,target.y]]);await wait(50);assert.equal((await probe.getAttribute('class')).includes('is-selected'),false);
  await send('touchStart',[[1,target.x,target.y],[2,target.x+90,target.y]]);await wait(80);await send('touchEnd',[]);await wait(100);
  assert.equal((await probe.getAttribute('class')).includes('is-selected'),false);
  await tap(target.x,target.y);assert.ok((await probe.getAttribute('class')).includes('is-selected'));
  const start=await center('[data-touch-probe]');await send('touchStart',[[1,start.x,start.y]]);
  for(let i=1;i<=5;i++){await send('touchMove',[[1,start.x+i*8,start.y]]);await wait(30);}
  await send('touchEnd',[]);await wait(150);const moved=await center('[data-touch-probe]');assert.ok(Math.abs(moved.x-start.x)>=24,'member drag');
  await send('touchStart',[[1,moved.x,moved.y]]);await wait(700);await expect(page.locator('.stage-context-menu').first()).toBeVisible();await send('touchEnd',[]);
  await page.keyboard.press('Escape');await wait(100);
  // Existing drag edge scrolling must remain independent of empty-space pan.
  const edgeStart=await center('[data-touch-probe]'), vr=await page.locator('.parade-viewport').boundingBox();
  const edgeBefore=await page.locator('.parade-viewport').evaluate(e=>e.scrollTop);
  await send('touchStart',[[1,edgeStart.x,edgeStart.y]]);
  await send('touchMove',[[1,edgeStart.x,vr.y+15]]);await wait(300);
  assert.ok(await page.locator('.parade-viewport').evaluate(e=>e.scrollTop)<edgeBefore,'drag edge autoscroll');
  await send('touchEnd',[]);await wait(100);
  const lock=page.locator('.stage-pinch-lock-button');await lock.click();const lockedWidth=await page.locator('.parade-stage').evaluate(e=>e.offsetWidth);
  await pinch('.parade-viewport',1.5);assert.equal(await page.locator('.parade-stage').evaluate(e=>e.offsetWidth),lockedWidth);
  const ep=await emptyPoint('.parade-viewport');const lockedTop=await page.locator('.parade-viewport').evaluate(e=>e.scrollTop);
  await send('touchStart',[[1,ep.x,ep.y]]);await send('touchMove',[[1,ep.x,ep.y+60]]);await send('touchEnd',[]);await wait(150);
  assert.ok(await page.locator('.parade-viewport').evaluate(e=>e.scrollTop)<lockedTop);
  await lock.click();const wheelTop=await page.locator('.parade-viewport').evaluate(e=>e.scrollTop);const area=await emptyPoint('.parade-viewport');
  await page.mouse.move(area.x,area.y);await page.mouse.wheel(0,-120);await wait(150);assert.ok(await page.locator('.parade-viewport').evaluate(e=>e.scrollTop)<wheelTop);
  // Object dragging uses the existing deferred preview/commit path.
  await positionViewport();const object=page.locator('.parade-object').filter({has:page.locator('.parade-object__label')}).first();
  await object.evaluate(e=>e.dataset.objectProbe='true');const op=await center('[data-object-probe]');
  await send('touchStart',[[1,op.x,op.y]]);for(let i=1;i<=5;i++){await send('touchMove',[[1,op.x+i*8,op.y]]);await wait(30);}await send('touchEnd',[]);await wait(150);
  const om=await center('[data-object-probe]');assert.ok(Math.abs(om.x-op.x)>=24,'object drag');
  await checkShell();console.log('PASS scene views, tap/pinch selection, member/object drag, long press, pinch lock pan, wheel');
  phase='long parade zoom';
  await cdp.send('Performance.enable');await cdp.send('HeapProfiler.collectGarbage');
  const baselineMetrics=await cdp.send('Performance.getMetrics');
  const longPinches=[];for(let i=0;i<5;i++)longPinches.push(await pinch('.parade-viewport',2));
  await cdp.send('HeapProfiler.collectGarbage');const finalMetrics=await cdp.send('Performance.getMetrics');
  const metric=(values,name)=>values.metrics.find(m=>m.name===name)?.value??0;
  const long=await page.evaluate(()=>{const e=document.querySelector('.parade-stage'),v=document.querySelector('.parade-viewport');return {width:e.offsetWidth,height:e.offsetHeight,nodes:e.querySelectorAll('*').length,viewportWidth:v.clientWidth,heap:performance.memory?.usedJSHeapSize??null};});
  long.heapDelta=metric(finalMetrics,'JSHeapUsedSize')-metric(baselineMetrics,'JSHeapUsedSize');long.pinch=longPinches;
  assert.equal(long.height,520*32*6);await page.screenshot({path:`${output}/long-600.png`});
  assert.deepEqual(errors,[]);
  await fs.writeFile(`${output}/metrics.json`,JSON.stringify({results,imported,heading,long,errors},null,2));
  console.log('PASS matrix, touch pinch/release, inertia, max 600%, 146-person image; private contents suppressed.');
  console.log(JSON.stringify({heading,long,maxReleaseDelta:Math.max(...results.flatMap(r=>[r.pinch.delta,r.shrink.delta])),rafP95Max:Math.max(...results.map(r=>r.pinch.p95))}));
} catch(error) {
  await fs.writeFile(`${output}/partial-metrics.json`,JSON.stringify({phase,results},null,2));
  console.error(`FAIL ${phase}; private browser details suppressed. ${error instanceof assert.AssertionError?error.message:`${error.name} at test line ${error.stack?.match(/test-build22-browser.mjs:(\d+)/)?.[1]??'unknown'}`}`);
  if(phase.startsWith('roster')){
    const statuses=await page.locator('.document-export-sheet [role="status"]').allTextContents();
    console.log(JSON.stringify({rosterStatus:statuses.map(s=>({length:s.length,layoutOverflow:s.includes('配置範囲'),measurement:s.includes('測定でき'),cancelled:s.includes('取り消'),error:s.includes('失敗'),progress:s.includes('確認中'),complete:s.includes('1枚・')}))}));
  }
  process.exitCode=1;
} finally {await browser.close();}
