import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { chromium } from "@playwright/test";

// Fresh browser profiles, fictional projects, and local requests only.
const origin = "http://127.0.0.1:5380";
const shots = process.env.SCENE_TIME_SHOTS;
assert.ok(shots, "Set SCENE_TIME_SHOTS to the requested screenshot directory.");
await mkdir(shots, { recursive: true });
const browser = await chromium.launch({ headless: true });
try {
  for (const [mode, fallback] of [["stage", false], ["parade", false], ["stage", true]]) {
    const context = await browser.newContext({ hasTouch: true, viewport: { width: 1376, height: 1032 }, deviceScaleFactor: 1 });
    await context.route("**/*", route => new URL(route.request().url()).origin === origin ? route.continue() : route.abort());
    if (fallback) await context.addInitScript(() => { HTMLDialogElement.prototype.showModal = undefined; });
    try {
      const page = await context.newPage(); const errors = [];
      page.on("pageerror", error => errors.push(error.message));
      const inert = `${origin}/__scene_time_test__`;
      await context.route(inert, route => route.fulfill({ contentType: "text/html", body: "<!doctype html><title>Scene Time Test</title>" }));
      await page.goto(inert);
      await page.evaluate(async mode => {
        const { createSampleProject } = await import("/src/sampleProject.ts");
        const { IndexedDbProjectRepository } = await import("/src/repositories/indexedDbRepository.ts");
        const project = createSampleProject();
        project.id = "impl73-fictional"; project.title = "時刻ダイヤル確認（架空データ）"; project.mode = mode;
        const frame = project.frames[0];
        project.frames = [
          { ...frame, id: "target", label: "登場", timeSec: 14.57 },
          { ...frame, id: "first", label: "準備", timeSec: 0 },
          { ...frame, id: "tie", label: "ポーズ", timeSec: 0 },
        ];
        const repository = new IndexedDbProjectRepository(); await repository.initialize();
        await repository.commit({ project, localRevision: "1", expectedRepositoryRevision: null, operationId: "seed-impl73" });
      }, mode);
      await page.goto(`${origin}/?runtime=capacitor-ios`);
      await page.getByRole("button", { name: "時刻ダイヤル確認（架空データ）を開く" }).click();
      await page.getByRole("tab", { name: "シーン", exact: true }).click();
      const launcher = page.getByRole("button", { name: "シーンの時刻を変更（現在 0:14）" });
      await launcher.waitFor();
      assert.match(await page.locator(".scene-inline-details").ariaSnapshot(), /時刻/);
      const suffix = `${mode}-${fallback ? "fallback" : "native"}`;
      if (!fallback) await page.screenshot({ path: path.join(shots, `scene-detail-${suffix}.png`) });
      await launcher.click();
      const dialog = page.getByRole("dialog", { name: /^シーン[0-9]+「.*」の時刻$/ }); await dialog.waitFor();
      assert.equal(await dialog.evaluate(el => el.matches(":modal")), !fallback);
      const minute = dialog.getByRole("spinbutton", { name: "分" });
      const second = dialog.getByRole("spinbutton", { name: "秒" });
      assert.equal(await second.getAttribute("aria-valuenow"), "14");
      assert.equal(await second.evaluate(el => el.scrollTop), 14 * 44);
      assert.equal(await minute.getAttribute("aria-valuemax"), "60");
      await page.screenshot({ path: path.join(shots, `time-dial-${suffix}.png`) });
      await minute.press("Shift+Tab");
      assert.equal(await dialog.getByRole("button", { name: "決定" }).evaluate(el => el === document.activeElement), true);
      await page.keyboard.press("Tab");
      assert.equal(await minute.evaluate(el => el === document.activeElement), true);
      if (fallback) {
        assert.equal(await page.locator("#root").evaluate(el => el.inert), true);
        await page.locator(".toolbar-save-button").evaluate(el => el.focus());
        assert.equal(await minute.evaluate(el => el === document.activeElement), true);
      }
      await dialog.getByRole("button", { name: "秒を1増やす" }).click();
      await dialog.getByRole("button", { name: "秒を1減らす" }).click();
      await dialog.getByRole("button", { name: "決定" }).click();
      assert.equal(await launcher.evaluate(el => el === document.activeElement), true);
      assert.match(await page.locator(".timeline-card.is-selected .timeline-card__time").innerText(), /14\.6秒/);
      await launcher.click(); await dialog.getByRole("button", { name: "秒を1増やす" }).click();
      await dialog.getByRole("button", { name: "決定" }).click();
      await page.getByRole("button", { name: "シーンの時刻を変更（現在 0:15）" }).waitFor();
      await page.getByRole("button", { name: "シーンの時刻を変更（現在 0:15）" }).click();
      await second.press("Escape"); assert.equal(await dialog.count(), 0);
      assert.equal(await page.locator("#root").evaluate(el => el.inert), false);
      assert.deepEqual(errors, []);
      console.log(JSON.stringify({ mode, fallback, viewport: [1376, 1032], result: "PASS", shots,
        checks: ["initial row alignment", "Tab trap", "focus return", "fractional preservation", "integer commit", "Escape cancel"] }));
    } finally { await context.close(); }
  }
} finally { await browser.close(); }
