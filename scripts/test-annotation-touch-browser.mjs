import assert from "node:assert/strict";
import { chromium } from "@playwright/test";

// Run against an already-running local Vite server. Fresh profiles and no external requests.
const origin = process.env.ANNOTATION_TEST_ORIGIN ?? "http://127.0.0.1:5380";
const url = new URL(origin);
assert.equal(url.protocol, "http:");
assert.ok(["localhost", "127.0.0.1"].includes(url.hostname));
const browser = await chromium.launch({ headless: true });
try {
  for (const mode of ["stage", "parade"]) {
    const context = await browser.newContext({ hasTouch: true, viewport: { width: 1194, height: 834 } });
    await context.route("**/*", route => new URL(route.request().url()).origin === url.origin ? route.continue() : route.abort());
    try {
      const page = await context.newPage();
      const errors = [];
      page.on("pageerror", error => errors.push(error.message));
      await page.goto(origin);
      await page.getByRole("button", { name: /追加/ }).click();
      await page.getByRole("button", { name: /新しく作る/ }).click();
      await page.getByRole("button", { name: mode === "stage" ? /ステージ隊列/ : /パレード隊列/ }).click();
      await page.getByLabel("隊列表名").fill(`線モードのタッチ確認 ${mode}`);
      await page.getByRole("button", { name: "作成する", exact: true }).click();
      await page.getByRole("button", { name: "線を引く", exact: true }).waitFor();
      const viewport = page.locator(mode === "stage" ? ".stage-fit-area" : ".parade-viewport");
      const surface = page.locator(mode === "stage" ? ".stage-surface" : ".parade-stage");
      const preview = page.locator(mode === "stage" ? ".stage-pinch-preview" : ".parade-pinch-preview");
      const settle = () => page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      const scroll = () => viewport.evaluate(el => [el.scrollLeft, el.scrollTop]);
      const dimensions = () => surface.evaluate(el => [el.style.width, el.style.height]);
      const fitted = await dimensions();
      await viewport.hover();
      await page.keyboard.down("Control");
      await page.mouse.wheel(0, -550);
      await page.keyboard.up("Control");
      await settle();
      assert.notDeepEqual(await dimensions(), fitted, "wheel zoom must enlarge the canvas");
      await viewport.evaluate(el => { el.scrollLeft = 150; el.scrollTop = 250; });
      await page.getByRole("button", { name: "線を引く", exact: true }).click();
      assert.equal(await viewport.evaluate(el => getComputedStyle(el).touchAction), "none");
      assert.equal(await viewport.evaluate(el => getComputedStyle(el).overflowY), "auto");
      const rect = await viewport.boundingBox();
      const start = { id: 1, x: rect.x + rect.width * .55, y: rect.y + rect.height * .5 };
      const end = { ...start, x: start.x - 60, y: start.y - 40 };
      const cdp = await context.newCDPSession(page);
      const touch = (type, points) => cdp.send("Input.dispatchTouchEvent", { type, touchPoints: points });
      await page.evaluate(() => {
        window.annotationTouchTargets = [];
        window.addEventListener("pointerdown", e => window.annotationTouchTargets.push(e.target.closest?.(".annotation-interaction-layer") !== null), true);
      });
      const before = await scroll();
      await touch("touchStart", [start]);
      for (let i = 1; i <= 5; i++) {
        await touch("touchMove", [{ ...start, x: start.x - 12 * i, y: start.y - 8 * i }]);
        await settle();
        assert.deepEqual(await scroll(), before, "one-finger drawing must not move the background");
      }
      await touch("touchEnd", []); await settle();
      assert.deepEqual(await scroll(), before);
      assert.equal(await page.locator(".annotation-layer [data-annotation-line]").count(), 1);
      assert.equal((await page.evaluate(() => window.annotationTouchTargets))[0], true, "touch must target the real SVG");

      const lock = page.locator(".stage-pinch-lock-button");
      await lock.click();
      const lockedDimensions = await dimensions();
      const beforePan = await scroll();
      const first = { ...start, x: start.x - 20, y: start.y + 20 };
      const second = { id: 2, x: first.x + 100, y: first.y };
      await touch("touchStart", [first]);
      await touch("touchMove", [{ ...first, x: first.x - 10 }]);
      await touch("touchStart", [{ ...first, x: first.x - 10 }, second]);
      const movedFirst = { ...first, x: first.x - 60, y: first.y - 30 };
      const movedSecond = { ...second, x: second.x - 20, y: second.y - 20 };
      await touch("touchMove", [movedFirst, movedSecond]); await settle();
      assert.match(await preview.evaluate(el => el.style.transform), /scale\(1\)/);
      await touch("touchEnd", [movedFirst]); await settle();
      assert.notDeepEqual(await scroll(), beforePan, "locked two-finger pan must move the viewport");
      assert.deepEqual(await dimensions(), lockedDimensions, "pinch lock must keep the starting scale");
      const afterPan = await scroll();
      await touch("touchMove", [{ ...movedFirst, x: movedFirst.x + 35 }]);
      await touch("touchEnd", []); await settle();
      assert.deepEqual(await scroll(), afterPan);
      assert.equal(await page.locator(".annotation-layer [data-annotation-line]").count(), 1, "2-to-1 fingers must not resume drawing");
      assert.match(await lock.getAttribute("class"), /is-locked/);

      await page.getByRole("button", { name: "完了", exact: true }).click();
      const ordinary = await scroll();
      await touch("touchStart", [start]);
      await touch("touchMove", [end]); await settle();
      assert.notDeepEqual(await scroll(), ordinary, "completion must restore ordinary one-finger pan");
      await touch("touchCancel", []);
      assert.deepEqual(errors, []);
      console.log(JSON.stringify({ mode, touchTarget: "annotation-interaction-layer", drawingScroll: before,
        lockedPanBefore: beforePan, lockedPanAfter: afterPan, scaleUnchanged: true, lineCount: 1,
        resumedOrdinaryPan: true, browser: browser.version(), result: "PASS" }));
    } finally { await context.close(); }
  }
} finally { await browser.close(); }
