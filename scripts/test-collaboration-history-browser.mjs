import { round12Dimensions, checkRound12Layout } from './testing/round12-layout.mjs';
import assert from 'node:assert/strict';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { chromium, expect } from '@playwright/test';
import { createServer } from 'vite';
import { MockHistoryBackend } from './testing/mock-history-backend.mjs';
import { startMockServer, actors, memberships, documentId } from './testing/mock-collab-server.mjs';
import { loadCollabRuntime } from './testing/load-collab-runtime.mjs';

const origin='http://127.0.0.1:5190';process.env.VITE_COLLABORATION_V2='1';
const loaded=await loadCollabRuntime();
const {createHandler,RpcError}=await loaded.loadSource('supabase/functions/collab-ingest/handler.ts');
const {createMaintenanceHandler}=await loaded.loadSource('supabase/functions/collab-maintenance/handler.ts');
const {createRestoreHandler}=await loaded.loadSource('supabase/functions/collab-restore/handler.ts');
const backend=new MockHistoryBackend(null,RpcError);backend.users.get(actors[1]).is_anonymous=true;
backend.details.set(actors[0],{displayName:'試験作成者',isGuest:false});backend.details.set(actors[1],{displayName:'試験ゲスト',isGuest:true});
const server=await startMockServer(backend,createHandler,origin,{maintenance:createMaintenanceHandler(backend,[origin],()=>{}),restore:createRestoreHandler(backend,[origin],()=>{})});
const vite=await createServer({envFile:false,server:{host:'127.0.0.1',port:5190,strictPort:true},logLevel:'warn'});await vite.listen();
const browser=await chromium.launch({headless:true}),contexts=[],pages=[],errors=[],denied=[],legacy=[],checks=[],shots=[],bounds=[];
const fixture=JSON.parse(await readFile('src/repositories/contract/fixtures/commitProjects.json','utf8')).stage;
const shotDir = process.env.ROUND12_SHOT_DIR ?? (process.platform==='win32'?'C:/Users/shing/AppData/Local/Temp/claude/c--Users-shing-OneDrive--------ChatGPT-------/e5aa9c38-eb07-490c-ac06-62f047c4c161/scratchpad/shots-9d':path.resolve('.tmp-shots-9d'));
const dims = round12Dimensions;
const title=p=>p.getByRole('textbox',{name:'隊列表名',exact:true}),dialog=p=>p.getByRole('dialog',{name:'みんなで編集',exact:true}),panel=p=>p.getByRole('region',{name:'控え（履歴）',exact:true});
const row=(p,id)=>p.locator(`[data-checkpoint-id="${id}"]`);
const manage=async p=>{await p.getByRole('button',{name:'共有と書き出し',exact:true}).click();await p.getByRole('button',{name:/みんなで編集/}).click();await expect(panel(p)).toBeVisible();};
const close=p=>p.getByRole('button',{name:'共同編集画面を閉じる',exact:true}).click();
const list=async p=>{
  // Resume can briefly remount the panel / disable its refresh button while
  // checking the durable journal. Retry only this read-only list operation.
  await expect(async()=>{
    await panel(p).getByRole('button',{name:/控えを見る|控えの一覧を更新/}).click({timeout:1500});
    await expect(panel(p).locator('li').first()).toBeVisible({timeout:750});
  }).toPass({timeout:10000});
};
const action=async(p,id,name)=>{const item=row(p,id),toggle=item.locator('.collab-history-row');if(await toggle.getAttribute('aria-expanded')!=='true')await toggle.click();return item.getByRole('button',{name,exact:true});};
const read=p=>p.evaluate(async()=>{const {IndexedDbProjectRepository}=await import('/src/repositories/indexedDbRepository.ts');const r=new IndexedDbProjectRepository();await r.initialize();try{return await r.get('project_a');}finally{r.close();}});
const openShared=async(p,name)=>{const cards=p.getByRole('button',{name:`${name}を開く`,exact:true});await cards.filter({has:p.locator('.formation-card__badge').filter({hasText:/共有中|クラウド保存/})}).click();await expect(title(p)).toHaveValue(name);};
async function capture(p,label,focus) {
  await mkdir(shotDir,{recursive:true});
  for(const [width,height] of dims){await p.setViewportSize({width,height});await focus?.();await p.waitForTimeout(100);
    const rects=await Promise.all(['隊列一覧へ戻る','共有と書き出し'].map(async name=>({name,...await p.getByRole('button',{name,exact:true}).boundingBox()})));
    for(const r of rects)assert(r.x>=0&&r.y>=0&&r.x+r.width<=width&&r.y+r.height<=height,JSON.stringify({label,width,height,r}));
    const overflow=await dialog(p).evaluate(el=>el.scrollWidth>el.clientWidth||el.querySelector('.collab-dialog-body').scrollWidth>el.querySelector('.collab-dialog-body').clientWidth);
    assert(!overflow,`${label} ${width}x${height} horizontal overflow`);
    const name=`${label}-${width}x${height}.png`;await checkRound12Layout(p,label,'.collab-dialog, .legacy-rescue-dialog'); await p.screenshot({path:path.join(shotDir,name)});shots.push(name);bounds.push({label,width,height,controls:rects});
  }
  await p.setViewportSize({width:1133,height:744});
}
try {
  let data;const audio=[];
  for(let i=0;i<2;i++){
    const context=await browser.newContext({viewport:{width:1133,height:744}});contexts.push(context);await context.grantPermissions(['local-network-access'],{origin});
    await context.addInitScript(config=>{window.__sharedSessionMock=config;},{url:server.url,anonKey:'mock-public-key'});
    await context.route('**/*',route=>{const u=new URL(route.request().url());
      if(![origin,server.url].includes(u.origin)&&!['data:','blob:'].includes(u.protocol)){denied.push(u.origin);return route.abort();}
      if(u.origin===server.url&&u.pathname.startsWith('/rest/v1/')&&!u.pathname.split('/').at(-1).startsWith('collab_v2_'))legacy.push(u.pathname);
      if(u.href===`${origin}/__seed__`)return route.fulfill({contentType:'text/html',body:'<!doctype html><title>History test</title>'});return route.continue();});
    const p=await context.newPage();pages.push(p);p.on('pageerror',e=>errors.push(e.message));await p.goto(`${origin}/__seed__`);
    const seed=await p.evaluate(async({fixture,data,actor,membership,documentId,i})=>{
      const {IndexedDbProjectRepository}=await import('/src/repositories/indexedDbRepository.ts'),{createSharedDocument}=await import('/src/collaboration/model.ts'),{createCollaborationData}=await import('/src/collaboration/persistence.ts'),{saveCloudAuthSession}=await import('/src/cloud/session.ts'),{saveAudioBlobToIndexedDb}=await import('/src/utils/audioStorage.ts');
      saveCloudAuthSession({accessToken:actor,refreshToken:'mock-refresh',tokenType:'bearer',expiresAt:Date.now()+3600000,user:{id:actor,displayName:i?'試験ゲスト':'試験作成者'},...(i?{collaborationGuest:true}:{})});
      const audio=await saveAudioBlobToIndexedDb(new Blob([new Uint8Array(16044)],{type:'audio/wav'}),{name:'試験曲.wav',type:'audio/wav',duration:1});
      const project={...fixture,title:'控えの画面試験',audio};if(!data){const doc=createSharedDocument(project);data=createCollaborationData(doc);doc.destroy();}
      const {id:_id,...song}=audio;data={...data,schemaVersion:2,sharedDocumentId:documentId,transportBinding:{accountId:actor,membershipGeneration:membership},audioBindings:[{song,audio}]};
      const r=new IndexedDbProjectRepository();await r.initialize();await r.commit({project,collaboration:data,localRevision:'1',expectedRepositoryRevision:null,operationId:crypto.randomUUID()});r.close();return{data,audio};
    },{fixture,data,actor:actors[i],membership:memberships[i],documentId,i});data=seed.data;audio.push(seed.audio);
    if(!i)backend.base=data.base;
    await p.goto(origin);await openShared(p,'控えの画面試験');
  }
  const [a,b]=pages;await expect(a.locator('.collab-status-pill')).toHaveText('同期済み');await expect(b.locator('.collab-status-pill')).toHaveText('同期済み');
  await manage(a);await panel(a).getByRole('button',{name:'控えを残す',exact:true}).click();await expect(panel(a).getByText('控えを残しました。共有に届いている内容が対象です。')).toBeVisible();
  const target=backend.checkpoints[0];
  for(let i=0;i<18;i++)backend.checkpoints.push({...structuredClone(target),id:randomUUID(),reason:'automatic',requestedBy:null,serverAt:new Date(Date.now()-60000-i*1000).toISOString()});
  await list(a);await expect(panel(a).locator('li')).toHaveCount(16);await panel(a).getByRole('button',{name:'控えの続きを読み込む'}).click();await expect(panel(a).locator('li')).toHaveCount(19);
  await expect(panel(a).getByRole('button',{name:'新しい隊列表として開く',exact:true})).toHaveCount(0);
  await expect(panel(a)).not.toContainText('自動 ·');
  await capture(a,'history-list',()=>row(a,target.id).scrollIntoViewIfNeeded());
  const toggle=row(a,target.id).locator('.collab-history-row');await toggle.focus();await a.keyboard.press('Enter');await expect(toggle).toHaveAttribute('aria-expanded','true');
  await capture(a,'history-actions',()=>row(a,target.id).scrollIntoViewIfNeeded());
  await (await action(a,backend.checkpoints[1].id,'新しい隊列表として開く')).isVisible();await expect(toggle).toHaveAttribute('aria-expanded','false');
  await (await action(a,target.id,'共有中の隊列表をこの状態に戻す')).click();await a.getByRole('group',{name:'共有中の隊列表を戻す確認'}).getByRole('button',{name:'キャンセル',exact:true}).click();assert.equal(backend.restorePublications,0);checks.push('manual, newest-first pagination, automatic author and plain Japanese reasons');
  backend.manualRateLimit=true;await panel(a).getByRole('button',{name:'控えを残す',exact:true}).click();await expect(panel(a).getByRole('alert')).toContainText('時間をおいて');assert.equal(backend.checkpoints.length,19);backend.manualRateLimit=false;
  backend.checkpointCapacity=true;await panel(a).getByRole('button',{name:'控えを残す',exact:true}).click();await expect(panel(a).getByRole('alert')).toContainText('容量がいっぱい');backend.checkpointCapacity=false;await close(a);
  await title(a).fill('戻す前の状態');await a.locator('.toolbar-save-button').click();await expect(title(b)).toHaveValue('戻す前の状態');
  await manage(b);await list(b);assert.equal(await panel(b).getByRole('button',{name:'控えを削除',exact:true}).count(),0);
  await (await action(b,target.id,'新しい隊列表として開く')).click();await expect(dialog(b)).toHaveCount(0);await expect(title(b)).toHaveValue('控えの画面試験');
  const independent=await b.evaluate(async()=>{const {IndexedDbProjectRepository}=await import('/src/repositories/indexedDbRepository.ts');const r=new IndexedDbProjectRepository();await r.initialize();try{const page=await r.list({limit:100});for(const summary of page.items){if(summary.id!=='project_a'){const record=await r.get(summary.id);if(record?.project.title==='控えの画面試験')return record;}}}finally{r.close();}});
  assert(independent&&!independent.collaboration&&!independent.sync);assert.equal(independent.project.audio.id,audio[1].id);assert.equal((await read(b)).project.title,'戻す前の状態');
  await b.getByRole('button',{name:'隊列一覧へ戻る',exact:true}).click();await openShared(b,'戻す前の状態');checks.push('guest independent copy strips shared eligibility and resolves its own device song, source retained');
  await manage(a);await list(a);await (await action(a,target.id,'共有中の隊列表をこの状態に戻す')).click();
  const confirmation=a.getByRole('group',{name:'共有中の隊列表を戻す確認'});await expect(confirmation).toContainText('全員の画面に反映');await capture(a,'history-confirm',()=>confirmation.scrollIntoViewIfNeeded());
  const previousCursor=(await read(a)).collaboration.serverCursor;
  await a.evaluate(async cut=>{const {IndexedDbProjectRepository}=await import('/src/repositories/indexedDbRepository.ts'),{RepositoryError}=await import('/src/repositories/types.ts');
    const original=IndexedDbProjectRepository.prototype.commit;window.blockRestoreSave=true;
    IndexedDbProjectRepository.prototype.commit=function(request){if(window.blockRestoreSave&&request.project.id==='project_a'&&request.collaboration&&BigInt(request.collaboration.serverCursor)>BigInt(cut))return Promise.reject(new RepositoryError('IO_ERROR'));return original.call(this,request);};},previousCursor);
  backend.delayRestoreMs=700;await confirmation.getByRole('button',{name:'全員の隊列表を戻す',exact:true}).click();await expect(panel(a).getByText('受け付けました',{exact:true})).toBeVisible();
  await expect(title(b)).toHaveValue('控えの画面試験');await expect(panel(a).getByText('共有に反映しました',{exact:true})).toBeVisible();
  assert.equal((await read(a)).collaboration.serverCursor,previousCursor);assert.equal(backend.confirmations.length,0);
  await a.evaluate(()=>{window.blockRestoreSave=false;});await close(a);await a.getByRole('button',{name:'保存を再試行',exact:true}).click();await manage(a);
  await expect(panel(a).getByText('この端末に反映しました',{exact:true})).toBeVisible();await expect.poll(()=>backend.confirmations.length).toBe(1);
  assert.equal(backend.restorePublications,1);await list(a);await expect(panel(a).getByText('戻す直前の控え',{exact:false}).first()).toBeVisible();
  await capture(a,'history-result',()=>panel(a).locator('.collab-history-result').scrollIntoViewIfNeeded());checks.push('accepted, shared commit, durable device application and pre-restore checkpoint');
  backend.delayRestoreMs=0;await title(b).fill('その後の共同編集');await b.locator('.toolbar-save-button').click();await expect(title(a)).toHaveValue('その後の共同編集');
  await expect(panel(a).getByText('その後の共同編集により、指定した状態と異なる項目があります',{exact:true})).toBeVisible();
  await capture(a,'history-difference',()=>panel(a).locator('.collab-history-result').scrollIntoViewIfNeeded());
  await a.reload();await openShared(a,'その後の共同編集');await manage(a);await expect(panel(a).getByText('この端末に反映しました',{exact:true})).toBeVisible();assert.equal(backend.restorePublications,1);
  checks.push('later concurrent edits distinguished, confirmed restart never replays restore');
  // Response loss + offline + reload while an unconfirmed request is recorded.
  await list(a);await (await action(a,target.id,'共有中の隊列表をこの状態に戻す')).click();backend.loseRestoreReply=true;backend.restoreResultUnavailable=true;
  await a.getByRole('group',{name:'共有中の隊列表を戻す確認'}).getByRole('button',{name:'全員の隊列表を戻す',exact:true}).click();
  await expect.poll(()=>backend.restorePublications).toBe(2);await expect(panel(a).getByRole('alert')).toBeVisible();
  await contexts[0].route(`${server.url}/**`,route=>route.abort());await a.reload();await openShared(a,(await read(a)).project.title);await contexts[0].unroute(`${server.url}/**`);
  await a.evaluate(()=>window.__sharedSession.active.provider.wake());await manage(a);await expect(panel(a).getByRole('button',{name:'戻す操作の結果を確認'})).toBeEnabled();backend.restoreResultUnavailable=false;await panel(a).getByRole('button',{name:'戻す操作の結果を確認'}).click();
  await expect(panel(a).getByText('この端末に反映しました',{exact:true})).toBeVisible();assert.equal(backend.restorePublications,2);assert.equal(backend.restores.size,2);
  checks.push('lost committed reply across offline/reload retains request ID and publishes once');
  const other=backend.checkpoints.find(c=>c.id!==target.id&&c.reason==='automatic');
  const tooLargeRoute=route=>{if(route.request().postDataJSON().action==='restore')return route.fulfill({status:413,contentType:'application/json',body:JSON.stringify({error:'RESTORE_UPDATE_TOO_LARGE'})});return route.continue();};
  await contexts[0].route(`${server.url}/functions/v1/collab-restore`,tooLargeRoute);
  await list(a);await (await action(a,other.id,'共有中の隊列表をこの状態に戻す')).click();await a.getByRole('group',{name:'共有中の隊列表を戻す確認'}).getByRole('button',{name:'全員の隊列表を戻す',exact:true}).click();
  await expect(panel(a).getByRole('alert')).toContainText('新しい隊列表として開く');assert.equal(backend.restorePublications,2);
  await expect(await action(a,target.id,'共有中の隊列表をこの状態に戻す')).toBeEnabled();
  await contexts[0].unroute(`${server.url}/functions/v1/collab-restore`,tooLargeRoute);
  backend.due={cut:backend.head,generation:backend.generation};backend.checkpointCapacity=true;await a.evaluate(()=>window.__sharedSession.active.provider.wake());
  await expect(panel(a).getByText('容量がいっぱいのため、自動で控えを残す処理を延期しています。編集内容は端末に残っています。')).toBeVisible();
  backend.checkpointCapacity=false;await expect.poll(()=>backend.due,{timeout:20000}).toBeNull();
  await expect(panel(a).getByText('容量がいっぱいのため、自動で控えを残す処理を延期しています。編集内容は端末に残っています。')).toHaveCount(0);
  checks.push('durable save failure withholds applied/confirm; oversized restore guides copy without publication; deferred automatic checkpoint resumes');
  // Actual IDB operation CAS, corruption isolation and creator-only deletion.
  await a.evaluate(async()=>{const {indexedHistoryJournal:j}=await import('/src/collaboration/historyJournal.ts');const value={version:1,revision:1,copy:{checkpointId:crypto.randomUUID(),request:{},message:'test',saved:false}};
    const results=await Promise.allSettled([j.write('cas-test',0,value),j.write('cas-test',0,value)]);if(results.filter(r=>r.status==='fulfilled').length!==1)throw Error('journal CAS');
    const db=await new Promise(resolve=>{const q=indexedDB.open('tairetsu-collaboration-operations',1);q.onsuccess=()=>resolve(q.result);});await new Promise(resolve=>{const tx=db.transaction('operations','readwrite');tx.objectStore('operations').put({version:99},'broken-other');tx.oncomplete=resolve;});db.close();
    if(!(await j.read('cas-test')))throw Error('unrelated corrupt row blocked read');});
  await list(a);target.protected=true;backend.checkpoints.find(c=>c.id===target.id).protected=true;
  await (await action(a,target.id,'控えを削除')).click();await a.getByRole('group',{name:'控えを削除する確認'}).getByRole('button',{name:'控えを削除する',exact:true}).click();await expect(panel(a).getByRole('alert')).toContainText('戻す処理で使われている');
  backend.checkpoints.find(c=>c.id===target.id).protected=false;await (await action(a,target.id,'控えを削除')).click();await a.getByRole('group',{name:'控えを削除する確認'}).getByRole('button',{name:'控えを削除する',exact:true}).click();await expect(row(a,target.id)).toHaveCount(0);
  await close(a);await a.getByRole('button',{name:'隊列一覧へ戻る',exact:true}).click();
  const recoveryTitle=await a.evaluate(async()=>{const {IndexedDbProjectRepository}=await import('/src/repositories/indexedDbRepository.ts'),{incrementRevision}=await import('/src/repositories/types.ts');const r=new IndexedDbProjectRepository();await r.initialize();try{const record=await r.get('project_a');await r.commit({project:record.project,collaboration:{...record.collaboration,recoveryRequired:true},localRevision:incrementRevision(record.localRevision),expectedRepositoryRevision:record.repositoryRevision,operationId:crypto.randomUUID()});return record.project.title;}finally{r.close();}});
  await openShared(a,recoveryTitle);await manage(a);await expect(panel(a).getByText('この端末は以前の保存から復旧したため、編集の送信を保留しています。編集内容を残して、共有との再同期と確認が必要です。')).toBeVisible();
  await capture(a,'history-recovery',()=>panel(a).getByRole('heading',{name:'控え（履歴）'}).scrollIntoViewIfNeeded());
  backend.members.delete(actors[1]);backend.departures.set(actors[1],'removed');
  const deniedHistory=await b.evaluate(async({url,actor,id})=>{const result=await fetch(`${url}/rest/v1/rpc/collab_v2_get_checkpoint`,{method:'POST',headers:{Authorization:`Bearer ${actor}`,'Content-Type':'application/json'},body:JSON.stringify({p_document:id,p_checkpoint:crypto.randomUUID()})});return result.status;},{url:server.url,actor:actors[1],id:documentId});assert.equal(deniedHistory,403);
  checks.push('actual IDB CAS and row isolation; only creator delete, protected message, removed guest cannot retrieve');
  assert.equal(backend.restorePublications,2,'definitively rejected restore must not resume on restart');
  assert.deepEqual(errors,[]);assert.deepEqual(denied,[]);assert.deepEqual(legacy,[]);await writeFile(path.join(shotDir,'bounds.json'),JSON.stringify(bounds,null,2));
  console.log('COLLABORATION_HISTORY_BROWSER',JSON.stringify({checks,shots,shotDir,restorePublications:backend.restorePublications,productionNetwork:false,mainControlsInViewport:true}));
} catch(e){console.error('HISTORY_FAILURE',JSON.stringify({errors,denied,head:backend.head,publications:backend.restorePublications,
  states:await Promise.all(pages.map(p=>p.evaluate(()=>{const ui=window.__sharedSession?.active?.historyUi?.getSnapshot();return {provider:window.__sharedSession?.active?.provider?.snapshot,history:{phase:ui?.restore?.phase,error:ui?.error,busy:ui?.busy,retry:ui?.retry}};}))),
  alerts:await Promise.all(pages.map(p=>p.getByRole('alert').allTextContents()))}));throw e;}
finally{await Promise.all(contexts.map(c=>c.close()));await browser.close();await server.close();await vite.close();await loaded.dispose();}
