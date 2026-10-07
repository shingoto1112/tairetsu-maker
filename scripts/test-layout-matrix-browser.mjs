import { chromium, webkit, expect } from '@playwright/test';
import { createServer } from 'vite';
import fs from 'node:fs/promises';
import path from 'node:path';

// Local DEV only: isolated storage, synthetic data, no installs or external traffic.
const engine = process.env.LAYOUT_ENGINE ?? 'chromium';
if (!['chromium','webkit'].includes(engine)) throw Error('Unsupported layout engine');
const output = path.resolve('output/build29/layout-matrix', engine === 'webkit' ? 'webkit' : '.');
const port = Number(process.env.LAYOUT_PORT ?? 5392);
if (port < 5392 || port > 5399) throw Error('Use a port in 5392–5399');
const origin = `http://127.0.0.1:${port}`;
const tablets = [[744,1133],[768,1024],[810,1080],[820,1180],[834,1112],[834,1194],[834,1210],[1024,1366],[1032,1376]];
const windows = [[590,820],[400,820],[1000,700],[700,900]];
const android = [[1280,800],[1152,720],[962,601],[1848,1155]];
const configs = [];
for (const [w,h] of [...tablets, ...windows]) {
  const rotations = tablets.some(([a,b]) => a===w && b===h) ? [[w,h],[h,w]] : [[w,h]];
  for (const [width,height] of rotations) {
    configs.push({ id:`app-${width}x${height}`, native:true, width,height, rotationBase:[w,h] });
    for (const chrome of [74,116]) configs.push({ id:`web-${width}x${height}-${chrome}`, native:false,width,height:height-chrome,chrome,rotationBase:[w,h] });
  }
}
for (const [w,h] of android) for (const [width,height] of [[w,h],[h,w]]) configs.push({id:`android-${width}x${height}`,native:false,width,height,rotationBase:[w,h]});
const ids = process.env.LAYOUT_IDS?.split(',');
const selected = configs.filter(c => (!process.env.LAYOUT_FILTER || c.id.includes(process.env.LAYOUT_FILTER)) && (!ids || ids.includes(c.id)));
const report = { startedAt:new Date().toISOString(), engine, configs:selected, checks:[], screenshots:[], errors:[], blockedExternal:0, exclusions:[], complete:false };
await fs.mkdir(output,{recursive:true});

function fixture(count,grouped,mode) {
  const members = Array.from({length:count},(_,i)=>({id:`m${i}`,name:`架空${String(i+1).padStart(3,'0')}`,color:'#2563eb',visible:true}));
  const objects = Array.from({length:8},(_,i)=>({id:`o${i}`,name:`架空道具${i+1}`,color:'#e87924',type:'prop',shape:i%2?'circle':'rectangle',widthMeters:1.2,heightMeters:.6,defaultX:1+i,defaultY:5,defaultRotation:0,visible:true,locked:false,zIndex:1}));
  const positions = Object.fromEntries(members.map((m,i)=>[m.id,{x:1+(i%12),y:mode==='parade'?25-Math.floor(i/12)*.6:1+Math.floor(i/12)*.6}]));
  return {id:`matrix-${mode}-${count}-${grouped}`,title:`架空${mode}${count}${grouped}`,mode,version:1,updatedAt:'2026-10-08T00:00:00Z',audio:null,
    stage:{widthMeters:14,depthMeters:10,gridSizeMeters:.5,showGrid:true,showCenterLine:true,showStageLabels:true,audienceSide:'bottom',horizontalGuideMode:'centerSplit',memberDiameterMeters:.4},
    paradeSettings:{width:14,totalDistance:50,cellSizeMeters:.5,direction:'up',rulerPosition:'both',horizontalMeasureMode:'centerSplit',emphasizeEvery5m:true,emphasizeEvery10m:true},
    members,stageObjects:objects,memberGroups:grouped?[{id:'g1',name:'青グループ',color:'#2563eb',memberIds:members.filter((_,i)=>i%2===0).map(m=>m.id)}]:[],
    objectGroups:grouped?[{id:'og1',name:'旗グループ',color:'#e87924',objectIds:objects.slice(0,4).map(o=>o.id)}]:[],
    frames:Array.from({length:3},(_,i)=>({id:`s${i}`,label:`シーン${i+1}`,timeSec:i*15,positions,objectStates:Object.fromEntries(objects.map(o=>[o.id,{objectId:o.id,x:o.defaultX,y:o.defaultY,widthMeters:o.widthMeters,heightMeters:o.heightMeters,rotation:0,visible:true,zIndex:1}]))}))};
}

