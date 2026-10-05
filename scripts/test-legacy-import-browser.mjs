import { round12Dimensions, checkRound12Layout } from './testing/round12-layout.mjs';
import assert from 'node:assert/strict';
import { chromium, expect } from '@playwright/test';
import { createServer } from 'vite';
import { mkdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { MockCollabBackend, startMockServer } from './testing/mock-collab-server.mjs';
import { loadCollabEdge } from './testing/load-collab-edge.mjs';
const origin='http://127.0.0.1:5195';
process.env.VITE_COLLABORATION_V2='1';
const vite=await createServer({envFile:false,server:{host:'127.0.0.1',port:5195,strictPort:true},logLevel:'warn'}); await vite.listen();
const {createHandler,RpcError}=await loadCollabEdge();
const backend=new MockCollabBackend(null,RpcError,{fresh:true}),server=await startMockServer(backend,createHandler,origin);
const browser=await chromium.launch({headless:true}), context=await browser.newContext({viewport:{width:744,height:1133}}), errors=[], requests=[], shots=[];
const fixture=JSON.parse(await readFile('supabase/tests/fixtures/legacy-export-v1.json','utf8'));
const shotDir = process.env.ROUND12_SHOT_DIR ?? (process.platform==='win32'?'C:/Users/shing/AppData/Local/Temp/claude/c--Users-shing-OneDrive--------ChatGPT-------/e5aa9c38-eb07-490c-ac06-62f047c4c161/scratchpad/shots-11b':path.join(process.cwd(),'.tmp-shots-11b'));
const dims = round12Dimensions;
await context.route('**/*',route=>{
 const url=new URL(route.request().url()); if(![origin,server.url].includes(url.origin) && !['data:','blob:'].includes(url.protocol))return route.abort();
 if(url.pathname.startsWith('/rest/'))requests.push(url.pathname);
 if(url.pathname==='/rest/v1/rpc/legacy_list_owned_projects')return route.fulfill({json:{contractVersion:1,items:[
  {projectId:fixture.project.id,title:'試験用旧隊列表',mode:'stage',schemaVersion:1,createdAt:fixture.project.created_at,hidden:false},
  {projectId:'11000000-0000-0000-0000-000000000002',title:'破損した試験文書',mode:'stage',schemaVersion:1,createdAt:fixture.project.created_at,hidden:false},
  {projectId:'11000000-0000-0000-0000-000000000003',title:'非表示の試験文書',mode:'stage',schemaVersion:1,createdAt:fixture.project.created_at,hidden:true}],nextCursor:null,exportUntil:'2026-11-04T00:00:00Z'}});
 if(url.pathname==='/rest/v1/rpc/legacy_export_project'){
  const id=route.request().postDataJSON().p_project_id, raw=structuredClone(fixture);raw.project.id=id;
  if(id.endsWith('2'))raw.scenes=[];return route.fulfill({json:raw});
 }
 return route.continue();
});
await context.addInitScript(config=>{window.__sharedSessionMock=config;},{url:server.url,anonKey:'synthetic-public'});
const capture=async(page,label)=>{await mkdir(shotDir,{recursive:true});for(const[width,height]of dims){await page.setViewportSize({width,height});
 await page.waitForTimeout(80);const dialog=page.getByRole('dialog');const bounds=await dialog.boundingBox();assert(bounds.x>=0&&bounds.x+bounds.width<=width+1);assert(bounds.y>=0&&bounds.y+bounds.height<=height+1);
 assert(await dialog.evaluate(el=>el.scrollWidth<=el.clientWidth+1),'dialog has no horizontal overflow');const file=`${label}-${width}x${height}.png`;await checkRound12Layout(page,label,'.collab-dialog, .legacy-rescue-dialog'); await page.screenshot({path:path.join(shotDir,file)});shots.push(file);}};
try {
 const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));await page.goto(origin);
 const checks=await page.evaluate(async()=>{const{runLegacyIndexedDbSuite}=await import('/src/legacyImport/testing/browserSuite.ts');return runLegacyIndexedDbSuite();});
 // Two actual pages, one DB and independent repository/importer owners.
 const second=await context.newPage();await second.goto(origin);const db=`11b-two-tabs-${Date.now()}`;
 for(const tab of[page,second])await tab.evaluate(async name=>{const{IndexedDbProjectRepository}=await import('/src/repositories/indexedDbRepository.ts');const{testImporter,fixtureRow}=await import('/src/legacyImport/testing/browserSuite.ts');window.repo11b=new IndexedDbProjectRepository({dbName:name});await window.repo11b.initialize();window.import11b=()=>testImporter(window.repo11b).importOne(fixtureRow);},db);
 const outcomes=await Promise.all([page,second].map(tab=>tab.evaluate(()=>window.import11b())));assert(outcomes.every(r=>['imported','already'].includes(r.status)));assert.equal(new Set(outcomes.map(r=>r.targetId)).size,1);
 assert.equal(await page.evaluate(async()=>(await window.repo11b.list({limit:100})).items.length),1);for(const tab of[page,second])await tab.evaluate(()=>window.repo11b.close());await second.close();checks.push('two actual tabs create only one independent target');
 await page.getByRole('button',{name:'ログイン / 新規登録',exact:true}).click();
 await page.getByLabel('メールアドレス',{exact:true}).fill('session-test@example.invalid');await page.getByLabel('パスワード',{exact:true}).fill('mock-pass');
 await page.getByRole('button',{name:'ログイン',exact:true}).click();await expect(page.getByRole('button',{name:'ログアウト',exact:true})).toBeVisible();
 await page.getByRole('button',{name:'旧クラウドの隊列表を取り込む',exact:true}).last().click();const dialog=page.getByRole('dialog');
 await dialog.getByRole('button',{name:'一覧を取得',exact:true}).click();await expect(dialog.getByText('試験用旧隊列表',{exact:true})).toBeVisible();
 await dialog.locator('summary').click();await expect(dialog.getByRole('checkbox').last()).not.toBeChecked();await dialog.locator('summary').click();
 let release;const held=new Promise(resolve=>release=resolve);let first=true;
 await page.route('**/rest/v1/rpc/legacy_export_project',async route=>{if(!first)return route.fallback();first=false;await held;return route.fallback().catch(()=>{});});
 await dialog.getByRole('button',{name:'選んだ隊列表を取り込む / 再開',exact:true}).click();await dialog.getByRole('button',{name:'中断',exact:true}).click();release();
 await expect(dialog.getByText('中断しました。再開できます。',{exact:true})).toBeVisible();
 await expect(dialog.getByText(/まで）/)).toBeVisible();await dialog.getByRole('button',{name:'選んだ隊列表を取り込む / 再開',exact:true}).click();await expect(dialog.getByText('保存しました',{exact:true})).toBeVisible();checks.push('UI interruption/resume and hidden candidates stay unselected');
 await expect(dialog.getByText('取り込めなかった隊列表',{exact:true})).toBeVisible();await expect(dialog.getByText('一部のシーンが欠けているため取り込めませんでした。元のデータはそのままです。',{exact:true})).toBeVisible();
 const detail=dialog.getByText('scenes: sceneOrderが参照するsceneが欠けています',{exact:true});await expect(detail).toBeHidden();
 await dialog.getByText('詳しい理由',{exact:true}).click();await expect(detail).toBeVisible();await dialog.getByText('詳しい理由',{exact:true}).click();
 await capture(page,'import');
 await page.route('**/rest/v1/rpc/legacy_export_project',route=>{
  if(route.request().postDataJSON().p_project_id!==fixture.project.id)return route.fallback();
  const raw=structuredClone(fixture);raw.project.title='別内容の試験用旧隊列表';return route.fulfill({json:raw});
 });
 await dialog.getByRole('button',{name:'選んだ隊列表を取り込む / 再開',exact:true}).click();
 const changed=dialog.getByRole('button',{name:'変更された内容を別の独立コピーとして救出',exact:true});await expect(changed).toBeVisible();
 const changedCount=()=>page.evaluate(async()=>{const{IndexedDbProjectRepository}=await import('/src/repositories/indexedDbRepository.ts');const r=new IndexedDbProjectRepository();try{return(await r.list({limit:100})).items.filter(x=>x.title==='別内容の試験用旧隊列表').length;}finally{r.close();}});
 assert.equal(await changedCount(),0);await changed.click();await expect(dialog.getByText('保存しました',{exact:true})).toBeVisible();assert.equal(await changedCount(),1);checks.push('changed successful source stays quarantined until explicit independent rescue');
 await page.getByRole('button',{name:'救出画面を閉じる',exact:true}).click();await page.getByRole('button',{name:'ログアウト',exact:true}).click();
 await page.evaluate(async()=>{
  const{snapshotProject,validateSnapshot}=await import('/src/legacyImport/validation.ts');const{default:fixture}=await import('/supabase/tests/fixtures/legacy-export-v1.json');
  const project=snapshotProject(validateSnapshot(fixture,fixture.project.id),'synthetic-draft');project.title='試験用旧下書き';const raw=JSON.stringify({project,cloudProjectId:'old',baseUpdatedAt:null,savedAt:project.updatedAt});
  window.__legacyDraftReaders={local:()=>({getItem:()=>null}),native:{
    draftNames:async()=>['old.json','old.pending.json','old.backup.json','bad.json','denied.json'],
    readText:async path=>{if(path.includes('denied'))throw Object.assign(new Error(),{name:'NotAllowedError'});return path.includes('bad')?'{':path.startsWith('personal-cloud-drafts/')?raw:null;}}};
 });
 await page.getByRole('button',{name:'この端末に残っている旧クラウドの下書き',exact:true}).last().click();await expect(dialog.getByRole('heading',{name:'旧クラウドの下書き',exact:true})).toBeVisible();await dialog.getByRole('button',{name:'端末の下書きを調べる',exact:true}).click();
 await expect(dialog.getByText('読取りが拒否されました。',{exact:true})).toBeVisible();await expect(dialog.getByText('破損しているため読めません。',{exact:true})).toBeVisible();
 await dialog.getByRole('button',{name:'この下書きを独立コピーとして救出',exact:true}).first().click();await expect(dialog.getByText('独立コピーを保存しました。元ファイルは残っています。',{exact:true})).toBeVisible();for(const label of ['通常の下書き','保存途中の下書き','予備の下書き'])await expect(dialog.getByText(label,{exact:false}).last()).toBeVisible();
 await expect(dialog.getByText('old.pending.json',{exact:true})).toBeHidden();
 await dialog.locator('li').filter({hasText:'保存途中の下書き'}).locator('summary').click();await expect(dialog.getByText('old.pending.json',{exact:true})).toBeVisible();
 await capture(page,'draft');
 await page.evaluate(()=>{delete window.__legacyDraftReaders;});
 await page.getByRole('button',{name:'救出画面を閉じる',exact:true}).click();
 // Expired backend denial is shown, without disabling local draft rescue.
 await context.route('**/rest/v1/rpc/legacy_list_owned_projects',route=>route.fulfill({status:403,json:{message:'LEGACY_EXPORT_EXPIRED'}}));
 await page.evaluate(async()=>{const{saveCloudAuthSession}=await import('/src/cloud/session.ts');saveCloudAuthSession({accessToken:'synthetic-fixture-token',refreshToken:'synthetic-refresh',expiresAt:Date.now()+3600000,tokenType:'bearer',user:{id:'11000000-0000-0000-0001-000000000001',email:'fixture@example.invalid'}});});
 await page.getByRole('button',{name:'旧クラウドの隊列表を取り込む',exact:true}).last().click();await dialog.getByRole('button',{name:'一覧を取得',exact:true}).click();await expect(dialog.getByText(/取り込み期限が終了しました/)).toBeVisible();checks.push('deadline denial and signed-out draft UI');
 assert.equal(errors.length,0,errors.join('\n'));assert(requests.every(p=>p.includes('legacy_list_owned_projects')||p.includes('legacy_export_project')||p.includes('/rpc/collab_v2_')),'no removed document API calls');
 console.log('LEGACY_IMPORT_BROWSER',JSON.stringify({checks,shots,requests,errors}));
} finally {await context.close();await browser.close();await server.close();await vite.close();}
