import { chromium, expect } from "@playwright/test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { performance } from "node:perf_hooks";
import { syntheticZipFixtures } from './testing/synthetic-zip-fixtures.mjs';

// Uses only isolated contexts and an already-running local dev server.
const origin = process.env.REPOSITORY_TEST_ORIGIN ?? "http://127.0.0.1:5179";
const url = new URL(origin);
assert(url.protocol === "http:" && ["127.0.0.1", "localhost"].includes(url.hostname));
const fixtures = JSON.parse(await readFile(new URL("../src/repositories/contract/fixtures/commitProjects.json", import.meta.url), "utf8"));
const browser = await chromium.launch({ headless: true });
const failures = [];
const fresh = async (name, run) => {
  if (process.env.APP_STORAGE_CASE && !name.startsWith(process.env.APP_STORAGE_CASE)) return;
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const page = await context.newPage();
  page.on("pageerror", error => failures.push(`${name}: ${error.message}`));
  try { await run(page, context); console.log(`PASS ${name}`); }
  catch (error) { if (name.startsWith("d ")) throw new Error("Approved ZIP import verification failed; contents and assertion details suppressed."); throw error; }
  finally { await context.close(); }
};
const inert = async page => {
  await page.route(`${origin}/__app_storage_test__`, route => route.fulfill({ contentType: "text/html", body: "<!doctype html><title>Isolated App Test</title>" }));
  await page.goto(`${origin}/__app_storage_test__`);
};
const ready = async page => { await expect(page.getByRole("button", { name: "追加", exact: false })).toBeEnabled(); };
const seed = async (page, count = 1) => {
  await inert(page);
  return page.evaluate(async ({ base, count }) => {
    const { IndexedDbProjectRepository } = await import("/src/repositories/indexedDbRepository.ts");
    const repository = new IndexedDbProjectRepository(); await repository.initialize();
    for (let i=0; i<count; i++) await repository.commit({ project: { ...base, id: `anonymous-${i}`, title: `匿名${i}` },
      localRevision: "1", expectedRepositoryRevision: null, operationId: `seed-${i}` });
    repository.close();
  }, { base: fixtures.stage, count });
};
const open = async (page, title) => { await page.getByRole("button", { name: `${title}を開く`, exact: true }).click(); await expect(page.getByRole("textbox", { name: "隊列表名", exact: true })).toHaveValue(title); };
const back = async page => { await page.getByRole("button", { name: "隊列一覧へ戻る", exact: true }).click(); await ready(page); };
const menu = async (page, title, action) => { await page.getByRole("button", { name: `${title}のメニュー`, exact: true }).click(); await page.getByRole("button", { name: action, exact: true }).click(); };
const saved = async page => { await expect(page.locator(".toolbar-save-button")).not.toHaveClass(/is-dirty/); await expect(page.locator(".toolbar-save-button")).toHaveText("保存"); };
// Use keyboard input: Chromium's fill immediately after replacing the library
// tree can change the DOM value without delivering React's change event.
const typeText = async (locator, value) => { await locator.click(); await locator.press("ControlOrMeta+A"); await locator.pressSequentially(value); await expect(locator).toHaveValue(value); };
const stored = async (page, id = "anonymous-0") => page.evaluate(async id => {
  const { IndexedDbProjectRepository } = await import("/src/repositories/indexedDbRepository.ts");
  const r = new IndexedDbProjectRepository(); const record = await r.get(id); r.close();
  return record ? { title: record.project.title, revision: record.repositoryRevision, localRevision: record.localRevision } : null;
}, id);
try {
  await fresh("a legacy migration + read-only old keys", async page => {
    await inert(page);
    const legacy = Array.from({length:5}, (_, i) => ({ ...fixtures.stage, id: `legacy-${i}`, title: `旧匿名${i}` }));
    const original = { "stageflow.projects.v1": JSON.stringify(legacy), "stageflow.project.v1": JSON.stringify(legacy[0]), "stageflow.projects.updatedAt.v1": "2026-01-01T01:00:00.000Z" };
    await page.evaluate(values => Object.entries(values).forEach(([k,v]) => localStorage.setItem(k,v)), original);
    await page.goto(origin); await ready(page); await expect(page.locator(".formation-card--saved")).toHaveCount(5);
    await open(page, "旧匿名0"); await typeText(page.getByRole("textbox", { name: "隊列表名", exact: true }), "移行後編集"); await saved(page);
    assert.deepEqual(await page.evaluate(keys => Object.fromEntries(keys.map(k => [k, localStorage.getItem(k)])), Object.keys(original)), original);
    await page.reload(); await ready(page); await expect(page.getByRole("button", { name: "移行後編集を開く", exact:true })).toBeVisible();
  });
  await fresh("b/c create + autosave/manual/back + rename/copy/delete", async page => {
    await page.goto(origin); await ready(page);
    await page.getByRole("button", { name: "追加", exact:false }).click();
    await page.getByRole("button", { name: "新しく作る", exact:false }).click();
    await page.getByRole("button", { name: "ステージ隊列", exact:false }).click();
    const dialog = page.getByRole("dialog", { name: "新しい隊列表を作成" });
    await dialog.getByRole("textbox").fill("新規匿名"); await dialog.getByRole("button", { name: "作成する", exact:true }).click();
    await expect(page.getByRole("textbox", { name: "隊列表名", exact:true })).toHaveValue("新規匿名");
    await typeText(page.getByRole("textbox", { name: "隊列表名", exact:true }), "自動保存匿名");
    await expect(page.locator(".toolbar-save-button")).toHaveClass(/is-dirty/); await saved(page);
    await page.reload(); await ready(page); await open(page,"自動保存匿名");
    await typeText(page.getByRole("textbox", { name: "隊列表名", exact:true }), "手動保存匿名"); await page.locator(".toolbar-save-button").click(); await saved(page);
    await back(page); await open(page,"手動保存匿名"); await back(page);
    await menu(page,"手動保存匿名","名前を変更"); const rename=page.getByRole("dialog", {name:"隊列表名を変更"});
    await typeText(rename.getByRole("textbox"), "名前変更匿名"); await rename.getByRole("button",{name:"保存",exact:true}).click();
    await expect(page.getByRole("button",{name:"名前変更匿名を開く",exact:true})).toBeVisible();
    await page.reload(); await ready(page); await expect(page.getByRole("button",{name:"名前変更匿名を開く",exact:true})).toBeVisible();
    await menu(page,"名前変更匿名","複製"); await expect(page.locator(".formation-card--saved")).toHaveCount(2);
    await page.reload(); await ready(page); await menu(page,"名前変更匿名 のコピー","削除");
    await page.getByRole("dialog",{name:"隊列表を削除"}).getByRole("button",{name:"削除する",exact:true}).click();
    await expect(page.locator(".formation-card--saved")).toHaveCount(1);
    await page.reload(); await ready(page); await expect(page.locator(".formation-card--saved")).toHaveCount(1);
  });
  await fresh("d synthetic ZIP imports (stage/parade)", async page => {
    await page.goto(origin); await ready(page);
    for (const file of await syntheticZipFixtures(page)) {
      await page.locator('input[type="file"][accept*=".zip"]').setInputFiles(file);
      await expect(page.getByRole("textbox",{name:"隊列表名",exact:true})).toBeVisible({timeout:60000});
      await back(page);
    }
    await page.reload(); await ready(page); await expect(page.locator(".formation-card--saved")).toHaveCount(2);
    // Both anonymous cards open after reloading.
    for (let i=0; i<2; i++) { await page.locator(".formation-card--saved").nth(i).click(); await expect(page.getByRole("textbox",{name:"隊列表名",exact:true})).toBeVisible(); await back(page); }
  });
  await fresh("e quota retains edits + ZIP escape + retry", async page => {
    await seed(page); await page.goto(origin); await ready(page); await open(page,"匿名0");
    await page.evaluate(() => { window.originalPut=IDBObjectStore.prototype.put; IDBObjectStore.prototype.put=function(...args){ if(this.transaction.db.name==="tairetsu-maker-projects") throw new DOMException("injected", "QuotaExceededError"); return window.originalPut.apply(this,args); }; });
    await typeText(page.getByRole("textbox",{name:"隊列表名",exact:true}), "容量不足編集");
    await expect(page.getByRole("alert",{name:"端末保存エラー"})).toContainText("空き容量");
    await expect(page.getByRole("textbox",{name:"隊列表名",exact:true})).toHaveValue("容量不足編集");
    assert.equal((await stored(page)).title,"匿名0");
    await page.getByRole("button",{name:"編集中のデータを ZIP で書き出す",exact:true}).click();
    await expect(page.getByRole("dialog",{name:/書き出し/})).toBeVisible();
    await page.getByRole("dialog",{name:/書き出し/}).getByRole("button",{name:/閉じる/}).click();
    await page.evaluate(() => { IDBObjectStore.prototype.put=window.originalPut; });
    await page.getByRole("button",{name:"保存を再試行",exact:true}).click(); await saved(page);
    await expect(page.getByRole("alert",{name:"端末保存エラー"})).toHaveCount(0); assert.equal((await stored(page)).title,"容量不足編集");
  });
  await fresh("f two tabs conflict preserves both + copy/reload", async (page, context) => {
    await seed(page); await page.goto(origin); await ready(page); await open(page,"匿名0");
    const second = await context.newPage(); await second.goto(origin); await ready(second); await open(second,"匿名0");
    await typeText(second.getByRole("textbox",{name:"隊列表名",exact:true}), "別タブ確定"); await saved(second);
    await typeText(page.getByRole("textbox",{name:"隊列表名",exact:true}), "競合編集保持");
    await expect(page.getByRole("alert",{name:"端末保存エラー"})).toContainText("別の画面");
    assert.equal((await stored(page)).title,"別タブ確定");
    await page.getByRole("button",{name:"別の隊列表として保存",exact:true}).click(); await saved(page);
    await expect(page.getByRole("textbox",{name:"隊列表名",exact:true})).toHaveValue("競合編集保持 のコピー");
    assert.equal((await stored(page)).title,"別タブ確定");
    await back(page); await expect(page.locator(".formation-card--saved")).toHaveCount(2);
    await open(page,"別タブ確定");
    await typeText(second.getByRole("textbox",{name:"隊列表名",exact:true}), "再読込前編集");
    await expect(second.getByRole("alert",{name:"端末保存エラー"})).toBeVisible();
    await second.getByRole("button",{name:"読み込み直す",exact:true}).click();
    await second.getByRole("dialog",{name:"隊列表を読み込み直す"}).getByRole("button",{name:"読み込み直す",exact:true}).click();
    await saved(second); await expect(second.getByRole("textbox",{name:"隊列表名",exact:true})).toHaveValue("別タブ確定");
  });
  await fresh("g 50 large anonymous projects + timings + offline", async page => {
    await inert(page);
    const data = await page.evaluate(async base => {
      const { IndexedDbProjectRepository } = await import("/src/repositories/indexedDbRepository.ts");
      const r=new IndexedDbProjectRepository(); await r.initialize();
      const project={...base, members:Array.from({length:200},(_,i)=>({id:`m-${i}`,name:`匿名${i}`,color:"#009966"}))};
      project.frames=Array.from({length:45},(_,f)=>({...base.frames[0],id:`f-${f}`,label:`シーン${f}`,timeSec:f*8,
        positions:Object.fromEntries(project.members.map((m,i)=>[m.id,{x:i*.123456789,y:f*.987654321}]))}));
      const bytes=new TextEncoder().encode(JSON.stringify(project)).length;
      for(let i=0;i<50;i++)await r.commit({project:{...project,id:`large-${i}`,title:`大匿名${i}`},localRevision:"1",expectedRepositoryRevision:null,operationId:`seed-${i}`});
      r.close(); return {bytes};
    }, fixtures.stage);
    const start=performance.now(); await page.goto(origin); await ready(page); await expect(page.locator(".formation-card--saved")).toHaveCount(50); data.uiListMs=performance.now()-start;
    const opened=performance.now(); await open(page,"大匿名0"); await expect(page.locator(".stage-grid-layer").first()).toBeVisible(); data.uiOpenMs=performance.now()-opened;
    await typeText(page.getByRole("textbox",{name:"隊列表名",exact:true}), "大匿名編集"); const saving=performance.now(); await page.locator(".toolbar-save-button").click(); await saved(page); data.uiSaveMs=performance.now()-saving;
    Object.assign(data, await page.evaluate(async () => {
      const { IndexedDbProjectRepository }=await import("/src/repositories/indexedDbRepository.ts");const r=new IndexedDbProjectRepository();
      const values={list:[],get:[],commit:[]};
      for(let i=0;i<30;i++){
        let t=performance.now();await r.list({limit:100});values.list.push(performance.now()-t);
        t=performance.now();const record=await r.get("large-0");values.get.push(performance.now()-t);
        t=performance.now(); await r.commit({project:{...record.project,title:`匿名計測${i}`},localRevision:String(BigInt(record.localRevision)+1n),expectedRepositoryRevision:record.repositoryRevision,operationId:`measure-${i}`});values.commit.push(performance.now()-t);
      }
      r.close();return Object.fromEntries(Object.entries(values).map(([k,v])=>{v.sort((a,b)=>a-b);return[k,{p50:v[14],p95:v[28],max:v[29]}]}));
    }));
    await back(page); await page.context().setOffline(true); await open(page,"匿名計測29");
    console.log("50-project measurements", JSON.stringify(data));
  });
  await fresh("h Web + non-native iPad audio IndexedDB/playback/ZIP", async page => {
    for (const query of ["", "?runtime=capacitor-ios"]) {
      await page.goto(`${origin}/${query}`); await ready(page);
      const result = await page.evaluate(async base => {
        const { saveAudioBlobToIndexedDb, loadAudioBlobFromIndexedDb, resolveAudioPlaybackURL } = await import("/src/utils/audioStorage.ts");
        const { canUseNativeAudioStorage } = await import("/src/platform/audioStorage.ts");
        const { createTairetsuArchive, readTairetsuArchive } = await import("/src/utils/tairetsuFile.ts");
        // Small, valid 1s PCM WAV; no user's audio is used or logged.
        const bytes = new Uint8Array(44 + 16000), view = new DataView(bytes.buffer);
        const text = (offset, s) => [...s].forEach((c, i) => { bytes[offset + i] = c.charCodeAt(0); });
        text(0,"RIFF"); view.setUint32(4,bytes.length-8,true); text(8,"WAVE"); text(12,"fmt ");
        view.setUint32(16,16,true); view.setUint16(20,1,true); view.setUint16(22,1,true);
        view.setUint32(24,8000,true); view.setUint32(28,16000,true); view.setUint16(32,2,true); view.setUint16(34,16,true);
        text(36,"data"); view.setUint32(40,16000,true);
        const audio = await saveAudioBlobToIndexedDb(new Blob([bytes],{type:"audio/wav"}),{name:"anonymous.wav",duration:1});
        const playback = await resolveAudioPlaybackURL(audio);
        const blob = await loadAudioBlobFromIndexedDb(audio.id, audio);
        const zip = await createTairetsuArchive({...base,audio},{audioBlob:blob});
        const imported = await readTairetsuArchive(new File([zip],"anonymous.zip"));
        const importedMeta = await saveAudioBlobToIndexedDb(imported.audioBlob,{name:imported.project.audio.name,type:imported.project.audio.type,duration:1});
        const roundtrip = await loadAudioBlobFromIndexedDb(importedMeta.id);
        const media = document.createElement("audio"); media.preload="metadata";
        const loaded = new Promise((resolve,reject) => {
          const timeout=setTimeout(()=>reject(new Error("anonymous audio metadata timeout")),10000);
          media.onloadedmetadata=()=>{clearTimeout(timeout);resolve(media.duration);};
          media.onerror=()=>{clearTimeout(timeout);reject(new Error("anonymous audio metadata failed"));};
        });
        media.src=playback; const duration=await loaded;
        media.removeAttribute("src"); media.load(); URL.revokeObjectURL(playback);
        return {native:canUseNativeAudioStorage(),blobURL:playback.startsWith("blob:"),size:blob.size,
          roundtripSize:roundtrip.size, sameBytes:[...new Uint8Array(await roundtrip.arrayBuffer())].every((b,i)=>b===bytes[i]),duration};
      }, fixtures.stage);
      assert.deepEqual(result,{native:false,blobURL:true,size:16044,roundtripSize:16044,sameBytes:true,duration:1});
    }
  });
  await fresh("i bulk backup downloads + separate-context restore + continuing failures", async page => {
    await seed(page, 3);
    await page.evaluate(async () => {
      const { IndexedDbProjectRepository } = await import("/src/repositories/indexedDbRepository.ts");
      const { saveAudioBlobToIndexedDb } = await import("/src/utils/audioStorage.ts");
      const r = new IndexedDbProjectRepository(), record = await r.get("anonymous-0");
      const audio = await saveAudioBlobToIndexedDb(new Blob([new Uint8Array([1,2,3,4,5])], {type:"audio/mpeg"}), {name:"anonymous.mp3",duration:1});
      await r.commit({project:{...record.project,audio},localRevision:"2",expectedRepositoryRevision:record.repositoryRevision,operationId:"backup-audio"}); r.close();
    });
    await page.goto(origin); await ready(page);
    await page.getByRole("button",{name:"保存データの管理",exact:true}).click();
    await page.getByRole("button",{name:"すべての隊列表をバックアップ",exact:true}).click();
    await page.getByRole("checkbox",{name:"音源も含める",exact:true}).check();
    const downloads = []; page.on("download", download => downloads.push(download));
    await page.getByRole("button",{name:"バックアップを書き出す",exact:true}).click();
    await expect(page.getByText(/3件を書き出しました。失敗 0件/)).toBeVisible();
    await expect.poll(() => downloads.length).toBe(4);
    const files = [];
    for (const download of downloads) files.push({name:download.suggestedFilename(),mimeType:download.suggestedFilename().endsWith(".json")?"application/json":"application/zip",buffer:await readFile(await download.path())});
    const target = await browser.newContext({viewport:{width:1440,height:1000}});
    try {
      const restored = await target.newPage(); restored.on("pageerror", error => failures.push(`i restore: ${error.message}`));
      restored.on("dialog", dialog => dialog.accept()); await restored.goto(origin); await ready(restored);
      await restored.locator('input[type="file"][accept*=".zip"]').setInputFiles(files);
      await expect(restored.getByText(/成功 3件、失敗 0件、未選択 0件/)).toBeVisible();
      await expect(restored.locator(".formation-card--saved")).toHaveCount(3);
      const data = await restored.evaluate(async () => {
        const { IndexedDbProjectRepository }=await import("/src/repositories/indexedDbRepository.ts");
        const { loadAudioBlobFromIndexedDb }=await import("/src/utils/audioStorage.ts");
        const r=new IndexedDbProjectRepository(),page=await r.list({limit:100});
        const withAudio=page.items.find(s=>s.audioId),audio=withAudio?await loadAudioBlobFromIndexedDb(withAudio.audioId):null;
        r.close();return {newIDs:page.items.every(s=>!s.id.startsWith("anonymous-")),audioSize:audio?.size};
      });
      assert.deepEqual(data,{newIDs:true,audioSize:5}); await restored.reload(); await ready(restored);
      await expect(restored.locator(".formation-card--saved")).toHaveCount(3);
      const zips=files.filter(f=>f.name.endsWith(".zip"));
      await restored.locator('input[type="file"][accept*=".zip"]').setInputFiles([zips[0],{name:"invalid.zip",mimeType:"application/zip",buffer:Buffer.from("invalid")},zips[1]]);
      await expect(restored.getByText(/成功 2件、失敗 1件/)).toBeVisible();
      await expect(restored.locator(".formation-card--saved")).toHaveCount(5);
    } finally { await target.close(); }
  });
  await fresh("j GC current/previous/recovery/incomplete/pending/editor protection", async page => {
    await inert(page);
    const result = await page.evaluate(async base => {
      const { IndexedDbProjectRepository }=await import("/src/repositories/indexedDbRepository.ts");
      const { saveAudioBlobToIndexedDb,loadAudioBlobFromIndexedDb,confirmWebAudioReference }=await import("/src/utils/audioStorage.ts");
      const { migrateLegacyStorage }=await import("/src/storage/migrationCoordinator.ts");
      const { protectAudioEditor }=await import("/src/storage/maintenanceLock.ts");
      const audio={}; for(const key of ["current","previous","recovery","incomplete","unused","uncommitted"]) {
        audio[key]=await saveAudioBlobToIndexedDb(new Blob([new Uint8Array([1,2,3,4,5])],{type:"audio/mpeg"}),{name:"anonymous.mp3",duration:1});
        if(key!=="uncommitted")await confirmWebAudioReference(audio[key].id);
      }
      const r=new IndexedDbProjectRepository();
      const main={...base,id:"gc-main",audio:audio.current}; const candidate={...base,id:"gc-candidate",audio:audio.recovery};
      await migrateLegacyStorage({repository:r,readers:{includeDrafts:false,local:()=>({getItem:key=>key==="stageflow.projects.v1"?JSON.stringify([main]):null}),native:{readText:async path=>path.endsWith("backup.json")?JSON.stringify([candidate]):null,draftNames:async()=>null}}});
      await r.commit({project:{...base,id:"gc-previous",audio:audio.previous},localRevision:"1",expectedRepositoryRevision:null,operationId:"previous-create"});
      await r.commit({project:{...base,id:"gc-previous",audio:null},localRevision:"2",expectedRepositoryRevision:"1",operationId:"previous-update"});
      const item={kind:"item",id:"gc-incomplete-item",targetId:"gc-import",state:"discovered",sourceHash:"a".repeat(64),sources:["anonymous"],json:JSON.stringify({...base,id:"gc-import",audio:audio.incomplete}),disposition:"import",reason:"incomplete"};
      await r.writeMigration(item,null);await r.writeMigration({...item,state:"validated"},"discovered");await r.updateMaintenance({action:"started"});
      const release=await protectAudioEditor();const editing=await r.collectUnusedAudio();await release();
      const stats=await r.collectUnusedAudio();const second=await r.collectUnusedAudio();
      const present={};for(const [key,meta]of Object.entries(audio))present[key]=!!await loadAudioBlobFromIndexedDb(meta.id);
      // Undecidable recovery data must abort before deleting anything.
      const extra=await saveAudioBlobToIndexedDb(new Blob([new Uint8Array([9])],{type:"audio/mpeg"}),{name:"anonymous.mp3",duration:1});await confirmWebAudioReference(extra.id);
      await r.writeMigration({...item,id:"gc-broken",targetId:"gc-broken-target",json:'{"audio":123}',disposition:"recovery"},null);
      const originalNow=Date.now;Date.now=()=>originalNow()+86400001;let corrupt=false;
      try{await r.collectUnusedAudio();}catch(e){corrupt=e.code==="CORRUPT";}finally{Date.now=originalNow;}
      const extraRetained=!!await loadAudioBlobFromIndexedDb(extra.id);r.close();return{editingSkipped:editing.skipped,stats,secondSkipped:second.skipped,present,corrupt,extraRetained};
    }, fixtures.stage);
    assert.deepEqual(result,{editingSkipped:true,stats:{count:1,bytes:5,skipped:false},secondSkipped:true,present:{current:true,previous:true,recovery:true,incomplete:true,unused:false,uncommitted:true},corrupt:true,extraRetained:true});
  });
  await fresh("k recovery candidate UI + independent restored project + review retention", async page => {
    await inert(page);
    await page.evaluate(base=>{
      localStorage.setItem("stageflow.projects.v1",JSON.stringify([{...base,id:"original",title:"原本匿名"}]));
      localStorage.setItem("stageflow.project.v1",JSON.stringify({...base,id:"original",title:"候補匿名"}));
    },fixtures.stage);
    await page.goto(origin);await ready(page);await expect(page.locator(".formation-card--saved")).toHaveCount(1);
    await page.getByRole("button",{name:/復元できる隊列表（1件）/}).click();
    const dialog=page.getByRole("dialog",{name:"復元できる隊列表",exact:true});await expect(dialog.getByText("候補匿名",{exact:true})).toBeVisible();
    await expect(dialog.getByText(/以前のブラウザの保存/)).toBeVisible();await dialog.getByRole("button",{name:"一覧に復元",exact:true}).click();
    await expect(dialog.getByRole("checkbox")).toBeChecked();await dialog.getByRole("button",{name:"閉じる",exact:true}).click();
    await expect(page.locator(".formation-card--saved")).toHaveCount(2);
    const original=await stored(page,"original");assert.equal(original.title,"原本匿名");
    await page.reload();await ready(page);await expect(page.locator(".formation-card--saved")).toHaveCount(2);
    await expect(page.getByRole("button",{name:/復元できる隊列表（1件）/})).toBeVisible();
  });
  await fresh("l unreadable body rescued from previous without overwriting damaged original", async page => {
    await seed(page);
    await page.evaluate(async()=>{
      const {IndexedDbProjectRepository}=await import("/src/repositories/indexedDbRepository.ts");const r=new IndexedDbProjectRepository(),record=await r.get("anonymous-0");
      await r.commit({project:{...record.project,title:"破損匿名"},localRevision:"2",expectedRepositoryRevision:"1",operationId:"before-damage"});r.close();
      const db=await new Promise((resolve,reject)=>{const request=indexedDB.open("tairetsu-maker-projects");request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);});
      await new Promise((resolve,reject)=>{const tx=db.transaction("project_bodies","readwrite"),store=tx.objectStore("project_bodies"),read=store.get("anonymous-0");read.onsuccess=()=>store.put({...read.result,crc32:"bad"});tx.oncomplete=resolve;tx.onabort=()=>reject(tx.error);});db.close();
    });
    await page.goto(origin);await ready(page);await page.getByRole("button",{name:"破損匿名を開く",exact:true}).click();
    const dialog=page.getByRole("dialog",{name:"読み込めない隊列表の復旧",exact:true});await dialog.getByRole("button",{name:"前の保存を一覧に復元",exact:true}).click();
    await expect(page.locator(".formation-card--saved")).toHaveCount(2);
    await expect(page.getByRole("button",{name:"匿名0を開く",exact:true})).toBeVisible();
    const code=await page.evaluate(async()=>{const {IndexedDbProjectRepository}=await import("/src/repositories/indexedDbRepository.ts");const r=new IndexedDbProjectRepository();try{await r.get("anonymous-0");return"unexpected";}catch(e){return e.code;}finally{r.close();}});assert.equal(code,"CORRUPT");
  });
  assert.deepEqual(failures, []);
} finally { await browser.close(); }
