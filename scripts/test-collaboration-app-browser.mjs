import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { chromium, expect } from "@playwright/test";

// Real App, isolated browser storage; no shared start/invite/presence UI, no
// server lifecycle or production connection. Seed a shared repository record.
const origin = process.env.REPOSITORY_TEST_ORIGIN ?? "http://127.0.0.1:5179", project = JSON.parse(await readFile("src/repositories/contract/fixtures/commitProjects.json", "utf8")).stage;
assert(new URL(origin).protocol === 'http:' && ['127.0.0.1','localhost'].includes(new URL(origin).hostname));
const browser = await chromium.launch({ headless: true }), context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
const page = await context.newPage(), errors = [], denied = [];
await context.route("**/*", route => {
  const url = new URL(route.request().url());
  if (url.origin !== origin && !["data:", "blob:"].includes(url.protocol)) { denied.push(url.origin); return route.abort(); }
  return route.continue();
});
page.on("pageerror", error => errors.push(error.message));
try {
  await page.route(`${origin}/__collab_app_test__`, route => route.fulfill({ contentType: "text/html", body: "<!doctype html><title>Anonymous shared App test</title>" }));
  await page.goto(`${origin}/__collab_app_test__`);
  await page.evaluate(async raw => {
    const { IndexedDbProjectRepository } = await import("/src/repositories/indexedDbRepository.ts");
    const { createSharedDocument } = await import("/src/collaboration/model.ts");
    const { createCollaborationData } = await import("/src/collaboration/persistence.ts");
    const p = { ...raw, title: "匿名共同編集", frames: raw.frames.map(f => ({ ...f, notes: "abc" })) };
    const doc = createSharedDocument(p), repository = new IndexedDbProjectRepository(); await repository.initialize();
    await repository.commit({ project: p, collaboration: createCollaborationData(doc), localRevision: "1", expectedRepositoryRevision: null, operationId: "app-shared-seed" });
    doc.destroy(); repository.close();
  }, project);
  await page.goto(origin);
  await page.getByRole("button", { name: "匿名共同編集を開く", exact: true }).click();
  const title = page.getByRole("textbox", { name: "隊列表名", exact: true }); await expect(title).toHaveValue("匿名共同編集");
  // Another writer updates durable CRDT while App holds a captured projection.
  await page.evaluate(async () => {
    const { IndexedDbProjectRepository } = await import("/src/repositories/indexedDbRepository.ts");
    const { hydrateCollaboration, appendCollaboration, encodeUpdate, projectSharedDocument } = await import("/src/collaboration/persistence.ts");
    const { CollaborationCommands } = await import("/src/collaboration/commands.ts");
    const repository = new IndexedDbProjectRepository(); await repository.initialize(); const record = await repository.get("project_a");
    const doc = hydrateCollaboration(record.collaboration), commands = new CollaborationCommands(doc); let bytes;
    doc.on("update", b => { bytes = b; });
    commands.moveMembers([{ sceneId: "f_001", memberId: "m_001", position: { x: 7, y: 5 } }]);
    const collaboration = appendCollaboration(record.collaboration, [{ updateId: "app-other-writer", bytes: encodeUpdate(bytes), source: "remote" }]);
    await repository.commit({ project: projectSharedDocument(doc, record.project), collaboration, localRevision: "2", expectedRepositoryRevision: record.repositoryRevision, operationId: "app-other-commit" });
    commands.destroy(); doc.destroy(); repository.close();
  });
  await title.click(); await title.press("ControlOrMeta+A"); await title.pressSequentially("共同編集入口");
  await expect(title).toHaveValue("共同編集入口");
  await page.locator(".toolbar-save-button").click();
  await expect(page.locator(".toolbar-save-button")).not.toHaveClass(/is-dirty/);
  const read = () => page.evaluate(async () => {
    const { IndexedDbProjectRepository } = await import("/src/repositories/indexedDbRepository.ts");
    const repository = new IndexedDbProjectRepository(); await repository.initialize();
    try { return await repository.get("project_a"); } finally { repository.close(); }
  });
  const saved = await read(); assert.equal(saved.project.title, "共同編集入口"); assert.deepEqual(saved.project.frames[0].positions.m_001, { x: 7, y: 5 });
  assert.equal(saved.collaboration.documentSchema, 2); assert(saved.collaboration.outbox.length > 0);
  // Actual App keyboard Undo routes to Y.UndoManager and keeps the other writer.
  await title.blur(); await page.locator("body").click({ position: { x: 2, y: 2 } }); await page.keyboard.press("ControlOrMeta+Z");
  await page.locator(".toolbar-save-button").click();
  await expect(page.locator(".toolbar-save-button")).not.toHaveClass(/is-dirty/);
  const undone = await read(); assert.deepEqual(undone.project.frames[0].positions.m_001, { x: 7, y: 5 });
  assert.notEqual(undone.project.title, "共同編集入口");
  await page.reload(); await page.getByRole("button", { name: `${undone.project.title}を開く`, exact: true }).click();
  await expect(title).toHaveValue(undone.project.title);
  assert.deepEqual(errors, []); assert.deepEqual(denied, []);
  console.log("COLLAB_APP_BROWSER", JSON.stringify({ checks: ["real App opens schema 2 attachment", "edit entry saves Yjs commands",
    "stale CAS preserves another writer's coordinates", "keyboard Undo preserves remote content", "reload restores shared Project"], productionNetwork: false }));
} finally {
  await context.close(); await browser.close();
}