async function settle(page) {
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
}

async function openRoster(page) {
  await page.getByRole('tab',{name:'メンバー',exact:true}).click();
  await page.getByRole('button',{name:'全体名簿を開く',exact:true}).click();
  await page.getByRole('dialog',{name:'メンバー/道具の管理',exact:true}).waitFor({state:'visible'});
}

// Inspect all rendered controls against each clipping/scrolling ancestor. Translate
// the feasible interval by each real scroll range instead of requiring initial visibility.
// Canvas tokens have separate pan/zoom behavior; their controls are checked by the canvas tests.
async function geometry(page,{keyboard=false,expectedHeight,roster=false,home=false}={}) {
  return page.evaluate(({keyboard,expectedHeight,roster,home}) => {
    const failures=[],d=document.documentElement;
    const visible=e=>e.getClientRects().length && getComputedStyle(e).visibility!=='hidden' && !e.closest('[hidden], [inert]') && ![...function*(){for(let p=e.parentElement;p;p=p.parentElement)yield p;}()].some(p=>p.matches('details:not([open])')&&!p.querySelector(':scope > summary')?.contains(e));
    const root=document.querySelector(roster?'.roster-manager-modal':home?'.library-shell':'.app-shell');
    const rr=root?.getBoundingClientRect();
    if(d.scrollHeight>innerHeight+2 || d.scrollWidth>innerWidth+2) failures.push({rule:'document-overflow',h:d.scrollHeight,w:d.scrollWidth});
    if(!rr || Math.abs(rr.top)>2 || Math.abs(rr.height-(expectedHeight??innerHeight))>2) failures.push({rule:'shell-bounds',rect:rr?.toJSON(),expectedHeight:expectedHeight??innerHeight});
    if(document.querySelector('.fatal-error-screen')) failures.push({rule:'error-screen'});
    const stage=document.querySelector('.stage-fit-area,.parade-viewport');
    const sr=stage?.getBoundingClientRect();
    if(!home&&!roster&&!keyboard) {
      const portrait=!!document.querySelector('[data-workspace-layout="portrait"]');
      const minimum=portrait?Math.min(250,innerHeight*.24):Math.min(120,innerHeight*.25);
      if(!sr || sr.height<minimum || sr.width<80) failures.push({rule:'stage-collapsed',rect:sr?.toJSON(),minimum});
    }
    const scope=roster?root:document;
    const scrollPositions=[...document.querySelectorAll('*')].filter(e=>e.scrollHeight>e.clientHeight||e.scrollWidth>e.clientWidth).map(e=>[e,e.scrollLeft,e.scrollTop]);
    let controls=0,labels=0;
    const exemptions=new Set();
    for(const e of scope.querySelectorAll('button,input,textarea,select,[role="tab"],[role="separator"],a[href]')) {
      if(!visible(e)) continue;
      // Tokens may sit outside the currently panned canvas. Hidden file inputs
      // and native color pickers use their explicit visible trigger.
      if(e.closest('.member-token,.parade-member,.stage-object,.parade-object,.scene-preview,.audio-timeline__track') || e.matches('[type="file"], [type="color"]')) { exemptions.add('canvas / custom panned timeline / file and color input triggers'); continue; }
      const r=e.getBoundingClientRect();
      if(r.width<1||r.height<1) continue;
      controls++;
      let x0=r.left,x1=r.right,y0=r.top,y1=r.bottom;
      for(let p=e.parentElement;p;p=p.parentElement) {
        const cs=getComputedStyle(p),b=p.getBoundingClientRect();
        const sx=cs.overflowX,sy=cs.overflowY;
        const ratio=b.width/(p.offsetWidth||b.width)||1;
        if(['hidden','clip','auto','scroll'].includes(sx)) {
          if(['auto','scroll'].includes(sx)){x0-=Math.max(0,p.scrollWidth-p.clientWidth-p.scrollLeft)*ratio;x1+=p.scrollLeft*ratio;}
          x0=Math.max(x0,b.left);x1=Math.min(x1,b.right);
        }
        if(['hidden','clip','auto','scroll'].includes(sy)) {
          if(['auto','scroll'].includes(sy)){y0-=Math.max(0,p.scrollHeight-p.clientHeight-p.scrollTop)*ratio;y1+=p.scrollTop*ratio;}
          y0=Math.max(y0,b.top);y1=Math.min(y1,b.bottom);
        }
      }
      if(Math.min(x1,innerWidth)-Math.max(x0,0)<Math.min(8,r.width)-1 || Math.min(y1,innerHeight)-Math.max(y0,0)<Math.min(8,r.height)-1) {
        e.scrollIntoView({block:'center',inline:'center',behavior:'instant'});
        const b=e.getBoundingClientRect(),hit=document.elementFromPoint(b.left+b.width/2,b.top+b.height/2);
        if(hit!==e&&!e.contains(hit)) failures.push({rule:'unreachable-control',label:e.getAttribute('aria-label')||e.textContent?.trim().slice(0,70),class:e.className,rect:b.toJSON(),ancestors:[...function*(){for(let p=e.parentElement;p;p=p.parentElement)yield {class:p.className,overflow:getComputedStyle(p).overflow,scrollHeight:p.scrollHeight,clientHeight:p.clientHeight};}()].slice(0,8)});
        for(const [owner,x,y] of scrollPositions){owner.scrollLeft=x;owner.scrollTop=y;}
      }
      if(!e.matches('button,[role="tab"],a')) continue;
      const walker=document.createTreeWalker(e,NodeFilter.SHOW_TEXT),nodes=[];
      while(walker.nextNode()) if(!walker.currentNode.parentElement.closest('.sr-only,.visually-hidden,svg') && visible(walker.currentNode.parentElement)) nodes.push(walker.currentNode);
      const text=nodes.map(n=>n.textContent.trim()).join('').replace(/[\s□⬭＋−×▴▾]/gu,'');
      if(!text||[...text].length>6) continue;
      labels++;
      // Separate intentional fields (scene number and scene name) are each a label.
      for(const node of nodes) {
      const ys=[];
      for(let i=0;i<node.length;i++) {
        if(!/[^\s]/u.test(node.textContent[i]))continue;
        const range=document.createRange();range.setStart(node,i);range.setEnd(node,i+1);
        const r=range.getBoundingClientRect();if(r.width && !ys.some(y=>Math.abs(y-r.top)<parseFloat(getComputedStyle(node.parentElement).fontSize)*.7))ys.push(r.top);
      }
      if(ys.length>1) failures.push({rule:'wrapped-short-label',text:node.textContent.trim(),class:e.className,lines:ys.length});
      }
    }
    const preview=document.querySelector('.object-size-editor__preview')?.getBoundingClientRect();
    if(roster&&preview&&preview.height<170) failures.push({rule:'editor-preview-collapsed',height:preview.height});
    return {viewport:{width:innerWidth,height:innerHeight},document:{width:d.scrollWidth,height:d.scrollHeight},shell:rr?.toJSON(),stage:sr?.toJSON(),preview:preview?.toJSON(),controls,labels,exemptions:[...exemptions],failures};
  },{keyboard,expectedHeight,roster,home});
}

