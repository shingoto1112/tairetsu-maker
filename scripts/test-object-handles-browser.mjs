import { chromium, expect } from "@playwright/test";
import { createServer } from "vite";
import fs from "node:fs/promises";
import path from "node:path";

// Self-contained local server, isolated profiles, fictional data, no external requests.
const origin = "http://127.0.0.1:5390";
const output = path.resolve("output/build28/handles");
await fs.mkdir(output, { recursive: true });
const report = { layouts: [], screenshots: [], checks: [], errors: [], blockedRequests: [] };
const server = await createServer({ server: { host: "127.0.0.1", port: 5390, strictPort: true } });
await server.listen();
console.log(`Local Vite PID ${process.pid}, port 5390`);
let browser;
try {
  browser = await chromium.launch({ headless: true });
  for (const [mode, hasTouch] of [["stage", true], ["parade", true], ["stage", false]]) {
    const prefix = `${mode}${hasTouch ? "" : "-fine"}`;
    const context = await browser.newContext({ viewport: { width: 1376, height: 1032 }, locale: "ja-JP", hasTouch });
    await context.route("**/*", route => {
      const url = new URL(route.request().url());
      if (url.origin === origin) return route.continue();
      report.blockedRequests.push(url.origin); return route.abort();
    });
    await context.routeWebSocket(/.*/, socket => {
      const url = new URL(socket.url());
      if (url.hostname === "127.0.0.1" && url.port === "5390") socket.connectToServer();
      else { report.blockedRequests.push(url.origin); socket.close(); }
    });
    const inert = `${origin}/__object_handles_seed__`;
    await context.route(inert, route => route.fulfill({ contentType: "text/html", body: "<!doctype html><title>Fictional local fixture</title>" }));
    const page = await context.newPage();
    page.on("pageerror", error => report.errors.push(error.message));
    await page.goto(inert);
    const seed = await page.evaluate(async mode => {
      const { createSampleProject } = await import("/src/sampleProject.ts");
      const { createDefaultParadeSettings } = await import("/src/project/defaults.ts");
      const { createDefaultObjectState } = await import("/src/utils/interpolation.ts");
      const { IndexedDbProjectRepository } = await import("/src/repositories/indexedDbRepository.ts");
      const project = { ...createSampleProject(), id: `handles-${mode}`, title: `架空のつまみ確認・${mode}`, mode, audio: null, members: [] };
      if (mode === "parade") project.paradeSettings = createDefaultParadeSettings({ width: 12, totalDistance: 100, backwardDistanceMeters: 5, cellSizeMeters: .5 });
      const template = project.stageObjects[1];
      project.stageObjects = [
        { id: "mark", name: "立ち位置マーク", shape: "circle", widthMeters: .4, heightMeters: .4 },
        { id: "flag", name: "大旗", shape: "rectangle", widthMeters: 1.33, heightMeters: .5 },
        { id: "thin", name: "細長い道具", shape: "rectangle", widthMeters: 5, heightMeters: .1 },
        { id: "tiny", name: "極小の道具", shape: "rectangle", widthMeters: .1, heightMeters: .1 },
        { id: "tall", name: "縦長の道具", shape: "rectangle", widthMeters: .1, heightMeters: 5 },
        ...Array.from({ length: 5 }, (_, i) => ({ id: `extra-${i}`, name: `架空の道具${i + 1}`, shape: "rectangle", widthMeters: .8, heightMeters: .8 })),
      ].map(o => ({ ...template, color: "#d05c39", defaultX: 1, defaultY: 1, ...o }));
      project.stageObjects[0].color = "#0f766e";
      project.objectGroups = [{ id: "flags", name: "旗", color: "#d05c39", objectIds: ["flag", ...project.stageObjects.slice(5).map(o => o.id)], defaultShape: "rectangle", defaultType: "prop" }];
      project.frames = project.frames.map(f => ({ ...f, positions: {}, objectAssignments: {}, objectStates: Object.fromEntries(project.stageObjects.map(o => [o.id, createDefaultObjectState(o)])) }));
      const repository = new IndexedDbProjectRepository(); await repository.initialize();
      await repository.commit({ project, localRevision: "1", expectedRepositoryRevision: null, operationId: `${mode}-fixture` });
      repository.close(); return { id: project.id, title: project.title };
    }, mode);
    await page.goto(origin);
    await page.getByRole("button", { name: `${seed.title}を開く`, exact: true }).click();
    for (const [width, height] of hasTouch ? [[1376, 1032], [1032, 1376], [1133, 744], [744, 1133]] : [[1376, 1032]]) {
      await page.setViewportSize({ width, height });
      await page.getByRole("button", { name: "全体名簿を開く", exact: true }).click();
      const roster = page.getByRole("dialog", { name: "メンバー/道具の管理", exact: true });
      await roster.getByRole("button", { name: "道具管理", exact: true }).click();
      for (const [state, name] of [["ungrouped", "立ち位置マーク"], ["group", "大旗"], ["thin", "細長い道具"], ["tiny", "極小の道具"], ["tall", "縦長の道具"]]) {
        await roster.getByRole("button", { name: `${name}の形と大きさを設定`, exact: true }).click();
        const preview = roster.getByLabel("道具と方眼の見本", { exact: true });
        await expect(preview).toBeVisible();
        // Wait for the ResizeObserver fit to match the live element's dimensions.
        await expect.poll(() => preview.evaluate(root => {
          const r = root.getBoundingClientRect(), o = root.querySelector(".object-size-editor__object").getBoundingClientRect();
          return o.right <= r.right && o.bottom <= r.bottom;
        })).toBe(true);
        const metrics = await preview.evaluate(root => {
          const box = el => { const r = el.getBoundingClientRect(); return { left: r.left, top: r.top, right: r.right, bottom: r.bottom, width: r.width, height: r.height }; };
          const bounds = box(root), object = box(root.querySelector(".object-size-editor__object"));
          const handles = [...root.querySelectorAll(".object-size-editor__handle")].map(el => ({ ...box(el), label: el.getAttribute("aria-label"), background: getComputedStyle(el).backgroundColor,
            dot: { width: getComputedStyle(el, "::after").width, height: getComputedStyle(el, "::after").height, border: getComputedStyle(el, "::after").borderTopColor, background: getComputedStyle(el, "::after").backgroundColor } }));
          const dimensions = [...root.querySelectorAll(".object-size-editor__dimension")].map(box);
          const labels = [...root.querySelectorAll(".object-size-editor__dimension span")].map(el => ({ ...box(el), text: el.textContent, fontSize: getComputedStyle(el).fontSize, weight: getComputedStyle(el).fontWeight }));
          const svg = root.querySelector("svg"), sampleWidth = svg.viewBox.baseVal.width;
          const grid = [...svg.querySelectorAll("line.print-grid-lines")].map(el => ({ meter: Number(el.dataset.position), x: box(el).left }));
          const table = root.closest(".roster-manager-modal").querySelector(".roster-table-wrap"), tb = table.getBoundingClientRect();
          const rows = [...table.querySelectorAll("tbody tr")].filter(el => { const r = el.getBoundingClientRect(); return r.top >= tb.top && r.bottom <= tb.bottom; }).length;
          return { bounds, object, handles, dimensions, labels, pixelsPerMeter: bounds.width / sampleWidth, grid, visibleRows: rows };
        });
        report.layouts.push({ mode, hasTouch, width, height, state, ...metrics });
        const overlap = (a, b) => Math.min(a.right, b.right) - Math.max(a.left, b.left) > .1 && Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) > .1;
        const inside = a => a.left >= metrics.bounds.left - .1 && a.right <= metrics.bounds.right + .1 && a.top >= metrics.bounds.top - .1 && a.bottom <= metrics.bounds.bottom + .1;
        for (const h of metrics.handles) {
          if (h.width < 43.99 || h.height < 43.99 || !inside(h)) throw new Error(`Clipped or small target: ${mode} ${width} ${state}`);
          if (metrics.handles.some(other => other !== h && overlap(h, other))) throw new Error(`Overlapping targets: ${mode} ${width} ${state}`);
          const lineBoxes = metrics.dimensions.map(d => ({ ...d, left: d.left - 5, right: d.right + 5, top: d.top - 5, bottom: d.bottom + 5 }));
          if ([...lineBoxes, ...metrics.labels].some(d => overlap(h, d))) throw new Error(`Dimension overlaps target: ${mode} ${width} ${state}`);
          if (h.background !== "rgba(0, 0, 0, 0)" || h.dot.background !== "rgb(255, 255, 255)" || Math.abs(parseFloat(h.dot.width) - 18) > .02 || Math.abs(parseFloat(h.dot.height) - 18) > .02) throw new Error("Circular handle styling differs");
        }
        if (metrics.labels.some(l => !inside(l) || parseFloat(l.fontSize) < 14 || Number(l.weight) < 700)) throw new Error(`Unreadable label: ${mode} ${width} ${state}`);
        if (metrics.visibleRows < 4) throw new Error(`Table lost space: ${mode} ${width} ${state}`);
        const [wl, hl] = metrics.dimensions;
        if (Math.abs(wl.width - metrics.object.width) > 1 || Math.abs(hl.height - metrics.object.height) > 1 || Math.abs(wl.left - metrics.object.left) > .1 || Math.abs(hl.top - metrics.object.top) > .1) throw new Error("Dimension endpoints differ from object");
        const expected = { ungrouped: [.4, .4], group: [1.33, .5], thin: [5, .1], tiny: [.1, .1], tall: [.1, 5] }[state];
        if (Math.abs(metrics.object.width - expected[0] * metrics.pixelsPerMeter) > .1 || Math.abs(metrics.object.height - expected[1] * metrics.pixelsPerMeter) > .1) throw new Error("Grid scale or aspect ratio differs from object");
        for (let i = 1; i < metrics.grid.length; i++) {
          const delta = metrics.grid[i].meter - metrics.grid[i - 1].meter;
          if (Math.abs(delta - .5) > .001 || Math.abs(metrics.grid[i].x - metrics.grid[i - 1].x - .5 * metrics.pixelsPerMeter) > .1) throw new Error("0.5m grid differs");
        }
        const filename = `${prefix}-${width}x${height}-${state}.png`;
        await page.screenshot({ path: path.join(output, filename) });
        // Extra close-up preserves the preview at native screenshot resolution.
        if (state === "thin" || state === "tiny") await preview.screenshot({ path: path.join(output, filename.replace(".png", "-preview.png")) });
        report.screenshots.push(filename);
      }
      console.log(`${prefix} ${width}x${height}: 5 roster states, target and dimension measurements passed`);
      await roster.getByRole("button", { name: "隊列表へ戻る", exact: true }).click();
    }
    // Actual App resize + one Undo, after the screenshot matrix.
    await page.getByRole("button", { name: "全体名簿を開く", exact: true }).click();
    const roster = page.getByRole("dialog", { name: "メンバー/道具の管理", exact: true });
    await roster.getByRole("button", { name: "道具管理", exact: true }).click();
    for (const [label, axes] of [["幅を変えるつまみ", "width"], ["高さを変えるつまみ", "height"], ["幅と高さを変えるつまみ", "both"]]) {
      await roster.getByRole("button", { name: "極小の道具の形と大きさを設定", exact: true }).click();
      const preview = roster.getByLabel("道具と方眼の見本", { exact: true });
      const handle = roster.getByRole("button", { name: label, exact: true });
      const box = await handle.boundingBox();
      const scale = await preview.evaluate(root => root.getBoundingClientRect().width / root.querySelector("svg").viewBox.baseVal.width);
      const start = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
      await page.mouse.move(start.x, start.y); await page.mouse.down();
      await page.mouse.move(start.x + (axes === "height" ? 0 : .055 * scale), start.y + (axes === "width" ? 0 : .055 * scale), { steps: 3 });
      await page.mouse.up();
      const w = axes === "height" ? ".1" : ".2", h = axes === "width" ? ".1" : ".2";
      await expect(roster.getByRole("button", { name: `幅 0${w}mを入力`, exact: true })).toBeVisible();
      await expect(roster.getByRole("button", { name: `高さ 0${h}mを入力`, exact: true })).toBeVisible();
      await roster.getByRole("button", { name: "隊列表へ戻る", exact: true }).click();
      await page.keyboard.press("Control+z");
      await page.getByRole("button", { name: "全体名簿を開く", exact: true }).click();
      await roster.getByRole("button", { name: "道具管理", exact: true }).click();
      await roster.getByRole("button", { name: "極小の道具の形と大きさを設定", exact: true }).click();
      await expect(roster.getByRole("button", { name: "幅 0.1mを入力", exact: true })).toBeVisible();
      await expect(roster.getByRole("button", { name: "高さ 0.1mを入力", exact: true })).toBeVisible();
      report.checks.push({ mode, hasTouch, axis: axes, browserDrag: true, singleUndo: true });
    }
    await context.close();
  }
  if (report.errors.length) throw new Error(report.errors.join("\n"));
  console.log(`Passed: ${report.layouts.length} layouts, ${report.checks.length} real App drag/Undo checks, 0 browser errors`);
} catch (error) {
  report.failure = String(error); throw error;
} finally {
  await fs.writeFile(path.join(output, "browser-checks.json"), JSON.stringify(report, null, 2));
  await browser?.close(); await server.close();
}
