import { chromium } from "@playwright/test";
import os from "node:os";
import { randomUUID } from "node:crypto";

const origin = process.env.REPOSITORY_TEST_ORIGIN ?? "http://127.0.0.1:5179";
const parsed = new URL(origin);
if (parsed.protocol !== "http:" || !["127.0.0.1", "localhost"].includes(parsed.hostname)) {
  throw new Error("Use an already-running local Vite server; this script never starts/stops one.");
}
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext(); // Fresh profile, no access to user's browser databases.
const pages = [];
const dbName = `tairetsu-repository-test-two-pages-${randomUUID()}`;
try {
  const inert = `${parsed.origin}/__repository_test__`;
  await context.route(inert, route => route.fulfill({ contentType: "text/html", body: "<!doctype html><title>Isolated Repository Test</title>" }));
  const page = await context.newPage(); pages.push(page);
  page.on("pageerror", error => { console.error(error.message); process.exitCode = 1; });
  page.on("console", message => { if (message.type() === "log" && message.text().startsWith("IndexedDB:")) console.log(message.text()); });
  await page.goto(inert);
  const result = await page.evaluate(async () => {
    const { runIndexedDbBrowserSuite } = await import("/src/repositories/contract/testing/indexedDbBrowserSuite.ts");
    return runIndexedDbBrowserSuite();
  });
  // Separate pages share the origin's DB, but each owns an independent adapter.
  const second = await context.newPage(); pages.push(second); await second.goto(inert);
  for (const tab of pages) {
    await tab.evaluate(async name => {
      const { IndexedDbProjectRepository } = await import("/src/repositories/indexedDbRepository.ts");
      window.testRepository = new IndexedDbProjectRepository({ dbName: name });
      await window.testRepository.initialize();
    }, dbName);
  }
  await page.evaluate(async () => {
    const { default: projects } = await import("/src/repositories/contract/fixtures/commitProjects.json");
    await window.testRepository.commit({ project: projects.stage, operationId: "two-pages-create", localRevision: "1", expectedRepositoryRevision: null });
  });
  const outcomes = await Promise.all(pages.map((tab, i) => tab.evaluate(async index => {
    const { default: projects } = await import("/src/repositories/contract/fixtures/commitProjects.json");
    try {
      const receipt = await window.testRepository.commit({ project: { ...projects.stage, title: `anonymous page ${index}` },
        operationId: `two-pages-${index}`, localRevision: "2", expectedRepositoryRevision: "1" });
      return { ok: true, revision: receipt.repositoryRevision };
    } catch (error) { return { ok: false, code: error.code }; }
  }, i)));
  if (outcomes.filter(o => o.ok && o.revision === "2").length !== 1 || outcomes.filter(o => !o.ok && o.code === "CONFLICT").length !== 1) {
    throw new Error("Two-page CAS did not produce one winner and one CONFLICT");
  }
  await page.evaluate(async () => {
    const { default: fixture } = await import("/src/repositories/contract/fixtures/collaboration.json");
    const record = await window.testRepository.get("project_a");
    await window.testRepository.commit({ project: record.project, collaboration: fixture.initial,
      expectedRepositoryRevision: record.repositoryRevision, localRevision: "3", operationId: "two-pages-share" });
  });
  for (const [index, tab] of pages.entries()) await tab.evaluate(async i => {
    const { SaveCoordinator } = await import("/src/storage/saveCoordinator.ts");
    const { default: fixture } = await import("/src/repositories/contract/fixtures/collaboration.json");
    window.sharedCoordinator = new SaveCoordinator(window.testRepository, () => {});
    window.sharedCoordinator.activate(await window.testRepository.get("project_a"));
    await window.sharedCoordinator.editCollaboration([fixture.updates[i]]);
    if ((await window.sharedCoordinator.getSendableOutbox()).length) throw new Error("Sent uncommitted update");
  }, index);
  const sharedOutcomes = await Promise.all(pages.map(tab => tab.evaluate(() => window.sharedCoordinator.flush())));
  if (!sharedOutcomes.every(Boolean)) throw new Error("Two-page shared CAS did not recover");
  const sharedResult = await page.evaluate(async () => {
    const record = await window.testRepository.get("project_a");
    if (record.project.frames[0].positions.m_001.x !== 10 || record.project.frames[0].positions.m_002.x !== 11 || record.collaboration.outbox.length !== 2) throw new Error("Two-page merge lost updates/outbox");
    return { revision: record.repositoryRevision, outbox: record.collaboration.outbox.length };
  });
  // Native blocked open: hold an existing connection in page 2 and request v2
  // in page 1. The adapter's blocked mapping is tested in the browser suite.
  await second.evaluate(async name => {
    window.testRepository.close();
    window.blocker = await new Promise((resolve, reject) => {
      const request = indexedDB.open(name);
      request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);
    });
  }, dbName);
  await page.evaluate(async name => {
    window.testRepository.close();
    await new Promise((resolve, reject) => {
      const request = indexedDB.open(name, 4);
      request.onblocked = () => { window.blockedUpgrade = request; resolve(); };
      request.onerror = () => reject(request.error);
      request.onsuccess = () => { request.result.close(); reject(new Error("expected actual blocked event")); };
    });
  }, dbName);
  await page.evaluate(() => { window.blockedUpgrade.onsuccess = () => window.blockedUpgrade.result.close(); });
  await second.evaluate(() => { window.blocker.close(); });
  console.log(JSON.stringify({ ...result, twoPageCas: outcomes, twoPageSharedCas: sharedResult, nativeBlocked: true,
    chromium: browser.version(), os: `${os.platform()} ${os.release()} ${os.arch()}`, cpu: os.cpus()[0]?.model }, null, 2));
} finally {
  try {
    // Close test connections, then delete only this script's random DB.
    for (const page of pages) {
      if (!page.isClosed()) await page.evaluate(() => { window.testRepository?.close(); window.blocker?.close(); });
    }
    if (pages[0] && !pages[0].isClosed()) {
      await pages[0].evaluate(async name => {
        await new Promise((resolve, reject) => {
          const request = indexedDB.deleteDatabase(name);
          request.onsuccess = () => resolve(); request.onerror = () => reject(request.error);
          request.onblocked = () => reject(new Error("two-page test DB cleanup blocked"));
        });
      }, dbName);
    }
  } finally { await context.close(); await browser.close(); }
}
