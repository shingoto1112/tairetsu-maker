import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { chromium, expect } from '@playwright/test';
import { createServer } from 'vite';
import { MockCollabBackend, startMockServer, actors } from './testing/mock-collab-server.mjs';
import { loadCollabEdge } from './testing/load-collab-edge.mjs';

const origin = 'http://127.0.0.1:5186';
process.env.VITE_COLLABORATION_V2 = '1';
const vite = await createServer({envFile:false,server:{host:'127.0.0.1',port:5186,strictPort:true},logLevel:'warn'});
await vite.listen();
const { createHandler, RpcError } = await loadCollabEdge();
const backend = new MockCollabBackend(null,RpcError,{fresh:true});
const server = await startMockServer(backend,createHandler,origin);
const browser = await chromium.launch({headless:true});
const shots = process.env.PASSWORD_SHOT_DIR ?? path.join(os.tmpdir(), 'tairetsu-shots-collab-password');
let password='mock-pass', mode='normal', updates=0;
const errors=[];
try {
  const context = await browser.newContext();
  await context.addInitScript(config => { window.__sharedSessionMock=config; }, {url:server.url,anonKey:'mock-public-key'});
  await context.route('**/*', async route => {
    const req=route.request(), url=new URL(req.url());
    if (![origin,server.url].includes(url.origin)&&!['data:','blob:'].includes(url.protocol)) return route.abort();
    if(url.origin===server.url && url.pathname==='/auth/v1/logout') return route.fulfill({json:{}});
    if(url.origin===server.url && url.pathname==='/auth/v1/token' && url.searchParams.get('grant_type')==='password') {
      const input=req.postDataJSON();
      return route.fulfill({status:input.password===password?200:400,contentType:'application/json',body:JSON.stringify(input.password===password ? {access_token:actors[0],refresh_token:`refresh-${updates}`,expires_in:3600,user:{id:actors[0],email:input.email,user_metadata:{display_name:'試験アカウント'}}} : {error:'invalid_credentials'})});
    }
    if(url.origin===server.url && url.pathname==='/auth/v1/user' && req.method()==='PUT') {
      updates++;
      if(mode==='rate') return route.fulfill({status:429,json:{error:'rate_limit'}});
      if(mode==='offline') return route.abort();
      password=req.postDataJSON().password;
      if(mode==='lost') return route.abort();
      return route.fulfill({json:{id:actors[0]}});
    }
    return route.continue();
  });
  const page=await context.newPage(); page.on('pageerror',e=>errors.push(e.message));
  await page.goto(origin);
  await page.locator('.library-header').getByRole('button',{name:'ログイン',exact:true}).click();
  await page.getByLabel('メールアドレス',{exact:true}).fill('session-test@example.invalid');
  await page.getByLabel('パスワード',{exact:true}).fill(password);
  await page.getByRole('dialog',{name:'アカウント',exact:true}).getByRole('button',{name:'ログイン',exact:true}).click();
  await page.getByRole('button',{name:'アカウント',exact:true}).click();
  await page.getByRole('button',{name:'パスワードを変更',exact:true}).click();
  const fill=async (current,next,confirmation=next) => {
    await page.getByLabel('現在のパスワード',{exact:true}).fill(current);
    await page.getByLabel('新しいパスワード',{exact:true}).fill(next);
    await page.getByLabel('新しいパスワード（確認）',{exact:true}).fill(confirmation);
  };
  const submit=()=>page.getByRole('button',{name:'パスワードを変更する',exact:true}).click();
  const capture=async label => {
    await mkdir(shots,{recursive:true});
    for(const [width,height] of [[744,1133],[1032,1376],[390,844]]) {
      await page.setViewportSize({width,height});
      const dialog=page.getByRole('dialog',{name:'アカウント',exact:true});
      await expect(dialog).toBeVisible();
      assert(await dialog.evaluate(el=>el.scrollWidth<=el.clientWidth),'dialog fits width');
      await page.screenshot({path:path.join(shots,`${label}-${width}x${height}.png`)});
    }
  };
  await capture('form');
  await fill('mock-pass','short'); await submit(); await expect(page.getByRole('alert')).toContainText('6文字以上'); assert.equal(updates,0);
  await fill('mock-pass','new-pass','mismatch');await submit();await expect(page.getByRole('alert')).toContainText('一致');assert.equal(updates,0);
  await fill('wrong-pass','new-pass');await submit();await expect(page.getByRole('alert')).toContainText('現在のパスワードが正しくありません。'); assert.equal(updates,0);
  await expect(page.getByLabel('現在のパスワード',{exact:true})).toHaveValue(''); await capture('error');
  for(const [failure,message] of [['rate','試行回数'],['offline','変更結果を確認できません']]) {
    mode=failure; await fill('mock-pass','new-pass');await submit();await expect(page.getByRole('alert')).toContainText(message);
  }
  mode='normal';await fill('mock-pass','new-pass');await submit();await expect(page.getByText('パスワードを変更しました。',{exact:true})).toBeVisible();
  await expect(page.getByLabel('新しいパスワード',{exact:true})).toHaveValue('');await capture('success');
  mode='lost';await fill('new-pass','lost-pass');await submit();await expect(page.getByRole('alert')).toContainText('変更結果を確認できません');
  mode='normal';await fill('lost-pass','new-pass');await submit();await expect(page.getByText('パスワードを変更しました。',{exact:true})).toBeVisible();
  await fill('new-pass','another-pass');await page.getByRole('button',{name:'取消',exact:true}).click();await page.getByRole('button',{name:'パスワードを変更',exact:true}).click();await expect(page.getByLabel('現在のパスワード',{exact:true})).toHaveValue('');
  await page.getByRole('dialog',{name:'アカウント',exact:true}).getByRole('button',{name:'ログアウト',exact:true}).click();await page.locator('.library-header').getByRole('button',{name:'ログイン',exact:true}).click();
  await page.getByLabel('メールアドレス',{exact:true}).fill('session-test@example.invalid');await page.getByLabel('パスワード',{exact:true}).fill('mock-pass');await page.getByRole('dialog',{name:'アカウント',exact:true}).getByRole('button',{name:'ログイン',exact:true}).click();await expect(page.getByRole('alert')).toContainText('正しくありません');
  await page.getByLabel('パスワード',{exact:true}).fill('new-pass');await page.getByRole('dialog',{name:'アカウント',exact:true}).getByRole('button',{name:'ログイン',exact:true}).click();await expect(page.getByRole('button',{name:'アカウント',exact:true})).toBeVisible();
  assert.deepEqual(errors,[]);console.log('PASS password form, validation, incorrect current, 429, offline, lost response, input clearing, cancel, old/new login; screenshots: '+shots);
} finally { await browser.close();await server.close();await vite.close(); }