async function record(page,meta,state,options={}) {
  await settle(page);
  const result=await geometry(page,options);
  report.checks.push({...meta,state,...result,pass:result.failures.length===0});
  const representative=meta.count===45&&meta.grouped && ['members','roster-object-size','parade'].includes(state);
  if(representative||result.failures.length) {
    const filename=`${meta.id}-${meta.count}-${meta.grouped}-${state}.png`;
    await page.screenshot({path:path.join(output,filename)});report.screenshots.push(filename);
  }
  return result;
}

async function assertReachable(page,locator) {
  await locator.scrollIntoViewIfNeeded();
  const hit=await locator.evaluate(e=>{const r=e.getBoundingClientRect(),x=r.left+r.width/2,y=r.top+r.height/2;const hit=document.elementFromPoint(x,y);return hit===e||e.contains(hit);});
  if(!hit) throw Error(`Scroll could not reveal ${await locator.getAttribute('aria-label')||await locator.textContent()}`);
}

async function keyboardCases(page,meta) {
  await page.getByRole('tab',{name:'メンバー',exact:true}).click();
  const input=page.getByRole('searchbox').first();
  for(const stale of [false,true]) {
    await input.focus();
    await page.evaluate(()=>window.layoutViewport.set({height:innerHeight-360,scale:1,offsetTop:20},true));
    await expect.poll(()=>page.locator('.app-shell').evaluate(e=>e.getBoundingClientRect().height)).toBe(meta.native?meta.height-360:meta.height);
    await record(page,meta,`keyboard-${stale?'stale':'recovered'}-open`,{keyboard:true,expectedHeight:meta.native?meta.height-360:meta.height});
    await page.evaluate(stale=>{if(!stale) window.layoutViewport.set({height:innerHeight,offsetTop:0},false);document.activeElement.blur();},stale);
    await expect.poll(()=>page.locator('.app-shell').evaluate(e=>({height:e.getBoundingClientRect().height,flag:e.dataset.workspaceKeyboard,variable:e.style.getPropertyValue('--workspace-viewport-height')})),{timeout:1000}).toEqual({height:meta.height,flag:undefined,variable:''});
    await record(page,meta,`keyboard-${stale?'stale':'recovered'}-closed`);
    await page.evaluate(()=>{window.dispatchEvent(new Event('resize'));window.dispatchEvent(new Event('pageshow'));document.dispatchEvent(new Event('visibilitychange'));});
    await page.waitForTimeout(220);
    await record(page,meta,`keyboard-${stale?'stale':'recovered'}-late-event`);
    await page.evaluate(()=>window.layoutViewport.set({height:innerHeight,offsetTop:0},true));
  }
  // Numeric drafts keep the same input DOM while the native shell changes height.
  await openRoster(page);
  const roster=page.getByRole('dialog',{name:'メンバー/道具の管理',exact:true});
  await roster.getByRole('button',{name:'道具管理',exact:true}).click();
  await roster.getByRole('button',{name:'架空道具1の形と大きさを設定',exact:true}).click();
  await roster.getByRole('button',{name:/^幅 .*mを入力$/}).click();
  const numeric=roster.locator('.object-size-editor__numbers input');await numeric.fill('1.37');
  await page.evaluate(()=>{window.layoutDraftInput=document.querySelector('.object-size-editor__numbers input');window.layoutViewport.set({height:innerHeight-360,scale:1},true);});
  await page.waitForTimeout(60);
  await expect(numeric).toHaveValue('1.37');
  if(!await page.evaluate(()=>window.layoutDraftInput===document.querySelector('.object-size-editor__numbers input'))) throw Error('Numeric draft DOM replaced');
  for(const name of ['確定','取消']) await assertReachable(page,roster.getByRole('button',{name,exact:true}));
  await record(page,meta,'keyboard-roster-confirm-cancel',{roster:true,keyboard:true});
  await roster.getByRole('button',{name:'取消',exact:true}).click();
  await roster.getByRole('button',{name:'隊列表へ戻る',exact:true}).click();
  await page.evaluate(()=>{document.activeElement?.blur();window.layoutViewport.set({height:innerHeight,offsetTop:0},true);});
  await expect.poll(()=>page.locator('.app-shell').evaluate(e=>e.getBoundingClientRect().height),{timeout:1000}).toBe(meta.height);
}

