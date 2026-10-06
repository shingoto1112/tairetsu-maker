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
  const started = Date.now(); await edit(0,'即時送信'); await expect(title(1)).toHaveValue('即時送信',{timeout:10000});
  assert(Date.now()-started<12000);
  await until(async()=>{const data=(await read(0)).collaboration;return data.writer?.ackThrough!=='0' && data.outbox.length===0;},'atomic sent collection');
  checks.push('real App durable edit -> immediate send -> realtime B (no 30s poll)');
  // Compound command + concurrent overwrite, Undo goes through actual App shortcut.
  await pages[0].evaluate(() => window.__sharedSession.active.editor.edit(p=>({...p,title:'複合操作',stage:{...p.stage,gridSizeMeters:p.stage.gridSizeMeters===0.5?1:0.5}})));
  await pages[0].locator('.toolbar-save-button').click(); await expect(title(1)).toHaveValue('複合操作');
  await edit(1,'他端末の題名'); await expect(title(0)).toHaveValue('他端末の題名');
  await title(0).blur(); await pages[0].locator('body').click({position:{x:2,y:2}}); await pages[0].keyboard.press('ControlOrMeta+Z');
  assert.equal((await state(0)).history.status,'partial'); await pages[0].locator('.toolbar-save-button').click();
  await edit(0,'Undo 対象'); await expect(title(1)).toHaveValue('Undo 対象');
  await edit(1,'上書き済み'); await expect(title(0)).toHaveValue('上書き済み');
  await title(0).blur(); await pages[0].locator('body').click({position:{x:2,y:2}}); await pages[0].keyboard.press('ControlOrMeta+Z');
  assert.equal((await state(0)).history.status,'blocked');
  checks.push('actual App Undo reports partial/blocked in status store');
  // Descriptor never silently plays a different local song after remote changes.
  await pages[1].evaluate(() => window.__sharedSession.active.editor.edit(p=>({...p,audio:{id:'missing-local-song',name:'共有曲',type:'audio/mpeg',size:123,duration:60}})));
  await pages[1].locator('.toolbar-save-button').click();
  await until(async()=>pages[0].evaluate(()=>!window.__sharedSession.active.audioMatches(window.__sharedSession.active.editor.project.audio)),'shared audio mismatch');
  assert.equal(await pages[0].locator('audio').getAttribute('src'),null);
  await expect(pages[0].getByText('この隊列表の曲がこの端末の曲と一致しません。音源タブで選び直してください。',{exact:true})).toBeVisible();
  await pages[1].evaluate(() => window.__sharedSession.active.editor.edit(p=>({...p,audio:null})));
  await pages[1].locator('.toolbar-save-button').click();
  checks.push('remote descriptor mismatch stops playback and gives Japanese guidance');
  await online(0,false); await edit(0,'再起動から再送'); assert((await read(0)).collaboration.outbox.some(e=>e.status==='pending'));
  await pages[0].reload(); await open(0,'再起動から再送'); await expect(title(1)).toHaveValue('再起動から再送',{timeout:10000});
  checks.push('offline edit -> durable pending -> App restart -> resend');
  backend.delayAckMs=600; await edit(0,'背景送信'); const closing=Date.now(); await back(0); assert(Date.now()-closing<1500);
  await expect(title(1)).toHaveValue('背景送信',{timeout:10000});
  await until(async()=>!(await read(0)).collaboration.outbox.some(e=>e.status==='pending'),'background ACK'); backend.delayAckMs=0;
  checks.push('return to library drains pending ACK without blocking UI');
  await open(0,'別文書'); await expect(title(0)).toHaveValue('別文書');
  await edit(1,'次文書へ侵入しない'); await expect(title(0)).toHaveValue('別文書'); assert.equal((await read(0,'other')).project.title,'別文書');
  await back(0); await open(0,'背景送信'); await expect(title(0)).toHaveValue('次文書へ侵入しない',{timeout:10000});
  checks.push('document switch isolates old provider and new coordinator');
  // Late pull captures old shared title, then document switches before response.
  backend.delayPullMs=800; await pages[0].evaluate(()=>window.__sharedSession.active.provider.wake()); await back(0); await open(0,'別文書');
  await new Promise(resolve=>setTimeout(resolve,1000)); await expect(title(0)).toHaveValue('別文書'); backend.delayPullMs=0;
  await back(0); await open(0,'次文書へ侵入しない');
  // A captured pull response crosses logout/account replacement while A stays open.
  backend.dropNotices=true; await edit(1,'資格切替前の応答');
  await until(async()=>(await state(1)).pending===0,'peer sent before delayed pull');
  backend.delayPullMs=800; await pages[0].evaluate(()=>window.__sharedSession.active.provider.wake());
  await new Promise(resolve=>setTimeout(resolve,150));
  await pages[0].evaluate(async actor=>{
    const {clearCloudAuthSession,saveCloudAuthSession}=await import('/src/cloud/session.ts'); clearCloudAuthSession();
    saveCloudAuthSession({accessToken:actor,refreshToken:'other',expiresAt:Date.now()+3600000,tokenType:'bearer',user:{id:actor,email:'other@example.invalid'}});
  },actors[1]);
  await new Promise(resolve=>setTimeout(resolve,900)); await expect(title(0)).toHaveValue('次文書へ侵入しない');
  assert.equal((await state(0)).sharing,'auth-required'); backend.delayPullMs=0; backend.dropNotices=false;
  await back(0);
  await pages[0].evaluate(async actor=>{
    const {saveCloudAuthSession}=await import('/src/cloud/session.ts');
    saveCloudAuthSession({accessToken:actor,refreshToken:'original',expiresAt:Date.now()+3600000,tokenType:'bearer',user:{id:actor,email:'original@example.invalid'}});
  },actors[0]);
  await open(0,'次文書へ侵入しない'); await expect(title(0)).toHaveValue('資格切替前の応答');
  checks.push('delayed pull cannot apply across logout/account replacement');
  // Pending belongs to removed member and cannot leak through either lane.
  await online(1,false); await edit(1,'救出する変更'); const before=backend.head;
  backend.members.delete(actors[1]); backend.departures.set(actors[1],'removed'); await online(1,true);
  await until(async()=>(await state(1)).sharing==='removed','removed'); assert.equal(backend.head,before);
  const rescue=await pages[1].evaluate(()=>window.__sharedSession.active.prepareIndependentCopy()); assert.equal(rescue.project.title,'救出する変更'); assert.equal(rescue.collaboration,null);
  await edit(0,'終了前の編集'); assert.equal((await read(1)).project.title,'救出する変更');
  checks.push('removed stops both lanes, retains outbox/live independent rescue');
  backend.deleted=true; await pages[0].evaluate(()=>window.__sharedSession.active.provider.wake());
  await until(async()=>(await state(0)).sharing==='ended','ended'); assert((await read(0)).collaboration.sharedDocumentId);
  checks.push('ended retains attachment and copy');
  // All iPad dimensions/orientations use actual App; no native runtime claims.
  await back(0);
  for (const [width,height] of [[744,1133],[1133,744],[1032,1376],[1376,1032]]) {
    await pages[0].setViewportSize({width,height}); await pages[0].goto(`${origin}/?runtime=capacitor-ios`); await open(0,'別文書');
    await expect(pages[0].locator('.workspace')).toBeVisible(); await edit(0,'別文書'); await back(0);
  }
  checks.push('iPad mini/13 portrait/landscape basic open/edit/save/back');
  await pages[0].goto(origin); await open(0,'終了前の編集'); await back(0);
  // App logout clears common identity before server logout, even on HTTP failure.
  await contexts[0].route(`${server.url}/auth/v1/logout`,route=>route.fulfill({status:503,contentType:'application/json',body:'{}'}));
  await pages[0].locator('.library-header').getByRole('button',{name:'アカウント',exact:true}).click();await pages[0].getByRole('dialog',{name:'アカウント',exact:true}).getByRole('button',{name:'ログアウト',exact:true}).click();
  await until(async()=>pages[0].evaluate(()=>!sessionStorage.getItem('tairetsu.cloud.authSession')),'logout clear');
  assert.equal(await pages[0].evaluate(()=>localStorage.getItem('tairetsu.collaboration.guestSession.v1')),null);
  await pages[0].evaluate(async actor=>{
    const {saveCloudAuthSession}=await import('/src/cloud/session.ts'); saveCloudAuthSession({accessToken:actor,refreshToken:'other',expiresAt:Date.now()+3600000,tokenType:'bearer',user:{id:actor,email:'other@example.invalid'}});
  },actors[1]);
  await open(0,'終了前の編集'); await until(async()=>(state(0)).then(s=>s.sync==='資格保留'),'wrong account held');
  assert.equal((await read(0)).collaboration.transportBinding.accountId,actors[0]);
  checks.push('failed remote logout clears local credentials; another account cannot use old binding');
  await back(0); await pages[0].locator('.library-header').getByRole('button',{name:'アカウント',exact:true}).click();await pages[0].getByRole('dialog',{name:'アカウント',exact:true}).getByRole('button',{name:'ログアウト',exact:true}).click();
  await pages[0].locator('.library-header').getByRole('button',{name:'ログイン',exact:true}).click();
  await expect(pages[0].locator('.library-cloud-login')).toBeVisible();
  await pages[0].locator('.library-cloud-login input[type="email"]').fill('session-test@example.invalid');
  await pages[0].locator('.library-cloud-login input[type="password"]').fill('mock-pass');
  await pages[0].getByRole('dialog',{name:'アカウント',exact:true}).getByRole('button',{name:'ログイン',exact:true}).click();
  await expect(pages[0].locator('.library-header').getByRole('button',{name:'アカウント',exact:true})).toBeEnabled();
  await expect(pages[0].getByText('ローカルカードのメニューからクラウドへアップロードできます。')).toHaveCount(0);
  checks.push('actual V2 login uses common Auth and never fetches legacy list');
  assert.deepEqual(legacy,[]); assert.deepEqual(denied,[]); assert.deepEqual(errors,[]);
  console.log('SHARED_SESSION_APP_BROWSER',JSON.stringify({checks,legacyCalls:legacy,productionNetwork:false}));
} finally {
  await Promise.all(contexts.map(c=>c.close())); await browser.close(); await server.close(); await vite.close();
}
