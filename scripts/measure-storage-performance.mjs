import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { chromium } from '@playwright/test';
import { storagePerformanceServer } from './testing/storage-performance-server.mjs';

const count = Number(process.env.PERF_SAMPLES ?? 20);
assert(Number.isInteger(count) && count > 0);
const profile = process.env.PERF_PROFILE === '1';
const output = process.env.PERF_OUTPUT ?? 'output/storage-performance/results.json';
const commits = JSON.parse(await readFile('src/repositories/contract/fixtures/commitProjects.json', 'utf8'));
const fixtures = JSON.parse(await readFile('src/repositories/contract/fixtures/projects.json', 'utf8'));
const large = { ...commits.stage, id: 'perf-large', title: '匿名200人45シーン', audio: null,
  members: Array.from({ length: 200 }, (_, i) => ({ id: `m-${i}`, name: `匿名${i+1}`, color: '#009966' })) };
large.frames = Array.from({ length: 45 }, (_, f) => ({ ...commits.stage.frames[0], id: `f-${f}`, label: `シーン${f+1}`, timeSec: f*8,
  positions: Object.fromEntries(large.members.map((m,i) => [m.id,{ x: 1+(i%20)*.65, y: 1+Math.floor(i/20)*.65+(f%2)*.2 }])),
  memberVisibility: {}, objectStates: {}, objectAssignments: {} }));
const medium = { ...fixtures.large, id: 'perf-medium', title: '匿名146人18シーン', audio: null };
// An anonymous fixture is used; force names here as defense against fixture changes.
medium.members = medium.members.map((m,i) => ({ ...m, name: `匿名${i+1}` }));
const parade = { ...large, id: 'perf-parade', title: '匿名500mパレード', mode: 'parade',
  paradeSettings: { totalDistance:500, backwardDistanceMeters:20, width:18, cellSizeMeters:.5, direction:'up', rulerPosition:'both', horizontalMeasureMode:'normalMeter', emphasizeEvery5m:true, emphasizeEvery10m:true },
  frames: large.frames.map(f => ({ ...f, positions: Object.fromEntries(large.members.map((m,i) => [m.id,{x:1+i%15,y:2+Math.floor(i/15)*2}])), sceneViewState:{zoom:1,scrollTop:0,scrollLeft:0} })) };
const projects = [large, medium, parade];
const stats = values => { const sorted = [...values].sort((a,b)=>a-b); return { n:sorted.length, p50:sorted[Math.ceil(sorted.length*.5)-1], p95:sorted[Math.ceil(sorted.length*.95)-1], max:sorted.at(-1) }; };
const resumed = process.env.PERF_RESUME === '1' ? JSON.parse(await readFile(output,'utf8')) : null;
if (resumed) assert(resumed.count === count && resumed.profile === profile, 'Resume must use the same sample count/profile mode');
const rows = resumed?.rows ?? [], errors = [], denied = [];
const browser = await chromium.launch({ headless:true });

async function prepare(context, origin, target) {
  const page = await context.newPage();
  page.on('pageerror', e => errors.push(e.message));
  await context.route('**/*', route => {
    const u = new URL(route.request().url());
    if (!['127.0.0.1','localhost'].includes(u.hostname)) { denied.push(u.origin); return route.abort(); }
    return route.continue();
  });
  await page.route(`${origin}/__performance_seed`, route => route.fulfill({ contentType:'text/html', body:'<!doctype html><title>Anonymous seed</title>' }));
  await page.goto(`${origin}/__performance_seed`);
  await page.evaluate(async ({target, base}) => {
    const { IndexedDbProjectRepository } = await import('/src/repositories/indexedDbRepository.ts');
    const r = new IndexedDbProjectRepository(); await r.initialize();
    await r.commit({ project:target, localRevision:'1', expectedRepositoryRevision:null, operationId:'seed-target' });
    for(let i=0;i<49;i++) await r.commit({ project:{...base,id:`small-${i}`,title:`匿名小隊列${i}`,audio:null},localRevision:'1',expectedRepositoryRevision:null,operationId:`seed-${i}` });
    r.close();
  }, {target,base:commits.stage});
  // Seed imports must not warm the measured page's JS module map or HTTP cache.
  const cdp = await context.newCDPSession(page); await cdp.send('Network.clearBrowserCache'); await page.close();
  const measured = await context.newPage();
  measured.on('pageerror', e=>errors.push(e.message));
  await measured.addInitScript(() => {
    window.__storageProfile = [];
    window.__frameGaps = [];
    let previous; const tick = t => { if(previous!==undefined) window.__frameGaps.push({t,gap:t-previous}); previous=t; requestAnimationFrame(tick); }; requestAnimationFrame(tick);
  });
  return measured;
}