async function runConfig(browser,config) {
  for(const count of [24,45,100]) for(const grouped of [false,true]) {
    const meta={...config,count,grouped};
    const context=await browser.newContext({viewport:{width:config.width,height:config.height},isMobile:true,hasTouch:true,locale:'ja-JP',serviceWorkers:'block'});
    await context.route('**/*',r=>{const u=new URL(r.request().url());if(u.origin===origin||['blob:','data:'].includes(u.protocol))return r.continue();report.blockedExternal++;return r.abort();});
    await context.routeWebSocket('**/*',socket=>{if(new URL(socket.url()).origin===origin.replace('http:','ws:'))socket.connectToServer();else socket.close();});
    const projects=[fixture(count,grouped,'stage'),fixture(count,grouped,'parade')];
    await context.addInitScript(projects=>{
      if(!localStorage.getItem('matrix-seeded')) {localStorage.setItem('stageflow.projects.v1',JSON.stringify(projects));localStorage.setItem('matrix-seeded','1');}
      window.layoutUnhandled=[];window.addEventListener('unhandledrejection',e=>window.layoutUnhandled.push(String(e.reason?.stack||e.reason)));
      const viewport=Object.assign(new EventTarget(),{height:innerHeight,width:innerWidth,scale:1,offsetTop:0,offsetLeft:0,pageTop:0,pageLeft:0});
      viewport.set=(values,event)=>{Object.assign(viewport,values);if(event)viewport.dispatchEvent(new Event('resize'));};
      window.layoutViewport=viewport;Object.defineProperty(window,'visualViewport',{configurable:true,value:viewport});
    },projects);
    const page=await context.newPage();page.setDefaultTimeout(8000);page.setDefaultNavigationTimeout(30000);
    page.on('pageerror',e=>report.errors.push({...meta,error:e.stack||e.message}));
    try {
      await page.goto(origin+(config.native?'/?runtime=capacitor-ios':'/'),{waitUntil:'domcontentloaded'});
      await page.getByRole('button',{name:`${projects[0].title}を開く`,exact:true}).waitFor();
      await record(page,meta,'home',{home:true});
      await page.getByRole('button',{name:`${projects[0].title}を開く`,exact:true}).click();
      await page.locator('.app-shell .stage-fit-area').waitFor({state:'visible'});
      const close=page.getByRole('button',{name:'お知らせを閉じる',exact:true});if(await close.count())await close.click();
      for(const [state,label] of [['timeline','シーン'],['members','メンバー'],['objects','道具'],['assignments','割当'],['audio','音源'],['stage','ステージ']]) {
        await page.getByRole('tab',{name:label,exact:true}).click();
        await expect(page.getByRole('tab',{name:label,exact:true})).toHaveAttribute('aria-selected','true');
        const panel={timeline:'.timeline',members:'.member-manager',objects:'.object-manager',assignments:'.assignment-tab-list',audio:'.audio-panel',stage:'.stage-settings-panel'}[state];
        await page.locator(`.tab-panel__content ${panel}`).waitFor({state:'visible'});
        await record(page,meta,state);
        const details=page.locator('.tab-panel__content details > summary');
        if(await details.count()) {
          // Use stable summary locators; the native toggle may settle after click returns.
          for(const summary of await details.all()) if(await summary.evaluate(e=>!e.parentElement.open)) await summary.click();
          await record(page,meta,`${state}-expanded`);
        }
        if(state==='audio') {
          // Custom timeline uses its play position to pan; reveal the final scene
          // through the actual overview instead of applying ordinary scroll rules.
          const overview=page.getByRole('slider',{name:'曲全体の再生位置'});
          await overview.scrollIntoViewIfNeeded();await overview.press('End');
          await assertReachable(page,page.locator('.audio-timeline__handle').last());
          await overview.press('Home');
        }
      }
      await openRoster(page);
      const roster=page.getByRole('dialog',{name:'メンバー/道具の管理',exact:true});
      await record(page,meta,'roster-members',{roster:true});
      await roster.getByRole('button',{name:'道具管理',exact:true}).click();
      await record(page,meta,'roster-objects',{roster:true});
      await roster.getByRole('button',{name:'架空道具1の形と大きさを設定',exact:true}).click();
      await record(page,meta,'roster-object-size',{roster:true});
      for(const name of ['幅を0.10m大きくする','高さを0.10m大きくする']) await assertReachable(page,roster.getByRole('button',{name,exact:true}));
      await roster.getByRole('button',{name:'隊列表へ戻る',exact:true}).click();
      if(count===45&&grouped) {
        if(config.width<config.height) await keyboardCases(page,meta);
        // Every size has one same-page portrait -> landscape -> portrait cycle.
        const [w,h]=config.rotationBase;const portrait={width:Math.min(w,h),height:Math.max(w,h)-(config.chrome??0)};
        const landscape={width:Math.max(w,h),height:Math.min(w,h)-(config.chrome??0)};
        for(const [state,size] of [['rotation-portrait',portrait],['rotation-landscape',landscape],['rotation-portrait-return',portrait]]) {
          await page.setViewportSize(size);await page.evaluate(()=>{window.layoutViewport.set({height:innerHeight,width:innerWidth},true);window.dispatchEvent(new Event('orientationchange'));});
          await page.waitForTimeout(220);await record(page,meta,state);
        }
        await page.setViewportSize({width:config.width,height:config.height});
      }
      for(const error of await page.evaluate(()=>window.layoutUnhandled))report.errors.push({...meta,error});
      await page.reload({waitUntil:'domcontentloaded'});
      await page.getByRole('button',{name:`${projects[1].title}を開く`,exact:true}).click();
      await page.locator('.app-shell .parade-viewport').waitFor({state:'visible'});
      if(await close.count())await close.click();
      await record(page,meta,'parade');
      const promises=await page.evaluate(()=>window.layoutUnhandled);for(const error of promises)report.errors.push({...meta,error});
    } catch(error) {
      report.errors.push({...meta,error:error.stack||String(error)});
      const filename=`${config.id}-${count}-${grouped}-exception.png`;await page.screenshot({path:path.join(output,filename)}).catch(()=>{});report.screenshots.push(filename);
    } finally {await context.close();}
  }
  console.log(`CHECKED ${config.id}`);
  await fs.writeFile(path.join(output,'results.partial.json'),JSON.stringify(report,null,2));
}

