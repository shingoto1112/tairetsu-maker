import { chromium, expect } from "@playwright/test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { performance } from "node:perf_hooks";

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
  await fresh("d approved real ZIP imports (contents never logged)", async page => {
    await page.goto(origin); await ready(page);
    for (const file of ["C:/Users/shing/Downloads/sailing_kobe_隊列名前入り.zip", "C:/Users/shing/Downloads/2025どまつりパレード.zip"]) {
      await page.locator('input[type="file"][accept*=".zip"]').setInputFiles(file);
      await expect(page.getByRole("textbox",{name:"隊列表名",exact:true})).toBeVisible({timeout:60000});
      await back(page);
    }
    await page.reload(); await ready(page); await expect(page.locator(".formation-card--saved")).toHaveCount(2);
    // Both cards open after reloading; suppress real titles from output.
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
  assert.deepEqual(failures, []);
} finally { await browser.close(); }
