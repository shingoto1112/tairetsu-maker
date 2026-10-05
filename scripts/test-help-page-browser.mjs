import { round12Dimensions, checkRound12Layout } from './testing/round12-layout.mjs';
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { chromium, expect } from '@playwright/test';
import { createServer } from 'vite';
import { MockCollabBackend, startMockServer, actors, memberships, documentId } from './testing/mock-collab-server.mjs';
import { loadCollabEdge } from './testing/load-collab-edge.mjs';

// Disposable browsers, anonymous fixtures and loopback mock only. No .env.
const shotDir = process.env.ROUND12_SHOT_DIR ?? process.env.HELP_SHOT_DIR ?? (process.platform === 'win32'
  ? 'C:/Users/shing/AppData/Local/Temp/claude/c--Users-shing-OneDrive--------ChatGPT-------/e5aa9c38-eb07-490c-ac06-62f047c4c161/scratchpad/shots-help'
  : path.resolve('output/playwright/shots-help'));
const dimensions = round12Dimensions;
const shots = [], bounds = [], errors = [], denied = [], checks = [];
const browser = await chromium.launch({ headless: true });
const fixture = JSON.parse(await readFile('src/repositories/contract/fixtures/commitProjects.json', 'utf8')).stage;
await mkdir(shotDir, { recursive: true });
async function capture(page, label, status = false) {
  for (const [width,height] of dimensions) {
    await page.setViewportSize({width,height});
    await page.waitForTimeout(100);
    if (label === 'help-v2-collaboration') await page.locator('.help-page-body').evaluate(body => {
      const section = [...body.querySelectorAll('.help-page-section')].find(el => el.textContent.includes('みんなで同時に編集する（共同編集）'));
      body.scrollTop += section.getBoundingClientRect().top - body.getBoundingClientRect().top;
    });
    const selector = status ? '.collab-status-pill' : '.help-page';
    const geometry = await page.locator(selector).evaluate(element => {
      const box = element.getBoundingClientRect();
      const range = document.createRange(); range.selectNodeContents(element);
      const text = Array.from(range.getClientRects()).map(rect => ({left:rect.left,right:rect.right,top:rect.top,bottom:rect.bottom}));
      const toolbar = document.querySelector('.toolbar')?.getBoundingClientRect();
      return {left:box.left,right:box.right,top:box.top,bottom:box.bottom,clientHeight:element.clientHeight,scrollHeight:element.scrollHeight,text,
        toolbar:toolbar && {top:toolbar.top,bottom:toolbar.bottom}};
    });
    assert(geometry.left >= 0 && geometry.right <= width + .5 && geometry.top >= 0 && geometry.bottom <= height + .5, `${label}: viewport bounds ${JSON.stringify(geometry)}`);
    if (status) {
      assert(geometry.scrollHeight <= geometry.clientHeight + 1, `${label}: clipped text height`);
      for (const rect of geometry.text) assert(rect.left >= geometry.left && rect.right <= geometry.right + .5 && rect.top >= geometry.top && rect.bottom <= geometry.bottom + .5, `${label}: clipped text ${JSON.stringify(rect)}`);
      assert(geometry.bottom <= geometry.toolbar.bottom + .5, `${label}: toolbar height`);
      for (const name of ['隊列一覧へ戻る','共有と書き出し']) {
        const box = await page.getByRole('button',{name,exact:true}).boundingBox();
        assert(box.x >= 0 && box.x + box.width <= width + .5, `${label}: toolbar action outside viewport`);
      }
    } else {
      assert.equal(await page.locator('.help-page-body').evaluate(element => element.scrollWidth > element.clientWidth), false, 'no horizontal help scroll');
      await expect(page.getByRole('button',{name:'使い方を閉じる',exact:true})).toBeInViewport();
    }
    const file = `${label}-${width}x${height}.png`;
    await checkRound12Layout(page,label,status ? '.toolbar' : '.help-page'); await page.screenshot({path:path.join(shotDir,file)}); shots.push(file);
    if (label === 'help-v2-collaboration') {
      await page.locator('.help-page-body').evaluate(body => { body.scrollTop = body.scrollHeight; });
      await checkRound12Layout(page,'help-v2-collaboration-end','.help-page');
      const endFile=`help-v2-collaboration-end-${width}x${height}.png`;
      await page.screenshot({path:path.join(shotDir,endFile)}); shots.push(endFile);
    }
    bounds.push({label,width,height,...geometry});
  }
}
async function run(enabled) {
  process.env.VITE_COLLABORATION_V2 = enabled ? '1' : '0';
  const port = enabled ? 5186 : 5185, origin = `http://127.0.0.1:${port}`;
  const vite = await createServer({envFile:false,server:{host:'127.0.0.1',port,strictPort:true},logLevel:'warn'});
  let mock, context;
  try {
    await vite.listen();
    let backend;
    if (enabled) {
      const {createHandler,RpcError} = await loadCollabEdge();
      backend = new MockCollabBackend(null,RpcError);
      mock = await startMockServer(backend,createHandler,origin);
    }
    context = await browser.newContext({viewport:{width:744,height:1133},hasTouch:true});
    await context.grantPermissions(['local-network-access'],{origin});
    if (enabled) await context.addInitScript(config => { window.__sharedSessionMock = config; }, {url:mock.url,anonKey:'mock-public-key'});
    await context.route('**/*', route => {
      const url = new URL(route.request().url());
      if (![origin,mock?.url].includes(url.origin) && !['data:','blob:'].includes(url.protocol)) { denied.push(url.origin); return route.abort(); }
      if (url.pathname === '/__help_seed__') return route.fulfill({contentType:'text/html',body:'<!doctype html><title>Help setup</title>'});
      return route.continue();
    });
    const page = await context.newPage(); page.on('pageerror',error => errors.push(error.message));
    await page.goto(`${origin}/__help_seed__`);
    const base = await page.evaluate(async ({fixture,enabled,actor,membership,documentId}) => {
      const {IndexedDbProjectRepository} = await import('/src/repositories/indexedDbRepository.ts');
      const repository = new IndexedDbProjectRepository(); await repository.initialize();
      const project = {...fixture,title:'使い方の確認'};
      let collaboration = null;
      if (enabled) {
        const {createSharedDocument} = await import('/src/collaboration/model.ts');
        const {createCollaborationData} = await import('/src/collaboration/persistence.ts');
        const {saveCloudAuthSession} = await import('/src/cloud/session.ts');
        saveCloudAuthSession({accessToken:actor,refreshToken:'mock-refresh',tokenType:'bearer',expiresAt:Date.now()+3600000,user:{id:actor,email:'help-test@example.invalid'}});
        const doc = createSharedDocument(project); collaboration = createCollaborationData(doc); doc.destroy();
        collaboration = {...collaboration,sharedDocumentId:documentId,transportBinding:{accountId:actor,membershipGeneration:membership}};
      }
      await repository.commit({project,...(collaboration ? {collaboration} : {}),localRevision:'1',expectedRepositoryRevision:null,operationId:'help-seed'});
      repository.close(); return collaboration;
    },{fixture,enabled,actor:actors[0],membership:memberships[0],documentId});
    if (enabled) {backend.base = base.base; backend.generation = base.generation;}
    const warmed = Promise.all(['HelpPage.tsx','helpContent.ts','helpPage.css'].map(file => page.waitForResponse(response => new URL(response.url()).pathname.endsWith(`/${file}`))));
    await page.goto(`${origin}/?runtime=capacitor-ios`);
    await expect(page.getByRole('button',{name:'追加',exact:false})).toBeEnabled();
    await warmed; await page.waitForLoadState('networkidle');
    await context.setOffline(true);
    // First ever opening while Chromium networking is blocked, after idle preload.
    const launcher = page.getByRole('button',{name:'使い方',exact:true});
    await launcher.click();
    const dialog = page.getByRole('dialog',{name:'使い方',exact:true}); await expect(dialog).toBeVisible();
    const headings = dialog.locator('h3 button');
    await expect(headings).toHaveCount(enabled ? 15 : 14);
    await expect(dialog.getByRole('button',{name:'みんなで同時に編集する（共同編集）',exact:true})).toHaveCount(enabled ? 1 : 0);
    if (!enabled) {
      await capture(page,'help-list');
      await dialog.getByRole('button',{name:'名簿をまとめて作る・直す',exact:true}).click();
      await capture(page,'help-roster-open');
    }
    for (let index=0; index<await headings.count(); index++) {
      const heading = headings.nth(index);
      if (await heading.getAttribute('aria-expanded') !== 'true') await heading.click();
      await expect(heading).toHaveAttribute('aria-expanded','true');
      const body = page.locator(`[id="${await heading.getAttribute('aria-controls')}"]`);
      await expect(body).toBeVisible();
      if ((await heading.textContent()).includes('共同編集')) { await expect(body.locator('li')).toHaveCount(11); await expect(body).toContainText('共有先への送信と確認が済んでいます'); await expect(body).not.toContainText('準備中'); }
      await heading.click(); await expect(body).toBeHidden();
    }
    await dialog.getByRole('button',{name:'困ったとき',exact:true}).click();
    const support = dialog.getByRole('link',{name:'「サポート」',exact:true});
    const links = await page.evaluate(async () => (await import('/src/config/publicLinks.ts')).PUBLIC_LINKS).catch(() => null);
    // This config is already in the App's module graph, even with offline enabled.
    assert(links); assert.equal(await support.getAttribute('href'),links.support);
    await page.getByRole('button',{name:'使い方を閉じる',exact:true}).focus();
    await page.keyboard.press('Shift+Tab'); await expect(support).toBeFocused();
    await page.keyboard.press('Tab'); await expect(page.getByRole('button',{name:'使い方を閉じる',exact:true})).toBeFocused();
    await page.keyboard.press('Escape'); await expect(dialog).toHaveCount(0); await expect(launcher).toBeFocused();
    await context.setOffline(false);
    await page.getByRole('button',{name:'使い方の確認を開く',exact:true}).click();
    await expect(page.getByRole('textbox',{name:'隊列表名',exact:true})).toHaveValue('使い方の確認');
    await page.getByRole('button',{name:'メニューを開く',exact:true}).click();
    const menuFooter = page.locator('.app-menu-section--footer');
    assert.equal(await menuFooter.locator('button,a').first().textContent(),'使い方');
    await menuFooter.getByRole('button',{name:'使い方',exact:true}).click(); await expect(dialog).toBeVisible();
    if (enabled) {
      await dialog.getByRole('button',{name:'みんなで同時に編集する（共同編集）',exact:true}).click();
      await capture(page,'help-v2-collaboration');
    }
    await page.getByRole('button',{name:'使い方を閉じる',exact:true}).click(); await expect(dialog).toHaveCount(0);
    await expect(page.getByRole('button',{name:'メニューを開く',exact:true})).toBeFocused();
    checks.push(`V2 ${enabled ? 'ON' : 'OFF'}: home/menu, all accordion sections, first opening offline, support URL, Tab/Esc/close/restore focus`);
    if (enabled) {
      await expect(page.locator('.collab-status-pill')).toHaveText('同期済み');
      await page.evaluate(() => window.__sharedSession.active.provider.setOnline(false));
      for (const state of ['synced','saving','pending','pending-saving','checking','offline','save-failed','removed','ended','auth-required','membership-changed','recovery-required']) {
        await page.evaluate(async state => {
          const {sessionSnapshot} = await import('/src/storage/sharedSessionState.ts');
          const {RepositoryError} = await import('/src/repositories/types.ts');
          const provider = {online:true,realtimeConnected:true,syncing:false,pending:0,held:false,cursor:'0',error:null,sharing:'active',credentialConfirmed:true,pullConfirmed:true};
          const save = {id:window.__sharedSession.active.localId,localRevision:'1',persistedRevision:'1',dirty:false,saving:false,error:null};
          if (state === 'saving') save.dirty = true;
          if (state.startsWith('pending')) provider.pending = 2;
          if (state === 'pending-saving') save.dirty = true;
          if (state === 'checking') provider.pullConfirmed = false;
          if (state === 'offline') provider.online = false;
          if (state === 'save-failed') save.error = new RepositoryError('IO_ERROR');
          if (['removed','ended','auth-required','membership-changed'].includes(state)) provider.sharing = state;
          if (state === 'recovery-required') provider.error = {kind:'server',code:'RECOVERY_CONFIRMATION_REQUIRED'};
          window.__sharedSession.store.set(sessionSnapshot(save.id,provider,save,null));
        },state);
        await capture(page,`status-${state}`,true);
      }
      checks.push('real toolbar: 12 deterministic status snapshots, 5 dimensions, text Range bounds and header containment');
    }
  } finally { if(context) await context.close(); if(mock) await mock.close(); await vite.close(); }
}
try {
  await run(false); await run(true);
  assert.deepEqual(errors,[]); assert.deepEqual(denied,[]);
  await writeFile(path.join(shotDir,'results.json'),JSON.stringify({checks,shots,bounds,productionNetwork:false},null,2));
  console.log('HELP_PAGE_BROWSER',JSON.stringify({checks,shotDir,screenshots:shots.length,productionNetwork:false}));
} finally { await browser.close(); }