async function waitPaint(page, predicate) {
  return page.evaluate(async source => {
    const check = new Function(`return (${source})`)();
    const start=performance.now();
    while(!check()) { if(performance.now()-start>15000) throw Error('UI readiness timeout'); await new Promise(requestAnimationFrame); }
    await new Promise(requestAnimationFrame); await new Promise(requestAnimationFrame);
    return performance.now();
  }, predicate);
}
async function cycle(page, origin, query, target, cold) {
  let listStart;
  if(cold) { await page.goto(origin+query,{waitUntil:'domcontentloaded'}); listStart=0; }
  else listStart = await page.evaluate(() => { const t=performance.now(); document.querySelector('[aria-label="隊列一覧へ戻る"]')?.click(); return t; });
  const listEnd = await waitPaint(page, '() => document.querySelectorAll(".formation-card--saved").length === 50 && [...document.querySelectorAll("button")].some(b => b.textContent.includes("追加") && !b.disabled)');
  await page.evaluate(async () => {
    const { IndexedDbProjectRepository } = await import('/src/repositories/indexedDbRepository.ts');
    if(!IndexedDbProjectRepository.prototype.__profiled) {
      for(const name of ['get','list','commit','touchOpened']) {
        const original = IndexedDbProjectRepository.prototype[name]; if(!original) continue;
        IndexedDbProjectRepository.prototype[name]=async function(...args) { const t=performance.now(); try { return await original.apply(this,args); } finally { window.__storageProfile.push({id:`repository.${name}`,duration:performance.now()-t}); } };
      }
      IndexedDbProjectRepository.prototype.__profiled = true;
    }
    window.__storageProfile=[];
  });
  const currentTitle = cold ? target.title : await page.evaluate(() => window.__perfTitle);
  const openStart = await page.getByRole('button',{name:`${currentTitle}を開く`,exact:true}).evaluate(button => { window.__storageProfile=[]; const t=performance.now(); button.click(); return t; });
  const openEnd = await waitPaint(page, `() => document.querySelector('.toolbar-save-button') && document.querySelectorAll('${target.mode==='parade'?'.parade-member':'.member-token'}').length >= ${target.members.length} && document.querySelector('.scene-thumbnail-card.is-active svg')`);
  const openProfile = await page.evaluate(({start,end}) => ({ entries:window.__storageProfile, frameGaps:window.__frameGaps.filter(f=>f.t>=start && f.t<=end).map(f=>f.gap), circles:document.querySelectorAll('.scene-thumbnail-preview circle').length }),{start:openStart,end:openEnd});
  const edit = async suffix => page.evaluate(suffix => {
    const input=document.querySelector('input[aria-label="隊列表名"]');
    const value=`匿名計測${suffix}-${Math.round(performance.now())}`;
    const t=performance.now(); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,value); input.dispatchEvent(new Event('input',{bubbles:true})); window.__perfTitle=value; return t;
  },suffix);
  const autoStart=await edit('自動');
  await waitPaint(page,'() => document.querySelector(".toolbar-save-button.is-dirty")');
  const autoEnd=await waitPaint(page,'() => !document.querySelector(".toolbar-save-button.is-dirty") && document.querySelector(".toolbar-save-button").textContent === "保存"');
  await edit('手動'); await waitPaint(page,'() => document.querySelector(".toolbar-save-button.is-dirty")');
  const saveStart=await page.evaluate(()=>{const t=performance.now();document.querySelector('.toolbar-save-button').click();return t;});
  const saveEnd=await waitPaint(page,'() => !document.querySelector(".toolbar-save-button.is-dirty") && document.querySelector(".toolbar-save-button").textContent === "保存"');
  const sceneStart=await page.evaluate(()=>{const t=performance.now();document.querySelectorAll('.scene-thumbnail-card')[1].click();return t;});
  const sceneEnd=await waitPaint(page,'() => document.querySelectorAll(".scene-thumbnail-card")[1].classList.contains("is-active")');
  await waitPaint(page,'() => !document.querySelector(".toolbar-save-button.is-dirty")');
  const gaps=await page.evaluate(({start,end})=>window.__frameGaps.filter(f=>f.t>=start&&f.t<=end).map(f=>f.gap),{start:sceneStart,end:sceneEnd});
  return {list:listEnd-listStart,open:openEnd-openStart,manualSave:saveEnd-saveStart,autoSave:autoEnd-autoStart,scene:sceneEnd-sceneStart,sceneFrameMax:Math.max(0,...gaps),openProfile};
}

try {
  for(const v2 of [false,true]) {
    const port=5191, origin=`http://127.0.0.1:${port}`;
    const server=await storagePerformanceServer({port,v2,profile});
    try {
      for(const ipad of [false,true]) for(const target of projects) {
        if (rows.some(row=>row.v2===v2 && row.ipad===ipad && row.project===target.id && row.temperature==='warm')) continue;
        if(process.env.PERF_CASE && !`${v2?'on':'off'}-${ipad?'ipad':'web'}-${target.id}`.includes(process.env.PERF_CASE)) continue;
        const cold=[], warm=[];
        for(let i=0;i<count;i++) {
          const context=await browser.newContext({viewport:ipad?{width:1032,height:1376}:{width:1440,height:1000},hasTouch:ipad});
          try {
            const page=await prepare(context,origin,target);
            cold.push(await cycle(page,origin,ipad?'/?runtime=capacitor-ios':'/',target,true));
            // Same number of warm observations; each follows its cold cycle.
            warm.push(await cycle(page,origin,ipad?'/?runtime=capacitor-ios':'/',target,false));
          } finally { await context.close(); }
        }
        for(const [temperature,samples] of [['cold',cold],['warm',warm]]) {
          const row={v2,ipad,project:target.id,temperature, metrics:Object.fromEntries(['list','open','manualSave','autoSave','scene','sceneFrameMax'].map(k=>[k,stats(samples.map(s=>s[k]))])),samples};
          rows.push(row); console.log(JSON.stringify({...row,samples:undefined}));
        }
        await mkdir('output/storage-performance',{recursive:true});
        await writeFile(output,JSON.stringify({profile,count,browser:browser.version(),rows,errors,denied},null,2));
      }
    } finally { await server.close(); }
  }
  assert.deepEqual(errors,[]); assert.deepEqual(denied,[]);
} finally { await browser.close(); }