let server,browser;
try {
  server=await createServer({envFile:false,server:{host:'127.0.0.1',port,strictPort:true},logLevel:'warn'});await server.listen();
  console.log(`Local matrix PID ${process.pid}, port ${port}`);
  browser=await (engine === 'webkit' ? webkit : chromium).launch({headless:true,...(engine === 'chromium' ? {args:['--disable-background-networking']} : {})});
  const queue=[...selected];
  await Promise.all(Array.from({length:Number(process.env.LAYOUT_WORKERS??3)},async()=>{while(queue.length)await runConfig(browser,queue.shift());}));
  report.complete=true;
} finally {
  await browser?.close();await server?.close();
  report.finishedAt=new Date().toISOString();
  report.summary={configurations:selected.length,checks:report.checks.length,passed:report.checks.filter(c=>c.pass).length,failed:report.checks.filter(c=>!c.pass).length,errors:report.errors.length,controls:report.checks.reduce((n,c)=>n+c.controls,0),labels:report.checks.reduce((n,c)=>n+c.labels,0)};
  await fs.writeFile(path.join(output,'results.json'),JSON.stringify(report,null,2));
  const failed=report.checks.filter(c=>!c.pass);
  const summary=`# build 29 tablet layout matrix\n\n${JSON.stringify(report.summary)}\n\n| 判定 | 合格 | 不合格 |\n|---|---:|---:|\n| 画面の自動判定 | ${report.summary.passed} | ${report.summary.failed} |\n| 実行例外・pageerror・未処理Promise | 0 | ${report.errors.length} |\n\n${engine} mobile/touch、ローカルDEV、架空データ。外部通信遮断。\n\nCanvas tokens/custom panned timeline/file/color inputsは通常UIの到達性検査対象外（パン・専用トリガーを別検査）。閉じたdetailsは開いた画面で検査。実機キーボード・ブラウザー標準のパン・VoiceOverは別確認。\n\n${failed.map(c=>`- ${c.id} ${c.count} grouped=${c.grouped} ${c.state}: ${[...new Set(c.failures.map(f=>f.rule+': '+(f.label||f.text||'')))].join(', ')}`).join('\n')}\n`;
  await fs.writeFile(path.join(output,'summary.md'),summary);console.log(summary);
}
if(!report.complete||report.summary.failed||report.summary.errors)process.exitCode=1;
