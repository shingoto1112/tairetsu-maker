import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { chromium, expect } from '@playwright/test';
import { createServer } from 'vite';
import { MockCollabBackend, startMockServer, documentId } from './testing/mock-collab-server.mjs';
import { loadCollabEdge } from './testing/load-collab-edge.mjs';

// Real App UI, disposable loopback backend, no .env/production credentials.
const origin = 'http://127.0.0.1:5184';
process.env.VITE_COLLABORATION_V2 = '1'; process.env.VITE_COLLABORATION_INVITATION_URL = origin;
const vite = await createServer({ envFile: false, server: { host:'127.0.0.1',port:5184,strictPort:true }, logLevel:'warn' });
await vite.listen();
const { createHandler, RpcError } = await loadCollabEdge();
const backend = new MockCollabBackend(null,RpcError,{fresh:true}), server = await startMockServer(backend,createHandler,origin);
const browser = await chromium.launch({headless:true}), contexts=[], pages=[], errors=[], denied=[], legacy=[], checks=[], shots=[], bounds=[];
const shotDir = process.platform === 'win32' ? 'C:/Users/shing/AppData/Local/Temp/claude/c--Users-shing-OneDrive--------ChatGPT-------/e5aa9c38-eb07-490c-ac06-62f047c4c161/scratchpad/shots-8a2' : path.join(process.cwd(),'.tmp-shots-8a2');
const dims=[[744,1133],[1133,744],[1032,1376],[1376,1032]];
const title = page => page.getByRole('textbox',{name:'隊列表名',exact:true});
const dialog = page => page.getByRole('dialog',{name:'みんなで編集',exact:true});
const close = page => page.getByRole('button',{name:'共同編集画面を閉じる',exact:true}).click();
const home = async page => { await page.getByRole('button',{name:'隊列一覧へ戻る',exact:true}).click(); await expect(page.locator('.library-shell')).toBeVisible(); };
const manage = async page => { await page.getByRole('button',{name:'共有と書き出し',exact:true}).click(); await page.getByRole('button',{name:/みんなで編集/}).click(); await expect(dialog(page)).toBeVisible(); };
const login = async page => {
  await page.getByRole('button',{name:'ログイン / 新規登録',exact:true}).click();
  await page.getByLabel('メールアドレス',{exact:true}).fill('session-test@example.invalid'); await page.getByLabel('パスワード',{exact:true}).fill('mock-pass');
  await page.getByLabel('パスワード',{exact:true}).fill('invalid-test-password');await page.getByRole('button',{name:'ログイン',exact:true}).click();
  await expect(page.getByRole('alert')).toContainText('メールアドレスまたはパスワードが正しくありません');
  await page.getByLabel('パスワード',{exact:true}).fill('mock-pass');await page.getByRole('button',{name:'ログイン',exact:true}).click(); await expect(page.getByRole('button',{name:'ログアウト',exact:true})).toBeVisible();
};
const invite = async page => {
  const input=page.getByRole('textbox',{name:'作成した招待リンク',exact:true});
  const previous=await input.count() ? await input.inputValue() : '';
  await dialog(page).getByRole('button',{name:'招待リンクを作成',exact:true}).click();
  await expect(input).toHaveValue(/#invite=[a-f0-9]{64}$/);if(previous)await expect(input).not.toHaveValue(previous);
  await expect(dialog(page).getByRole('button',{name:'招待リンクを作成',exact:true})).toBeEnabled();
  return input.inputValue();
};
async function newBrowser(url=origin) {
  const context=await browser.newContext({viewport:{width:1133,height:744}}); contexts.push(context);
  await context.grantPermissions(['local-network-access','clipboard-read','clipboard-write'],{origin});
  await context.addInitScript(config=>{window.__sharedSessionMock=config;},{url:server.url,anonKey:'mock-public-key'});
  await context.route('**/*',route=>{
    const url=new URL(route.request().url());
    if (![origin,server.url].includes(url.origin)&&!['data:','blob:'].includes(url.protocol)){denied.push(url.origin);return route.abort();}
    if(url.origin===server.url&&url.pathname.startsWith('/rest/v1/')&&!url.pathname.split('/').at(-1).startsWith('collab_v2_')&&url.pathname!=='/rest/v1/rpc/delete_current_account')legacy.push(url.pathname);
    return route.continue();
  });
  const page=await context.newPage();pages.push(page);page.on('pageerror',e=>errors.push(e.message));page.on('dialog',d=>d.accept());await page.goto(url);return page;
}
async function capture(page,label,toolbar=false) {
  await mkdir(shotDir,{recursive:true});
  for (const [width,height] of dims) {
    await page.setViewportSize({width,height}); await page.waitForTimeout(100);
    if(toolbar){
      const controls=await page.locator('.toolbar').getByRole('button').evaluateAll(elements=>elements.filter(el=>['隊列一覧へ戻る','共有と書き出し'].includes(el.getAttribute('aria-label'))).map(el=>{const r=el.getBoundingClientRect();return {label:el.getAttribute('aria-label'),x:r.x,y:r.y,right:r.right,bottom:r.bottom};}));
      // Toolbar itself may use header rather than .toolbar: exact controls below.
      const rects=await Promise.all(['隊列一覧へ戻る','共有と書き出し'].map(async name=>({label:name,...await page.getByRole('button',{name,exact:true}).boundingBox()})));
      for(const r of rects) assert(r.x>=0&&r.y>=0&&r.x+r.width<=width&&r.y+r.height<=height,`${label} ${width}x${height}: ${JSON.stringify(r)}`);
      const bar=await page.locator('.toolbar').boundingBox(),status=await page.locator('.toolbar .collab-status-pill').boundingBox();
      assert(status && status.y>=bar.y && status.y+status.height<=bar.y+bar.height && status.x+status.width<=width,'status stays in the existing toolbar row');
      assert.equal(await page.locator('.collab-status-pill').getAttribute('data-tone'),label.includes('removed')||label.includes('ended')?'warning':'success');
      bounds.push({label,width,height,controls:rects,toolbar:bar,status});void controls;
    }
    const name=`${label}-${width}x${height}.png`;await page.screenshot({path:path.join(shotDir,name)});shots.push(name);
  }
}
try {
  const a=await newBrowser();await login(a);
  await a.getByRole('button',{name:/追加.*新規/}).click();await a.getByRole('button',{name:/新しく作る/}).click();await a.getByRole('button',{name:/ステージ隊列/}).click();
  await a.getByRole('dialog',{name:'新しい隊列表を作成'}).getByRole('textbox',{name:'隊列表名'}).fill('共同編集画面試験');await a.getByRole('button',{name:'作成する',exact:true}).click();await expect(title(a)).toHaveValue('共同編集画面試験');
  const topBeforeSharing=await a.locator('.app-top-region').boundingBox();
  await manage(a);await a.getByLabel('共有で使う表示名').fill('試験作成者');await a.getByRole('button',{name:'共有を始める',exact:true}).click();await expect(dialog(a)).toHaveCount(0);await expect(a.locator('.collab-status-pill')).toBeVisible();
  await expect(a.locator('.collab-status-pill')).toHaveText('同期済み');assert.equal((await a.locator('.app-top-region').boundingBox()).height,topBeforeSharing.height,'shared status adds no top-region row');
  await home(a);await expect(a.locator('.formation-card__badge').getByText('クラウド保存',{exact:true})).toBeVisible();
  await a.getByRole('button',{name:'共同編集画面試験を開く',exact:true}).click();await expect(title(a)).toHaveValue('共同編集画面試験');
  await manage(a);const link=await invite(a);await close(a);
  const beforeJoin=backend.managementCalls.filter(n=>n==='collab_v2_join').length;
  const b=await newBrowser(link);await expect(b.getByRole('dialog',{name:'招待されています'})).toBeVisible();assert.equal(new URL(b.url()).hash,'');assert.equal(backend.managementCalls.filter(n=>n==='collab_v2_join').length,beforeJoin);
  await b.evaluate(async()=>{
    const {IndexedDbProjectRepository}=await import('/src/repositories/indexedDbRepository.ts');
    const {RepositoryError}=await import('/src/repositories/types.ts');
    const original=IndexedDbProjectRepository.prototype.commit;let fail=true;window.joinSaveRequests=[];
    IndexedDbProjectRepository.prototype.commit=function(request){
      if(request.collaboration?.transportBinding && request.expectedRepositoryRevision===null){
        window.joinSaveRequests.push(JSON.stringify(request));
        if(fail){fail=false;return Promise.reject(new RepositoryError('IO_ERROR'));}
      }
      return original.call(this,request);
    };
  });
  await b.getByLabel('参加する表示名').fill('試験ゲスト');await b.getByRole('button',{name:'参加する',exact:true}).click();
  await expect(b.getByRole('button',{name:'保存を再試行して開く',exact:true})).toBeVisible();
  assert.equal(backend.managementCalls.filter(n=>n==='collab_v2_join').length,beforeJoin+1);
  await b.getByRole('button',{name:'保存を再試行して開く',exact:true}).click();await expect(title(b)).toHaveValue('共同編集画面試験');
  assert.equal(backend.managementCalls.filter(n=>n==='collab_v2_join').length,beforeJoin+1);
  const fixedRequests=await b.evaluate(()=>window.joinSaveRequests);assert.equal(fixedRequests.length,2);assert.equal(fixedRequests[0],fixedRequests[1]);
  await Promise.all([title(a).fill('同時編集の隊列表'),b.locator('.member-manager button.primary').click()]);await Promise.all([a.locator('.toolbar-save-button').click(),b.locator('.toolbar-save-button').click()]);await expect(title(b)).toHaveValue('同時編集の隊列表');
  await manage(a);await expect(dialog(a).getByText('試験ゲスト',{exact:false})).toBeVisible();await expect(dialog(a).getByText('ゲスト',{exact:true})).toBeVisible();
  await expect(dialog(a).getByText(/使用済み/)).toBeVisible();const revokedLink=await invite(a);const latest=[...backend.invites.values()].at(-1);await a.getByRole('button',{name:'招待を取り消す',exact:true}).last().click();await expect(dialog(a).getByText(/取り消し済み/)).toBeVisible();assert(latest.revoked);
  const expiredLink=await invite(a);[...backend.invites.values()].at(-1).expiresAt=Date.now()-1;await a.getByRole('button',{name:'最新の状態を確認',exact:true}).click();await expect(dialog(a).getByText(/期限切れ/)).toBeVisible();await close(a);
  const a2=await newBrowser();await login(a2);await expect(a2.getByRole('button',{name:'同時編集の隊列表をクラウドから開く',exact:true})).toBeVisible();const joins=backend.managementCalls.filter(n=>n==='collab_v2_join').length;
  await a2.getByRole('button',{name:'同時編集の隊列表をクラウドから開く',exact:true}).click();await expect(title(a2)).toHaveValue('同時編集の隊列表');assert.equal(backend.managementCalls.filter(n=>n==='collab_v2_join').length,joins);assert.equal(backend.members.size,2);
  checks.push('UI login/start/invite, explicit single guest join, simultaneous edits, member/guest list, stable existing-account open without invite');
  // Run iPad layout in the Capacitor runtime without claiming native execution.
  await home(a);await a.goto(`${origin}/?runtime=capacitor-ios`);
  await expect(a.getByText('この端末にある共有隊列表 1件',{exact:true})).toBeVisible();await expect(a.getByRole('button',{name:'一覧を更新',exact:true})).toBeEnabled();
  assert.equal(await a.getByRole('button',{name:'同時編集の隊列表をクラウドから開く',exact:true}).count(),0,'home cloud list hides documents already on this device');
  await expect(a.getByText('共同編集を準備中…',{exact:true})).toHaveCount(0);await capture(a,'home-v2');await a.getByRole('button',{name:'同時編集の隊列表を開く',exact:true}).click();await expect(a.locator('.collab-status-pill')).toHaveText('同期済み');await capture(a,'status-v2',true);await manage(a);await capture(a,'manage-v2',true);await close(a);
  await b.evaluate(()=>window.__sharedSession.active.provider.setOnline(false));await expect(b.locator('.collab-status-pill')).toHaveText('オフライン');await expect(b.locator('.collab-status-pill')).toHaveAttribute('data-tone','neutral');await title(b).fill('未送信の救出編集');await b.locator('.toolbar-save-button').click();
  await manage(a);await a.getByRole('button',{name:'試験ゲストを外す',exact:true}).click();await close(a);await b.evaluate(()=>window.__sharedSession.active.provider.setOnline(true));await expect(b.getByLabel('共有状態 removed')).toBeVisible({timeout:35000});
  await b.goto(`${origin}/?runtime=capacitor-ios`);await b.getByRole('button',{name:'未送信の救出編集を開く',exact:true}).click();await expect(b.getByLabel('共有状態 removed')).toBeVisible();await capture(b,'removed-v2',true);
  await b.evaluate(async()=>{
    const {IndexedDbProjectRepository}=await import('/src/repositories/indexedDbRepository.ts');
    const original=IndexedDbProjectRepository.prototype.get,localId=window.__sharedSession.active.localId;let delay=true;
    IndexedDbProjectRepository.prototype.get=function(id){
      if(delay&&id===localId){delay=false;window.rescueReadWaiting=true;return new Promise(resolve=>{window.releaseRescueRead=resolve;}).then(()=>original.call(this,id));}
      return original.call(this,id);
    };
  });
  await b.getByRole('button',{name:'独立した隊列表として保存',exact:true}).click();await b.waitForFunction(()=>window.rescueReadWaiting);
  await title(b).fill('未送信の救出編集・追加');await b.evaluate(()=>window.releaseRescueRead());
  await expect(b.getByRole('alert')).toContainText('追加の編集があるため元の隊列表を表示しています');await expect(title(b)).toHaveValue('未送信の救出編集・追加');await expect(b.locator('.collab-status-pill')).toBeVisible();
  await b.getByRole('button',{name:'独立した隊列表として保存',exact:true}).click();await expect(title(b)).toHaveValue('未送信の救出編集・追加');await expect(b.locator('.collab-status-pill')).toHaveCount(0);
  const rescued=await b.evaluate(()=>({id:window.__sharedSession.active?.localId??null}));assert.equal(rescued.id,null);
  // A separate current participant remains for the ended banner.
  await manage(a);const endLink=await invite(a);await close(a);const c=await newBrowser(endLink);await c.getByLabel('参加する表示名').fill('終了確認ゲスト');await c.getByRole('button',{name:'参加する',exact:true}).click();await expect(title(c)).toHaveValue('同時編集の隊列表');
  for(const bad of [revokedLink,expiredLink,link]){const p=await newBrowser(bad);await p.getByLabel('参加する表示名').fill('無効招待試験');await p.getByRole('button',{name:'参加する',exact:true}).click();await expect(p.getByRole('alert')).toContainText('期限切れ、使用済み、または取り消されています');}
  await manage(a);await a.getByRole('button',{name:'共有を終了（クラウドから削除）',exact:true}).click();await close(a);await expect(c.getByLabel('共有状態 ended')).toBeVisible({timeout:35000});
  await capture(a,'ended-v2',true);
  await home(a);await a.getByRole('button',{name:'アカウント',exact:true}).click();await a.getByRole('button',{name:'アカウント削除',exact:true}).click();await a.getByLabel('現在のパスワード').fill('mock-pass');await a.getByLabel('削除内容を確認しました').check();await a.getByRole('button',{name:'アカウントを削除する',exact:true}).click();await expect(a.getByText('アカウントを削除しました。この端末のコピーは残っています。')).toBeVisible();
  checks.push('revoked/expired/used invitation errors, removed rescue retains unsent edits, ended banner, V2 account deletion RPC');
  assert.deepEqual(legacy,[]);assert.deepEqual(denied,[]);assert.deepEqual(errors,[]);
  await writeFile(path.join(shotDir,'bounds.json'),JSON.stringify(bounds,null,2));
  console.log('COLLABORATION_UI_BROWSER',JSON.stringify({checks,shots,bounds,legacyCalls:legacy.length,productionNetwork:false,shotDir}));
} catch(error) {
  console.error('UI_FAILURE',JSON.stringify({errors,legacy,denied,alerts:await Promise.all(pages.map(p=>p.getByRole('alert').allTextContents()))}));
  throw error;
} finally {await Promise.all(contexts.map(c=>c.close()));await browser.close();await server.close();await vite.close();}
