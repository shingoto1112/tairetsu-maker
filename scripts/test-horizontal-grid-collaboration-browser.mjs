import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { chromium, expect } from '@playwright/test';
import { createServer } from 'vite';
import { MockCollabBackend, startMockServer, actors, memberships, documentId } from './testing/mock-collab-server.mjs';
import { loadCollabEdge } from './testing/load-collab-edge.mjs';

// Own V2-ON dev server, no .env reads, no production network. Existing 5179 stays untouched.
process.env.VITE_COLLABORATION_V2 = '1';
const vite = await createServer({ envFile: false, server: { host: '127.0.0.1', port: 5183, strictPort: true }, logLevel: 'warn' });
await vite.listen();
const origin = 'http://127.0.0.1:5183', fixture = JSON.parse(await readFile('src/repositories/contract/fixtures/commitProjects.json','utf8')).stage;
const { createHandler, RpcError } = await loadCollabEdge();
const backend = new MockCollabBackend(null, RpcError), server = await startMockServer(backend, createHandler, origin);
const browser = await chromium.launch({ headless: true }), contexts = [], pages = [], errors = [], denied = [], legacy = [], checks = [];
const title = i => pages[i].getByRole('textbox', { name: '隊列表名', exact: true });
const state = i => pages[i].evaluate(() => window.__sharedSession.store.getSnapshot());
const until = async (predicate, label) => {
  const end = Date.now() + 12000;
  while (!await predicate()) {
    if (Date.now() > end) throw Error(`${label}: ${JSON.stringify(await Promise.all(pages.map(page=>page.evaluate(()=>({status:window.__sharedSession.store.getSnapshot(),provider:window.__sharedSession.active?.provider?.snapshot})))))}; legacy=${JSON.stringify(legacy)} errors=${JSON.stringify(errors)}`);
    await new Promise(resolve => setTimeout(resolve, 40));
  }
};
const read = (i, id = 'project_a') => pages[i].evaluate(async id => {
  const { IndexedDbProjectRepository } = await import('/src/repositories/indexedDbRepository.ts');
  const r = new IndexedDbProjectRepository(); await r.initialize(); try { return await r.get(id); } finally { r.close(); }
}, id);
const online = (i, value) => pages[i].evaluate(value => window.__sharedSession.active.provider.setOnline(value), value);
const back = async i => { await pages[i].getByRole('button', { name: '隊列一覧へ戻る', exact: true }).click(); await expect(pages[i].locator('.library-shell')).toBeVisible(); };
const open = async (i, name) => { await pages[i].getByRole('button', { name: `${name}を開く`, exact: true }).click(); await expect(title(i)).toHaveValue(name); };
const edit = async (i, name) => { await title(i).fill(name); await pages[i].locator('.toolbar-save-button').click(); };
try {
  let data;
  for (let i=0;i<2;i++) {
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } }); contexts.push(context);
    await context.grantPermissions(['local-network-access'], { origin });
    await context.addInitScript(config => { window.__sharedSessionMock = config; }, { url: server.url, anonKey: 'mock-public-key' });
    await context.route('**/*', route => {
      const url = new URL(route.request().url());
      if (![origin,server.url].includes(url.origin) && !['data:','blob:'].includes(url.protocol)) { denied.push(url.origin); return route.abort(); }
      if (url.origin === server.url && url.pathname.startsWith('/rest/v1/') && !url.pathname.split('/').at(-1).startsWith('collab_v2_')) legacy.push(url.pathname);
      if (url.href === `${origin}/__seed__`) return route.fulfill({ contentType:'text/html',body:'<!doctype html><title>Session setup</title>' });
      return route.continue();
    });
    const page = await context.newPage(); pages.push(page); page.on('pageerror', e => errors.push(e.message)); await page.goto(`${origin}/__seed__`);
    data = await page.evaluate(async ({ fixture, data, actor, membership, documentId }) => {
      const { IndexedDbProjectRepository } = await import('/src/repositories/indexedDbRepository.ts');
      const { createSharedDocument } = await import('/src/collaboration/model.ts');
      const { createCollaborationData } = await import('/src/collaboration/persistence.ts');
      const { saveCloudAuthSession } = await import('/src/cloud/session.ts');
      saveCloudAuthSession({ accessToken:actor,refreshToken:'mock-refresh',tokenType:'bearer',expiresAt:Date.now()+3600000,user:{id:actor,email:`user${actor}@example.invalid`} });
      const repository = new IndexedDbProjectRepository(); await repository.initialize();
      const p = {...fixture,title:'共有 session 試験'};
      if (!data) { const doc = createSharedDocument(p); data=createCollaborationData(doc); doc.destroy(); }
      data = {...data,sharedDocumentId:documentId,transportBinding:{accountId:actor,membershipGeneration:membership}};
      await repository.commit({project:p,collaboration:data,localRevision:'1',expectedRepositoryRevision:null,operationId:crypto.randomUUID()});
      await repository.commit({project:{...fixture,id:'other',title:'別文書'},localRevision:'1',expectedRepositoryRevision:null,operationId:crypto.randomUUID()});
      repository.close(); return data;
    }, { fixture, data, actor:actors[i],membership:memberships[i],documentId });
    if (!i) { backend.base = data.base; backend.generation=data.generation; }
    await page.goto(origin); await open(i,'共有 session 試験');
  }
  await until(async () => (await Promise.all([state(0),state(1)])).every(s=>s.sync==='同期済み'),'initial connection');

  const sharedProject = i => pages[i].evaluate(()=>window.__sharedSession.active.editor.project);
  for (const mode of ['stage','parade']) for (const counting of ['meters','centerSplit']) {
    await pages[0].evaluate(({mode,counting})=>window.__sharedSession.active.editor.edit(p=>({...p,mode,
      stage:{...p.stage,widthMeters:13,depthMeters:8,gridSizeMeters:1,horizontalGuideMode:counting},
      paradeSettings:{width:13,totalDistance:12,cellSizeMeters:1,direction:'up',rulerPosition:'both',horizontalMeasureMode:counting==='meters'?'normalMeter':'centerSplit',emphasizeEvery5m:true,emphasizeEvery10m:true},
      guideSettings:{snapGuideEnabled:false,snapToGuideEnabled:false},
      frames:p.frames.map(f=>({...f,positions:{m_001:{x:5.22,y:4},m_002:{x:7.71,y:4}},memberVisibility:{m_001:true,m_002:true},objectAssignments:{},sceneViewState:{zoom:.1,scrollTop:0,scrollLeft:0}}))
    })),{mode,counting});
    await pages[0].locator('.toolbar-save-button').click();
    await until(async()=>{const p=await sharedProject(1);return p.mode===mode&&p.stage.horizontalGuideMode===counting&&p.frames[0].positions.m_001.x===5.22;},'remote non-grid coordinates unchanged');
    assert.equal((await sharedProject(1)).frames[0].positions.m_002.x,7.71);
    if(mode==='stage')await pages[0].getByRole('button',{name:'ステージを全体表示に戻す',exact:true}).click();
    const tokens=pages[0].locator(mode==='stage'?'.member-token':'.parade-member');
    const primary=tokens.filter({hasText:'メンバー001'}),secondary=tokens.filter({hasText:'メンバー002'});
    await pages[0].keyboard.press('Escape');
    await primary.click();await secondary.click({modifiers:['Control']});
    await expect(primary).toHaveClass(/is-selected/);await expect(secondary).toHaveClass(/is-selected/);
    const area=await pages[0].locator(mode==='stage'?'.stage-surface':'.parade-stage').boundingBox(),box=await primary.boundingBox();
    const x=box.x+box.width/2,y=box.y+box.height/2;
    await pages[0].mouse.move(x,y);await pages[0].mouse.down();await pages[0].mouse.move(x+area.width/13*.63,y,{steps:8});
    const preview=await primary.boundingBox();await pages[0].mouse.up();await pages[0].locator('.toolbar-save-button').click();
    const expected=counting==='meters'?5.5:6;
    await until(async()=>{const p=await sharedProject(1);return Math.abs(p.frames[0].positions.m_001.x-expected)<1e-9;},'remote drag committed coordinates');
    const committed=await primary.boundingBox();assert.ok(Math.abs(preview.x-committed.x)<1.1,JSON.stringify({mode,counting,preview,committed}));
    const p=await sharedProject(1);assert.ok(Math.abs(p.frames[0].positions.m_002.x-p.frames[0].positions.m_001.x-2.49)<1e-9,'shared relative spacing');
    await pages[0].locator('body').click({position:{x:2,y:2}});await pages[0].keyboard.press('ControlOrMeta+Z');await pages[0].locator('.toolbar-save-button').click();
    await until(async()=>{const p=await sharedProject(1);return p.frames[0].positions.m_001.x===5.22&&p.frames[0].positions.m_002.x===7.71;},'shared Undo original non-grid coords');
    checks.push(mode+' '+counting+' non-grid receive + group drag + preview/commit + spacing + exact remote Undo');
  }
  for (const mode of ['stage', 'parade']) {
    await pages[0].evaluate(mode=>window.__sharedSession.active.editor.edit(p=>({...p,mode,
      stage:{...p.stage,widthMeters:10.3,depthMeters:8,gridSizeMeters:1,horizontalGuideMode:'centerSplit'},
      paradeSettings:{...p.paradeSettings,width:10.3,horizontalMeasureMode:'centerSplit'},
      guideSettings:{snapGuideEnabled:true,snapToGuideEnabled:true},
      stageObjects:[{id:'grid-prop',type:'prop',name:'道具試験',color:'#2563eb',shape:'rectangle',widthMeters:1.2,heightMeters:1,defaultX:3.58,defaultY:3.5,defaultRotation:0,visible:true,locked:false,zIndex:10}],
      frames:p.frames.map(f=>({...f,positions:{m_001:{x:4.37,y:4},m_002:{x:7.71,y:4}},
        objectStates:{'grid-prop':{objectId:'grid-prop',x:3.58,y:3.5,widthMeters:1.2,heightMeters:1,rotation:0,visible:true,zIndex:10}}}))
    })),mode);
    await pages[0].locator('.toolbar-save-button').click();
    await until(async()=>{const p=await sharedProject(1);return p.mode===mode&&p.stageObjects[0].id==='grid-prop'&&p.frames[0].objectStates['grid-prop'].x===3.58;},'object setup received');
    if(mode==='stage')await pages[0].getByRole('button',{name:'ステージを全体表示に戻す',exact:true}).click();
    if(mode==='parade')await pages[0].getByRole('button',{name:'100%',exact:true}).click();
    await pages[0].getByRole('tab',{name:'道具',exact:true}).click();await pages[0].keyboard.press('Escape');
    const object=pages[0].locator(mode==='stage'?'.stage-object':'.parade-object').filter({hasText:'道具試験'}).first();
    const box=await object.boundingBox(),area=await pages[0].locator(mode==='stage'?'.stage-surface':'.parade-stage').boundingBox();
    const x=box.x+box.width*.1,y=box.y+box.height/2;

    await pages[0].mouse.move(x,y);await pages[0].mouse.down();await pages[0].mouse.move(x+area.width/10.3*.21,y,{steps:6});
    await expect.poll(()=>object.evaluate(el=>el.style.getPropertyValue('--object-drag-x'))).not.toBe('');
    const preview=await object.boundingBox();await pages[0].mouse.up();await pages[0].locator('.toolbar-save-button').click();
    const expected=mode==='stage'?3.77:3.9;
    await until(async()=>Math.abs((await sharedProject(1)).frames[0].objectStates['grid-prop'].x-expected)<.001,'object snapped commit received');
    const committed=await object.boundingBox();assert.ok(Math.abs(preview.x-committed.x)<1.1,JSON.stringify({mode,preview,committed}));
    checks.push(mode+' object existing snap method/step + new origin + preview/commit'+(mode==='stage'?' + guide priority':''));
  }
  assert.deepEqual(legacy,[]);assert.deepEqual(denied,[]);assert.deepEqual(errors,[]);
  console.log('GRID_COLLABORATION_BROWSER PASS '+JSON.stringify({checks,productionNetwork:false}));
} finally {
  await Promise.all(contexts.map(c=>c.close())); await browser.close(); await server.close(); await vite.close();
}



