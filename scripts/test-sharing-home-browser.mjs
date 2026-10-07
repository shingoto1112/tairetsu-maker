import { chromium } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";
import assert from "node:assert/strict";

// Isolated profile, fictional records, mocked collaboration metadata, loopback only.
const origin = "http://127.0.0.1:5380";
const shots = "C:/Users/shing/AppData/Local/Temp/claude/c--Users-shing-OneDrive--------ChatGPT-------/e5aa9c38-eb07-490c-ac06-62f047c4c161/scratchpad/shots-impl74";
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ hasTouch: true, deviceScaleFactor: 1 });
const errors = [], blocked = [], metrics = [];
try {
  await mkdir(shots, { recursive: true });
  await context.route("**/*", route => {
    if (new URL(route.request().url()).origin !== origin) { blocked.push(route.request().url()); return route.abort(); }
    return route.continue();
  });
  await context.route(`${origin}/src/cloud/config.ts`, route => route.fulfill({ contentType: "application/javascript",
    body: "export const getCloudConfig = () => null; export const isCloudConfigured = () => false;" }));
  await context.route(`${origin}/src/hooks/useCollaborationUi.ts`, route => route.fulfill({ contentType: "application/javascript", body: `
    import React from '/node_modules/.vite/deps/react.js';
    const { useRef } = React;
    import { CollaborationUiService } from '/src/collaboration/uiService.ts';
    export function useCollaborationUi() {
      const ref = useRef(null);
      if (!ref.current) {
        const bridge = { options: null, get: async () => service };
        const service = new CollaborationUiService(() => bridge.options);
        service.auth = { state: () => ({ status: 'signed-in', userId: '33333333-3333-4333-8333-333333333333', isGuest: false, displayName: '架空利用者', sessionPersistence: 'existing-account' }) };
        service.initialize = async () => service.authChanged();
        service.api = { listMyDocuments: async () => ({ items: window.__impl74Documents, nextCursor: null }) };
        ref.current = bridge;
      }
      return ref.current;
    }` }));
  await context.route(`${origin}/__impl74_seed__`, route => route.fulfill({ contentType: "text/html", body: "<!doctype html><title>Local fictional fixtures</title>" }));
  const page = await context.newPage();
  page.on("pageerror", error => { errors.push(error.message); console.error("Browser error:", error.message); });
  await page.goto(`${origin}/__impl74_seed__`);
  const documents = await page.evaluate(async () => {
    const { IndexedDbProjectRepository } = await import("/src/repositories/indexedDbRepository.ts");
    const { createSampleProject } = await import("/src/sampleProject.ts");
    const { normalizeProject } = await import("/src/project/normalizeProject.ts");
    const { createSharedDocument } = await import("/src/collaboration/model.ts");
    const { createCollaborationData, projectSharedDocument } = await import("/src/collaboration/persistence.ts");
    const repository = new IndexedDbProjectRepository(); await repository.initialize();
    const docs = [], titles = ["架空公演・春のステージ", "架空公演・夏のパレード", "架空公演・ソロ", "架空公演・みんなの隊列", "架空公演・みんなの隊列", "架空公演・フィナーレ"];
    for (let i = 0; i < titles.length; i++) {
      let project = normalizeProject({ ...createSampleProject(), id: `fixture-${i}`, title: titles[i], createdAt: "2026-10-01T12:00:00Z", updatedAt: "2026-10-07T12:00:00Z", lastOpenedAt: "2026-10-07T12:00:00Z" });
      let collaboration;
      if (i === 2 || i === 3) {
        const documentId = i === 2 ? "11111111-1111-4111-8111-111111111111" : "22222222-2222-4222-8222-222222222222";
        const doc = createSharedDocument(project); collaboration = createCollaborationData(doc);
        collaboration.sharedDocumentId = documentId;
        collaboration.transportBinding = { accountId: "33333333-3333-4333-8333-333333333333", membershipGeneration: "44444444-4444-4444-8444-444444444444" };
        project = projectSharedDocument(doc, project, documentId); doc.destroy();
        docs.push({ documentId, title: titles[i], createdAt: "2026-10-01T12:00:00Z", isCreator: true, memberCount: i === 2 ? 1 : 3, documentSchema: 2 });
      }
      if (i === 1) { project.mode = "parade"; project.paradeSettings = { totalDistance: 100, width: 10, cellSizeMeters: 0.5, direction: "up", rulerPosition: "both", horizontalMeasureMode: "centerSplit", emphasizeEvery5m: true, emphasizeEvery10m: true }; }
      await repository.commit({ project, collaboration, localRevision: "1", expectedRepositoryRevision: null, operationId: `seed-${i}` });
    }
    repository.close();
    docs.push({ documentId: "55555555-5555-4555-8555-555555555555", title: "架空公演・別端末の隊列", createdAt: "2026-10-02T12:00:00Z", isCreator: true, memberCount: 1, documentSchema: 2 });
    return docs;
  });
  await page.addInitScript(docs => { window.__impl74Documents = docs; }, documents);
  await page.goto(`${origin}/?runtime=capacitor-ios`);
  await page.getByRole("region", { name: "隊列表一覧" }).waitFor().catch(async error => {
    console.error("Observed page:", (await page.locator("body").innerText()).slice(0, 2000));
    throw error;
  });
  await page.locator('[data-project-id="fixture-3"] .formation-card__badge').filter({ hasText: "共有中・3人" }).waitFor();
  assert.equal(await page.locator('[data-project-id="fixture-2"] .formation-card__badge').textContent(), "クラウド");
  console.log("Observed home buttons:", await page.getByRole("region", { name: "隊列表一覧" }).getByRole("button").evaluateAll(buttons => buttons.map(button => button.getAttribute("aria-label") || button.textContent)));
  for (const size of [{ width: 1376, height: 1032 }, { width: 744, height: 1133 }, { width: 1133, height: 744 }]) {
    await page.setViewportSize(size);
    await page.locator(".project-card-preview svg").first().waitFor();
    await page.screenshot({ path: `${shots}/home-${size.width}x${size.height}.png` });
    const bounds = await page.evaluate(() => {
      const grid = document.querySelector(".library-grid");
      return { columns: getComputedStyle(grid).gridTemplateColumns.split(" ").length,
        cards: [...document.querySelectorAll(".formation-card--saved[data-project-id]")].map(card => {
          const menu = card.querySelector(".formation-card__menu").getBoundingClientRect();
          const open = card.querySelector(".formation-card__open").getBoundingClientRect();
          const preview = card.querySelector(".formation-card__preview").getBoundingClientRect();
          return { width: menu.width, height: menu.height, gap: open.top - menu.bottom, previewGap: preview.top - menu.bottom };
        }) };
    });
    if (size.width === 744) assert.equal(bounds.columns, 3);
    for (const card of bounds.cards) { assert(card.width >= 44 && card.height >= 44); assert(card.gap >= 7.9 && card.previewGap >= 7.9); }
    const menuButton = page.locator('[data-project-id="fixture-0"] .formation-card__menu');
    await menuButton.tap();
    await page.getByRole("menu").waitFor();
    assert.equal(await page.getByRole("textbox", { name: "隊列表名" }).count(), 0);
    const menuBounds = await page.getByRole("menu").evaluate(menu => {
      const rect = menu.getBoundingClientRect();
      return { top: rect.top, bottom: rect.bottom, left: rect.left, right: rect.right, heights: [...menu.querySelectorAll("button")].map(button => button.getBoundingClientRect().height) };
    });
    assert(menuBounds.top >= 11.9 && menuBounds.bottom <= size.height - 11.9);
    assert(menuBounds.left >= 11.9 && menuBounds.right <= size.width - 11.9);
    assert(menuBounds.heights.every(height => height >= 44));
    const rectangle = await menuButton.boundingBox();
    await page.touchscreen.tap(rectangle.x + rectangle.width / 2, rectangle.y + rectangle.height + 4);
    assert.equal(await page.getByRole("textbox", { name: "隊列表名" }).count(), 0);
    await page.keyboard.press("Escape");
    metrics.push({ size, ...bounds, menuBounds, tapDidNotOpenEditor: true });
  }
  // Open a menu at the bottom edge to exercise measured upward placement.
  const bottomButton = page.locator('[data-project-id="fixture-5"] .formation-card__menu');
  await bottomButton.scrollIntoViewIfNeeded(); await bottomButton.tap();
  const bottom = await page.getByRole("menu").boundingBox(); assert(bottom.y + bottom.height <= 732.1);
  await page.screenshot({ path: `${shots}/menu-1133x744.png` });
  await page.keyboard.press("Escape");
  // Small viewport: the menu itself scrolls and still keeps 44px rows.
  await page.setViewportSize({ width: 744, height: 260 });
  const menuButton = page.locator('[data-project-id="fixture-0"] .formation-card__menu');
  await menuButton.scrollIntoViewIfNeeded(); await menuButton.tap();
  const overflow = await page.getByRole("menu").evaluate(menu => ({ rect: menu.getBoundingClientRect().toJSON(), scroll: menu.scrollHeight > menu.clientHeight }));
  assert(overflow.scroll); assert(overflow.rect.top >= 11.9 && overflow.rect.bottom <= 248.1);
  metrics.push({ smallViewportMenu: overflow });
  assert.deepEqual(errors, []);
  await writeFile(`${shots}/browser-check.json`, JSON.stringify({ metrics, errors, externalRequestsBlocked: blocked.length, shots }, null, 2));
  console.log(JSON.stringify({ metrics, errors, externalRequestsBlocked: blocked.length, shots }, null, 2));
} finally { await context.close(); await browser.close(); }
