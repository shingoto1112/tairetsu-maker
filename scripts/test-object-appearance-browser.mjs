import { chromium, expect } from "@playwright/test";
import fs from "node:fs/promises";
import path from "node:path";

// Isolated browser profile and fictional data. All non-local requests are blocked.
const origin = "http://127.0.0.1:5390";
const output = path.resolve("output/build28");
await fs.mkdir(output, { recursive: true });
const browser = await chromium.launch({ headless: true });
const report = { checks: [], layouts: [], screenshots: [], errors: [] };
try {
  for (const mode of ["stage", "parade"]) {
    const context = await browser.newContext({ viewport: { width: 1376, height: 1032 }, locale: "ja-JP", hasTouch: true });
    await context.route("**/*", route => {
      const url = new URL(route.request().url());
      return url.origin === origin ? route.continue() : route.abort();
    });
    const inert = `${origin}/__object_appearance_test__`;
    await context.route(inert, route => route.fulfill({ contentType: "text/html", body: "<!doctype html><title>Local fixture seed</title>" }));
    const page = await context.newPage();
    page.on("pageerror", error => report.errors.push(error.message));
    await page.goto(inert);
    const seed = await page.evaluate(async mode => {
      const { createSampleProject } = await import("/src/sampleProject.ts");
      const { createDefaultParadeSettings } = await import("/src/project/defaults.ts");
      const { createDefaultObjectState } = await import("/src/utils/interpolation.ts");
      const { IndexedDbProjectRepository } = await import("/src/repositories/indexedDbRepository.ts");
      const { applyObjectAppearance } = await import("/src/project/objectAppearance.ts");
      const { createTairetsuArchive, readTairetsuArchive } = await import("/src/utils/tairetsuFile.ts");
      const project = { ...createSampleProject(), id: `build28-${mode}`, title: `架空の${mode === "stage" ? "ステージ" : "パレード"}`, mode, audio: null };
      if (mode === "parade") project.paradeSettings = createDefaultParadeSettings({ width: 12, totalDistance: 100, backwardDistanceMeters: 5, cellSizeMeters: .5 });
      project.members = [];
      const template = project.stageObjects[1];
      project.stageObjects = Array.from({ length: 8 }, (_, i) => ({ ...template, id: `flag-${i}`, name: i ? `旗${i + 1}` : "大旗",
        shape: i ? "rectangle" : "circle", color: "#d05c39", widthMeters: 1.23, heightMeters: .5, defaultX: 1 + i, defaultY: 2 }));
      project.stageObjects.push({ ...template, id: "mark", name: "立ち位置マーク", shape: "circle", color: "#0f766e", widthMeters: .4, heightMeters: .4 });
      for (const [i, shape] of ["curtain", "custom", "line"].entries()) project.stageObjects.push({ ...template,
        id: `legacy-${shape}`, name: `旧${shape}`, type: shape === "curtain" ? "curtain" : "prop", shape, defaultX: 1 + i * 2, defaultY: 4,
        widthMeters: 1.4, heightMeters: .5, color: "#7c3aed" });
      project.objectGroups = [{ id: "flags", name: "旗", color: "#d05c39", objectIds: project.stageObjects.slice(0, 8).map(o => o.id), defaultShape: "rectangle", defaultType: "prop" }];
      project.frames = project.frames.map(frame => ({ ...frame, positions: {}, objectAssignments: {}, objectStates: Object.fromEntries(project.stageObjects.map(object => [object.id, createDefaultObjectState(object)])) }));
      const updated = applyObjectAppearance(project, "flag-0", { widthMeters: 1.33 });
      const repository = new IndexedDbProjectRepository(); await repository.initialize();
      await repository.commit({ project: updated, localRevision: "1", expectedRepositoryRevision: null, operationId: `${mode}-seed` });
      const restored = (await repository.get(updated.id)).project;
      if (JSON.stringify(restored) !== JSON.stringify(updated)) throw new Error("IndexedDB round trip differs");
      const archive = await createTairetsuArchive(updated), file = new File([archive], "build27-compatible.zip", { type: "application/octet-stream" });
      const imported = await readTairetsuArchive(file);
      if (JSON.stringify(imported.project) !== JSON.stringify(updated)) throw new Error("ZIP round trip differs");
      const withAudio = { ...updated, audio: { id: "fictional-audio", name: "架空の音源.wav", type: "audio/wav", size: 4 } };
      const audioArchive = await createTairetsuArchive(withAudio, { audioBlob: new Blob([new Uint8Array([1, 2, 3, 4])], { type: "audio/wav" }) });
      const audioImported = await readTairetsuArchive(new File([audioArchive], "with-audio.zip"));
      if (audioImported.audioBlob?.size !== 4 || audioImported.project.audio?.name !== withAudio.audio.name) throw new Error("ZIP audio round trip differs");
      repository.close();
      return { title: updated.title, id: updated.id, shapes: updated.stageObjects.map(o => [o.id, o.shape]), checks: ["IndexedDB保存往復", "ZIP音源なし往復", "ZIP音源あり往復", "build27互換の旧3形保持"] };
    }, mode);
    report.checks.push({ mode, ...seed });
    await page.goto(origin);
    await page.getByRole("button", { name: `${seed.title}を開く`, exact: true }).click();
    await page.getByRole("button", { name: "全体名簿を開く", exact: true }).waitFor();
    console.log(`${mode}: loaded fixture; UI buttons observed: ${JSON.stringify(await page.getByRole("tab").allTextContents())}`);
    for (const [width, height] of [[1376, 1032], [1032, 1376], [1133, 744], [744, 1133]]) {
      await page.setViewportSize({ width, height });
      await page.getByRole("button", { name: "全体名簿を開く", exact: true }).click();
      const roster = page.getByRole("dialog", { name: "メンバー/道具の管理", exact: true });
      await roster.getByRole("button", { name: "道具管理", exact: true }).click();
      if (await roster.getByRole("button", { name: "開く", exact: true }).count()) await roster.getByRole("button", { name: "開く", exact: true }).click();
      const capture = async state => {
        const filename = `${mode}-${width}x${height}-${state}.png`;
        await page.screenshot({ path: path.join(output, filename) }); report.screenshots.push(filename);
        const metrics = await roster.evaluate(root => {
          const editor = root.querySelector(".object-size-editor"), table = root.querySelector(".roster-table-wrap");
          const bounds = editor.getBoundingClientRect(), tb = table.getBoundingClientRect();
          const visibleRows = [...root.querySelectorAll("tbody tr")].filter(row => row.getBoundingClientRect().bottom <= tb.bottom).length;
          const preview = root.querySelector(".object-size-editor__preview");
          const pb = preview?.getBoundingClientRect();
          const handles = [...root.querySelectorAll(".object-size-editor__handle")].map(el => {
            const b = el.getBoundingClientRect(); return { width: b.width, height: b.height, inside: b.left >= pb.left && b.right <= pb.right + .1 && b.top >= pb.top && b.bottom <= pb.bottom + .1 };
          });
          return { editor: { x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height }, tableHeight: tb.height, visibleRows, handles };
        });
        report.layouts.push({ mode, width, height, state, ...metrics });
        if (state !== "collapsed" && metrics.visibleRows < 4) throw new Error(`Too few visible rows: ${filename}`);
        if (metrics.handles.some(h => h.width < 44 || h.height < 44 || !h.inside)) throw new Error(`Handle clipped: ${filename}`);
      };
      await expect(roster.getByText("道具のアイコンか名前を押すと、形と大きさを設定できます", { exact: true })).toBeVisible();
      await capture("unselected");
      await roster.getByRole("button", { name: "立ち位置マークの形と大きさを設定", exact: true }).click();
      if (await page.evaluate(() => document.activeElement?.tagName === "INPUT")) throw new Error("Icon selection focused keyboard input");
      await expect(roster.getByText("立ち位置マーク（未所属）", { exact: true })).toBeVisible(); await capture("ungrouped");
      await roster.getByRole("button", { name: "大旗の形と大きさを設定", exact: true }).click();
      await expect(roster.getByText("大旗（旗グループ）", { exact: true })).toBeVisible(); await capture("group");
      await roster.getByRole("button", { name: "小さくする", exact: true }).click(); await capture("collapsed");
      await roster.getByRole("button", { name: "隊列表へ戻る", exact: true }).click();
      await page.getByRole("tab", { name: "道具", exact: true }).click();
      await page.getByRole("button", { name: /^旗 を(開く|閉じる)$/ }).waitFor();
      if (await page.getByRole("button", { name: "旗 を開く", exact: true }).count()) await page.getByRole("button", { name: "旗 を開く", exact: true }).click();
      const shape = page.getByRole("group", { name: "大旗の形", exact: true }); await shape.scrollIntoViewIfNeeded();
      await expect(shape.getByRole("button", { name: "⬭ 円", exact: true })).toBeVisible();
      const filename = `${mode}-${width}x${height}-object-panel.png`;
      await page.screenshot({ path: path.join(output, filename) }); report.screenshots.push(filename);
      console.log(`${mode} ${width}x${height}: captured 5 states`);
    }
    // Actual App save/reload after roster editing, not only repository-level round trip.
    await page.getByRole("button", { name: "全体名簿を開く", exact: true }).click();
    const roster = page.getByRole("dialog", { name: "メンバー/道具の管理", exact: true });
    await roster.getByRole("button", { name: "道具管理", exact: true }).click();
    await roster.getByRole("button", { name: "開く", exact: true }).click();
    await roster.getByRole("button", { name: "大旗の形と大きさを設定", exact: true }).click();
    await roster.getByRole("button", { name: "幅を0.10m大きくする", exact: true }).click();
    await roster.getByRole("button", { name: "隊列表へ戻る", exact: true }).click();
    await page.getByRole("button", { name: "保存", exact: true }).click();
    await expect.poll(() => page.evaluate(async id => {
      const { IndexedDbProjectRepository } = await import("/src/repositories/indexedDbRepository.ts");
      const repository = new IndexedDbProjectRepository(); await repository.initialize();
      const saved = (await repository.get(id))?.project; repository.close();
      return saved?.stageObjects.find(o => o.id === "flag-0")?.widthMeters;
    }, seed.id)).toBe(1.43);
    await page.reload(); await page.getByRole("button", { name: `${seed.title}を開く`, exact: true }).click();
    await page.getByRole("button", { name: "全体名簿を開く", exact: true }).click();
    const reloaded = page.getByRole("dialog", { name: "メンバー/道具の管理", exact: true });
    await reloaded.getByRole("button", { name: "道具管理", exact: true }).click();
    await reloaded.getByRole("button", { name: "大旗の形と大きさを設定", exact: true }).click();
    await expect(reloaded.getByRole("button", { name: "幅 1.43mを入力", exact: true })).toBeVisible();
    const handle = reloaded.getByRole("button", { name: "幅を変えるつまみ", exact: true });
    const box = await handle.boundingBox();
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2); await page.mouse.down();
    await page.mouse.move(box.x + box.width / 2 + 10, box.y + box.height / 2, { steps: 3 }); await page.mouse.up();
    const draggedLabel = await reloaded.getByRole("button", { name: /^幅 .*mを入力$/ }).getAttribute("aria-label");
    if (draggedLabel === "幅 1.43mを入力") throw new Error("Browser drag did not resize");
    await reloaded.getByRole("button", { name: "隊列表へ戻る", exact: true }).click();
    await page.keyboard.press("Control+z");
    await page.getByRole("button", { name: "全体名簿を開く", exact: true }).click();
    const undone = page.getByRole("dialog", { name: "メンバー/道具の管理", exact: true });
    await undone.getByRole("button", { name: "道具管理", exact: true }).click();
    await undone.getByRole("button", { name: "大旗の形と大きさを設定", exact: true }).click();
    await expect(undone.getByRole("button", { name: "幅 1.43mを入力", exact: true })).toBeVisible();
    await undone.getByRole("button", { name: "隊列表へ戻る", exact: true }).click(); await page.keyboard.press("Control+Shift+z");
    await page.getByRole("button", { name: "全体名簿を開く", exact: true }).click();
    const redone = page.getByRole("dialog", { name: "メンバー/道具の管理", exact: true });
    await redone.getByRole("button", { name: "道具管理", exact: true }).click();
    await redone.getByRole("button", { name: "大旗の形と大きさを設定", exact: true }).click();
    await expect(redone.getByRole("button", { name: draggedLabel, exact: true })).toBeVisible();
    report.checks.push({ mode, appSaveReload: true, browserDragUndoRedo: true });
    await context.close();
  }
  if (report.errors.length) throw new Error(report.errors.join("\n"));
  console.log(JSON.stringify(report, null, 2));
} finally {
  await fs.writeFile(path.join(output, "browser-checks.json"), JSON.stringify(report, null, 2));
  await browser.close();
}
