import assert from 'node:assert/strict';
import { chromium, expect } from '@playwright/test';
import { createServer } from 'vite';

// Even configured Auth + expired persisted credentials must not start a network lane.
const origin = 'http://127.0.0.1:5196';
process.env.VITE_COLLABORATION_V2 = '0';
const vite = await createServer({ envFile:false, server:{host:'127.0.0.1',port:5196,strictPort:true},logLevel:'warn' });
await vite.listen();
const browser = await chromium.launch({headless:true}), context = await browser.newContext({viewport:{width:1376,height:1032}});
const network = [], errors = [];
await context.addInitScript(url => { window.__sharedSessionMock = {url,anonKey:'synthetic-public'};
  if(new URLSearchParams(location.search).get('runtime')==='tauri')window.__TAURI_INTERNALS__={}; }, origin);
await context.route('**/*',route => {
  const url = new URL(route.request().url());
  if (url.pathname.startsWith('/auth/') || url.pathname.startsWith('/rest/') || url.pathname.startsWith('/functions/') || url.origin !== origin && !['blob:','data:'].includes(url.protocol)) {
    network.push(url.pathname); return route.abort();
  }
  return route.continue();
});
try {
  const page = await context.newPage(); page.on('pageerror',e=>errors.push(e.message));
  await page.goto(`${origin}/__off_test__`);
  await page.evaluate(async () => {
    const {saveCloudAuthSession} = await import('/src/cloud/session.ts');
    saveCloudAuthSession({accessToken:'synthetic-expired',refreshToken:'synthetic-refresh',expiresAt:0,tokenType:'bearer',user:{id:'11000000-0000-0000-0001-000000000001',email:'test@example.invalid'}});
  });
  for (const runtime of ['web','capacitor-ios','tauri']) {
    await page.goto(`${origin}/?runtime=${runtime}`);
    assert.equal(await page.evaluate(async()=>(await import('/src/platform/runtime.ts')).getAppRuntime()),runtime);
    await expect(page.getByRole('button',{name:'追加',exact:false})).toBeEnabled();
    await expect(page.getByRole('button',{name:/旧クラウド|ログイン|みんなで編集/})).toHaveCount(0);
  }
  await page.getByRole('button',{name:'追加',exact:false}).click();
  await page.getByRole('button',{name:'新しく作る',exact:false}).click();
  await page.getByRole('button',{name:'ステージ隊列',exact:false}).click();
  const create = page.getByRole('dialog',{name:'新しい隊列表を作成'});
  await create.getByRole('textbox').fill('ローカル試験'); await create.getByRole('button',{name:'作成する',exact:true}).click();
  const title = page.getByRole('textbox',{name:'隊列表名',exact:true}); await expect(title).toHaveValue('ローカル試験');
  await title.click(); await title.press('ControlOrMeta+A'); await title.pressSequentially('ローカル編集'); await title.blur();
  await page.getByRole('button',{name:'元に戻す',exact:true}).first().click(); await expect(title).toHaveValue('ローカル試験');
  await page.locator('.toolbar-save-button').click(); await expect(page.locator('.toolbar-save-button')).not.toHaveClass(/is-dirty/);
  await page.getByRole('button',{name:'共有と書き出し',exact:true}).click();
  await expect(page.getByRole('button',{name:/みんなで編集/})).toHaveCount(0);
  await page.getByRole('button',{name:/このシーンを書き出す/}).click();
  await page.getByRole('button',{name:'PDFを作成',exact:true}).click();
  await expect(page.getByRole('dialog',{name:'書き出し完了'})).toBeVisible({timeout:60000});
  await expect(page.getByText(/PDF・1ページ/)).toBeVisible();
  assert.deepEqual(network,[]); assert.deepEqual(errors,[]);
  console.log('LEGACY_LOCAL_BROWSER PASS: three runtimes OFF, configured expired Auth/no network, local create/edit/save/Undo/print-layout PDF; removed APIs=0');
} finally { await context.close(); await browser.close(); await vite.close(); }
