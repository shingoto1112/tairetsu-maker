import { round12Dimensions, checkRound12Layout } from './testing/round12-layout.mjs';
import assert from 'node:assert/strict';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { chromium, expect } from '@playwright/test';
import { createServer } from 'vite';
import { MockCollabBackend, startMockServer, actors, memberships, documentId } from './testing/mock-collab-server.mjs';
import { loadCollabEdge } from './testing/load-collab-edge.mjs';

// Actual App, two isolated devices, synthetic WAV, loopback-only network.
const origin = 'http://127.0.0.1:5186';
process.env.VITE_COLLABORATION_V2 = '1';
const vite = await createServer({ envFile: false, server: { host: '127.0.0.1', port: 5186, strictPort: true }, logLevel: 'warn' });
await vite.listen();
const { createHandler, RpcError } = await loadCollabEdge();
const backend = new MockCollabBackend(null, RpcError), server = await startMockServer(backend, createHandler, origin);
const browser = await chromium.launch({ headless: true }), contexts = [], pages = [], errors = [], denied = [], legacy = [], checks = [], shots = [], bounds = [];
const shotDir = process.env.ROUND12_SHOT_DIR ?? (process.platform === 'win32' ? 'C:/Users/shing/AppData/Local/Temp/claude/c--Users-shing-OneDrive--------ChatGPT-------/e5aa9c38-eb07-490c-ac06-62f047c4c161/scratchpad/shots-8b' : path.resolve('.tmp-shots-8b'));
const fixture = JSON.parse(await readFile('src/repositories/contract/fixtures/commitProjects.json', 'utf8')).stage;
const dims = round12Dimensions;
const wav = seconds => {
  const n = 8000 * seconds, bytes = Buffer.alloc(44 + n * 2);
  bytes.write('RIFF'); bytes.writeUInt32LE(bytes.length - 8, 4); bytes.write('WAVEfmt ', 8); bytes.writeUInt32LE(16, 16);
  bytes.writeUInt16LE(1, 20); bytes.writeUInt16LE(1, 22); bytes.writeUInt32LE(8000, 24); bytes.writeUInt32LE(16000, 28);
  bytes.writeUInt16LE(2, 32); bytes.writeUInt16LE(16, 34); bytes.write('data', 36); bytes.writeUInt32LE(n * 2, 40); return bytes;
};
const file1 = { name: 'common-1.wav', mimeType: 'audio/wav', buffer: wav(1) }, file2 = { name: 'common-2.wav', mimeType: 'audio/wav', buffer: wav(2) };
const title = page => page.getByRole('textbox', {name:'隊列表名',exact:true});
const panel = page => page.locator('.audio-panel');
const read = page => page.evaluate(async () => {
  const { IndexedDbProjectRepository } = await import('/src/repositories/indexedDbRepository.ts');
  const repo = new IndexedDbProjectRepository(); await repo.initialize(); try { return await repo.get('project_a'); } finally { repo.close(); }
});
const save = page => page.locator('.toolbar-save-button').click();
const state = page => page.evaluate(() => ({ song: window.__sharedSession.active.song, audio: window.__sharedSession.active.editor.project.audio }));
const open = async page => {
  const cards=page.getByRole('button', {name:'端末音源の試験を開く',exact:true});
  if(await cards.count()>1)await cards.filter({has:page.locator('.formation-card__badge').filter({hasText:/共有中|クラウド保存/})}).click();else await cards.click();
  await expect(title(page)).toHaveValue('端末音源の試験');await expect.poll(()=>page.evaluate(()=>!!window.__sharedSession.active)).toBe(true);
};
const audioTab = async page => { await page.getByRole('tab', {name:'音源',exact:true}).click(); await expect(panel(page)).toBeVisible(); };
const change = async (page, file) => { await panel(page).locator('label').filter({hasText:'曲を変更（全員に反映）'}).locator('input[type=file]').setInputFiles(file); await expect(panel(page).getByText(file.name,{exact:true})).toBeVisible(); await save(page); };
async function capture(page, label) {
  await mkdir(shotDir, {recursive:true});
  for (const [width,height] of dims) {
    await page.setViewportSize({width,height}); await page.waitForTimeout(150);
    if(width<height) {
      const handle=page.getByRole('separator',{name:'編集パネルの高さ',exact:true});await handle.focus();await handle.press('End');
      await expect(panel(page).locator('.shared-audio-controls [role=status]')).toBeVisible();
    }
    const status = page.locator('.collab-status-pill');
    const detail = await status.evaluate(el => { const r=el.getBoundingClientRect(),range=document.createRange();range.selectNodeContents(el);const text=range.getBoundingClientRect();return {label:el.textContent,x:r.x,y:r.y,right:r.right,bottom:r.bottom,width:r.width,height:r.height,scrollWidth:el.scrollWidth,clientWidth:el.clientWidth,textRight:text.right,textBottom:text.bottom}; });
    assert(detail.scrollWidth<=detail.clientWidth && detail.right<=width && detail.bottom<=height && detail.textRight<=detail.right+1 && detail.textBottom<=detail.bottom+1, JSON.stringify(detail));
    bounds.push({screen:label,width,height,status:detail});
    const name=`${label}-${width}x${height}.png`;await checkRound12Layout(page,label,'.toolbar'); await checkRound12Layout(page,`${label}-panel`,'.audio-panel'); await page.screenshot({path:path.join(shotDir,name)});shots.push(name);
  }
}
try {
  let data, deviceMusic;
  for (let i=0;i<2;i++) {
    const context=await browser.newContext({viewport:{width:1133,height:744}});contexts.push(context);
    await context.grantPermissions(['local-network-access'],{origin});
    await context.addInitScript(config=>{window.__sharedSessionMock=config;},{url:server.url,anonKey:'mock-public-key'});
    await context.route('**/*',route=>{
      const url=new URL(route.request().url());
      if (![origin,server.url].includes(url.origin) && !['data:','blob:'].includes(url.protocol)) {denied.push(url.origin);return route.abort();}
      if (url.origin===server.url && url.pathname.startsWith('/rest/v1/') && !url.pathname.split('/').at(-1).startsWith('collab_v2_')) legacy.push(url.pathname);
      if (url.href===`${origin}/__seed__`) return route.fulfill({contentType:'text/html',body:'<!doctype html><title>Audio test setup</title>'});
      return route.continue();
    });
    const page=await context.newPage();pages.push(page);page.on('pageerror',e=>errors.push(e.message));await page.goto(`${origin}/__seed__`);
    const seed=await page.evaluate(async ({fixture,data,actor,membership,documentId,bytes1,bytes2,i})=>{
      const {IndexedDbProjectRepository}=await import('/src/repositories/indexedDbRepository.ts');
      const {createSharedDocument}=await import('/src/collaboration/model.ts'); const {createCollaborationData}=await import('/src/collaboration/persistence.ts');
      const {saveCloudAuthSession}=await import('/src/cloud/session.ts'); const {saveAudioBlobToIndexedDb}=await import('/src/utils/audioStorage.ts');
      saveCloudAuthSession({accessToken:actor,refreshToken:'mock-refresh',tokenType:'bearer',expiresAt:Date.now()+3600000,user:{id:actor,email:'audio-test@example.invalid'}});
      const repository=new IndexedDbProjectRepository();await repository.initialize(); const project={...fixture,title:'端末音源の試験',audio:null};
      if (!data) {const doc=createSharedDocument(project);data=createCollaborationData(doc);doc.destroy();}
      data={...data,sharedDocumentId:documentId,transportBinding:{accountId:actor,membershipGeneration:membership}};
      await repository.commit({project,collaboration:data,localRevision:'1',expectedRepositoryRevision:null,operationId:crypto.randomUUID()});repository.close();
      if(i) {
        const store=(bytes,name,duration)=>saveAudioBlobToIndexedDb(new Blob([Uint8Array.from(bytes)],{type:'audio/wav'}),{name,type:'audio/wav',duration});
        window.testAudio1=await store(bytes1,'common-1.wav',1);
        window.testAudio2a=await store(bytes2,'common-2.wav',2);window.testAudio2b=await store(bytes2,'common-2.wav',2);
        window.testAlternate=await store(bytes1,'device-encoding.wav',1);
      }
      return {data,music:i ? [window.testAudio1,window.testAudio2a,window.testAudio2b,window.testAlternate] : []};
    },{fixture,data,actor:actors[i],membership:memberships[i],documentId,bytes1:[...file1.buffer],bytes2:[...file2.buffer],i});
    data=seed.data;if(i)deviceMusic=seed.music;
    if(!i){backend.base=data.base;backend.generation=data.generation;}
    await page.goto(`${origin}/?runtime=capacitor-ios`);await open(page);await audioTab(page);
    await expect(page.getByText('共同作業の使い方',{exact:true})).toHaveCount(0);
  }
  const [a,b]=pages;
  await change(a,file1);
  await expect.poll(async()=>(await state(b)).audio?.id).toBe(deviceMusic[0].id);
  await expect(b.locator('audio')).toHaveAttribute('src',/^blob:/);await panel(b).getByRole('button',{name:'再生',exact:true}).click();await expect(panel(b).getByRole('button',{name:'停止',exact:true})).toBeVisible();await panel(b).getByRole('button',{name:'停止',exact:true}).click();
  await save(b);await capture(b,'audio-matched');checks.push('A sets common song; B auto selects unique full metadata match and plays');
  await change(a,file2);await expect.poll(async()=>(await state(b)).song?.name).toBe(file2.name);await expect(b.locator('audio')).not.toHaveAttribute('src',/./);
  await expect(panel(b).getByText('一致する曲がないか、候補が複数あります。この端末の曲ファイルを選んでください。',{exact:true})).toBeVisible();
  await capture(b,'audio-ambiguous');
  const descriptorA=(await state(a)).song, before=(await read(b)).collaboration.outbox.length;
  await panel(b).getByLabel('この端末に保存済みの曲',{exact:true}).selectOption(deviceMusic[3].id);
  await expect.poll(async()=>(await state(b)).audio?.name).toBe('device-encoding.wav');await save(b);
  assert.deepEqual((await state(a)).song,descriptorA);assert.deepEqual((await state(b)).song,descriptorA);assert.equal((await read(b)).collaboration.outbox.length,before);
  await b.reload();await open(b);await audioTab(b);await expect(panel(b).getByRole('button',{name:'再生',exact:true})).toBeEnabled();assert.equal((await state(b)).audio.name,'device-encoding.wav');
  checks.push('ambiguous candidates require explicit choice; other encoding is local-only; durable restart preserves binding/outbox');
  // Exercise the separate local file picker as well as a stored candidate.
  await panel(b).locator('label').filter({hasText:'この端末の曲ファイルを選ぶ（自分だけ）'}).locator('input[type=file]').setInputFiles({...file1,name:'device-selected.wav'});
  await expect.poll(async()=>(await state(b)).audio?.name).toBe('device-selected.wav');await save(b);assert.deepEqual((await state(a)).song,descriptorA);
  await capture(b,'audio-selected');
  const exported=await b.evaluate(async()=>{
    const active=window.__sharedSession.active,repo=active.coordinator;
    const {IndexedDbProjectRepository}=await import('/src/repositories/indexedDbRepository.ts');const repository=new IndexedDbProjectRepository();await repository.initialize();
    const {createTairetsuArchive,readTairetsuArchive}=await import('/src/utils/tairetsuFile.ts');const {loadAudioBlobFromIndexedDb,saveAudioBlobToIndexedDb}=await import('/src/utils/audioStorage.ts');
    const {generateBulkBackup,importBackupFiles}=await import('/src/storage/bulkBackup.ts');const {migrateLegacyStorage}=await import('/src/storage/migrationCoordinator.ts');const {memoryReaders}=await import('/src/storage/testing/migrationContract.ts');
    const project=active.editor.project,blob=await loadAudioBlobFromIndexedDb(project.audio.id,project.audio);
    const archive=await createTairetsuArchive(project,{audioBlob:blob}), imported=await readTairetsuArchive(new File([archive],'current.zip'));
    const {default:JSZip}=await import('/node_modules/.vite/deps/jszip.js');const raw=await JSZip.loadAsync(await archive.arrayBuffer()),json=await raw.file('project.json').async('string');
    const noAudio=await readTairetsuArchive(new File([await createTairetsuArchive(project)],'without.zip'));
    const files=[];for await (const file of generateBulkBackup(repository,true))files.push(new File([file.blob],file.fileName));
    const report=await importBackupFiles(repository,files);
    const summaries=(await repository.list({limit:100})).items,independent=[];for(const s of summaries)if(s.id!=='project_a')independent.push(await repository.get(s.id));
    const rescue=await active.prepareIndependentCopy();await repository.commit(rescue);const rescued=await repository.get(rescue.project.id);
    await migrateLegacyStorage({repository,readers:memoryReaders({})});await repository.updateMaintenance({action:'started'});const gc=await repository.collectUnusedAudio();
    const retained=!!await loadAudioBlobFromIndexedDb(project.audio.id,project.audio);
    const previous=await repository.getPrevious('project_a');repository.close();void repo;void saveAudioBlobToIndexedDb;
    return {json,keys:Object.keys(raw.files).sort(),audioName:imported.project.audio.name,audioSize:imported.audioBlob.size,noAudio:noAudio.project.audio,report,
      independent:independent.map(r=>({id:r.project.id,audio:r.project.audio,collaboration:r.collaboration??null})),rescue:{audio:rescued.project.audio,collaboration:rescued.collaboration??null},gc,retained,previousBindings:previous.collaboration?.audioBindings};
  });
  assert.equal(exported.audioName,'device-selected.wav');assert.equal(exported.audioSize,file1.buffer.length);assert.equal(exported.noAudio,null);
  for(const forbidden of ['transportBinding','audioBindings','accessToken','journal','outbox','sharedDocumentId'])assert(!exported.json.includes(forbidden));
  assert.deepEqual(exported.keys,['audio/','audio/audio.wav','manifest.json','project.json']);assert.equal(exported.report.failed,0);assert.equal(exported.report.imported,1);
  assert(exported.independent.every(r=>r.id!=='project_a'&&r.collaboration===null&&r.audio.name==='device-selected.wav'));assert.equal(exported.rescue.collaboration,null);assert.equal(exported.rescue.audio.name,'device-selected.wav');assert(exported.gc.skipped&&exported.retained&&exported.previousBindings.length>=2);
  checks.push('ZIP old shape/audio-null compatibility; full local backup/import and rescue independent; current/previous binding GC deferral retains music');
  const chooserPending=b.waitForEvent('filechooser');await panel(b).locator('label').filter({hasText:'この端末の曲ファイルを選ぶ（自分だけ）'}).click();const chooser=await chooserPending;
  await change(a,{...file2,name:'common-3.wav'});await expect.poll(async()=>(await state(b)).song?.name).toBe('common-3.wav');await expect(b.locator('audio')).not.toHaveAttribute('src',/./);
  await chooser.setFiles({...file1,name:'stale-choice.wav'});await expect(b.getByText('共通曲が変わりました。曲を確認して、もう一度この端末のファイルを選んでください。',{exact:true})).toBeVisible();
  assert.equal((await state(b)).audio,null);await capture(b,'audio-missing');
  checks.push('changed descriptor stops old audio and refuses a file picker reply opened for the prior descriptor');
  await b.getByRole('button',{name:'隊列一覧へ戻る',exact:true}).click();await b.getByRole('button',{name:'ホームのその他の操作'}).click();await b.getByRole('button',{name:'保存データの管理',exact:true}).click();await b.getByRole('button',{name:'すべての隊列表をバックアップ',exact:true}).click();await expect(b.getByText(/まだ取得していないクラウドの隊列表は含まれません/)).toBeVisible();await b.getByRole('button',{name:'閉じる',exact:true}).click();await open(b);await audioTab(b);
  backend.members.delete(actors[1]);backend.departures.set(actors[1],'removed');await b.evaluate(()=>window.__sharedSession.active.provider.wake());await expect(b.locator('.collab-status-pill')).toHaveText('共有から外れました');await capture(b,'removed-audio');
  await expect(b.locator('.collab-banner--removed')).toBeVisible();await b.getByRole('button',{name:'共有から外れました',exact:true}).click();await expect(b.getByRole('dialog',{name:'みんなで編集'})).toBeVisible();await b.getByRole('button',{name:'共同編集画面を閉じる',exact:true}).click();
  checks.push('backup scope explicit; V2 legacy help absent; all four iPad dimensions fit full status and banner');
  assert.deepEqual(errors,[]);assert.deepEqual(denied,[]);assert.deepEqual(legacy,[]);
  await writeFile(path.join(shotDir,'bounds.json'),JSON.stringify(bounds,null,2));
  console.log(JSON.stringify({status:'DEVICE_AUDIO_APP: PASS',checks,shots,shotDir,legacyCalls:legacy.length},null,2));
} finally {for(const context of contexts)await context.close();await browser.close();await server.close();await vite.close();}
