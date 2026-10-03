import { chromium } from '@playwright/test';
import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
// Requires the existing dev server; never starts/stops it or installs dependencies.
const baseURL = process.env.PORTRAIT_TEST_URL ?? 'http://127.0.0.1:5179';
const browser = await chromium.launch({ headless: true });
try {
  const context = await browser.newContext({ viewport: { width: 1032, height: 1376 } });
  // Isolated browser storage; the user's open browser and projects are untouched.
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(baseURL);
  await page.getByRole('heading', { name: '隊列メーカー', exact: true }).waitFor();
  await page.evaluate(async () => {
    const { createSampleProject } = await import('/src/sampleProject.ts');
    const project = createSampleProject();
    project.id = 'portrait-146-measure'; project.title = '縦持ち146人検証';
    project.stage.depthMeters = 18; project.stage.widthMeters = 18;
    project.members = Array.from({ length: 146 }, (_, i) => ({ id: `measure-${i}`, name: `メンバー${i + 1}`, color: '#0f766e', visible: true }));
    project.memberGroups = Array.from({ length: 8 }, (_, i) => ({ id: `group-${i}`, name: `グループ${i + 1}`, color: '#0f766e', memberIds: project.members.filter((_, n) => n % 8 === i).map(m => m.id) }));
    project.frames.forEach(frame => {
      frame.positions = Object.fromEntries(project.members.map((m, i) => [m.id, { x: (i % 12) * 1.3 + 1, y: Math.floor(i / 12) * 1.2 + 1 }]));
      frame.memberVisibility = Object.fromEntries(project.members.map((m, i) => [m.id, i < 117]));
      frame.objectAssignments = {};
    });
    project.members[145].visible = false;
    project.frames[0].objectAssignments = { o_chair: ['measure-145'], o_curtain: ['measure-145'] };
    project.frames[0].memberAppearanceOverrides = { 'measure-145': { color: '#ff0000' } };
    localStorage.setItem('stageflow.projects.v1', JSON.stringify([project]));
    localStorage.removeItem('stageflow.ui.portraitPanel.v1');
  });
  const openProject = async () => {
    await page.reload();
    await page.getByRole('button', { name: '縦持ち146人検証を開く', exact: true }).click();
    await page.locator('.scene-visibility-picker.is-portrait').waitFor();
  };
  const metrics = async () => page.evaluate(() => {
    const rect = (selector) => { const el = document.querySelector(selector); const r = el?.getBoundingClientRect(); return r ? { h: r.height, w: r.width, top: r.top, bottom: r.bottom } : null; };
    const workspace = document.querySelector('.workspace');
    const style = getComputedStyle(workspace);
    const H = workspace.clientHeight - parseFloat(style.paddingTop) - parseFloat(style.paddingBottom);
    const rows = document.querySelector('.scene-visibility-picker__scroll')?.dataset.rows;
    const header = document.querySelector('.portrait-panel-header');
    const chip = document.querySelector('.scene-visibility-chip');
    const tops = Array.from(document.querySelector('.scene-visibility-picker__grid')?.children ?? []).map(el => el.getBoundingClientRect().top);
    const panelBottom = document.querySelector('.tab-panel__content').getBoundingClientRect().bottom;
    const visibleRows = [...new Set(tops.filter(top => top + 44 <= panelBottom))].length;
    return { size: `${innerWidth}x${innerHeight}`, H, rows: Number(rows), visibleRows,
      panel: rect('.tab-panel'), stage: rect('.center-column'), stageWorkspace: rect('.stage-workspace'),
      canvas: rect('.stage-fit-area'), header: rect('.portrait-panel-header'), info: rect('.scene-visibility-picker__info'),
      content: rect('.tab-panel__content'), grid: rect('.scene-visibility-picker__grid'),
      headerAreas: header ? getComputedStyle(header).gridTemplateAreas : null,
      headerPositions: Object.fromEntries(['h2', 'input', '.portrait-panel-header__bulk', '.portrait-panel-header__actions'].map(selector => {
        const el = header?.querySelector(selector); const r = el?.getBoundingClientRect();
        return [selector, r ? { top: r.top, right: r.right, bottom: r.bottom, left: r.left } : null];
      })),
      chip: rect('.scene-visibility-chip'), name: rect('.scene-visibility-chip__name'), check: rect('.scene-visibility-chip__check'),
      chipOpacity: chip ? getComputedStyle(chip).opacity : null };
  });
  const results = [];
  const sizes = [[744,1133,2], [810,1080,2], [820,1180,3], [834,1210,3], [1024,1366,4], [1032,1376,4]];
  for (const [width, height, expectedRows] of sizes) {
    await page.setViewportSize({ width, height });
    await openProject();
    await page.waitForTimeout(150);
    const result = await metrics();
    assert.equal(result.rows, expectedRows, result.size);
    assert.equal(result.visibleRows, expectedRows, `${result.size} fully visible rows`);
    assert.ok(result.stage.h / result.H >= (width === 744 ? 0.50 : 0.55));
    assert.ok(Math.abs(result.panel.h - Math.min(460, Math.max(320, result.H * 0.40))) < 1);
    assert.equal(result.chip.h, 44); assert.equal(result.chip.w, 148);
    assert.ok(result.name.h >= 44 && result.check.h >= 44);
    const p = result.headerPositions;
    if (width >= 900) {
      assert.ok(p.input.top < p.h2.bottom && p.input.bottom > p.h2.top, 'wide header is one row');
      assert.ok(p.input.right <= p['.portrait-panel-header__bulk'].left);
      assert.ok(p['.portrait-panel-header__bulk'].right <= p['.portrait-panel-header__actions'].left);
    } else {
      assert.ok(p.input.top >= p.h2.bottom, 'narrow search is in second row');
      assert.equal(p.input.top, p['.portrait-panel-header__bulk'].top);
      assert.ok(p.input.right <= p['.portrait-panel-header__bulk'].left);
    }
    assert.ok(await page.locator('.portrait-management-target').getByRole('group', { name: '管理欄の対象' }).count());
    assert.equal(await page.locator('.portrait-panel-header').getByRole('group', { name: '管理欄の対象' }).count(), 0);
    results.push(result);
  }
  // Badge and full descriptions, with independent name/check actions.
  const specialChip = page.locator('[data-visibility-id="measure-145"]');
  assert.equal(await specialChip.locator('.scene-visibility-chip__badge').innerText(), '＋4');
  assert.equal(await specialChip.locator('.scene-visibility-chip__text small').count(), 0);
  const fullStatus = await specialChip.locator('.sr-only').innerText();
  assert.ok(fullStatus.includes('割当:') && fullStatus.includes('移動幕') && fullStatus.includes('椅子'));
  const name = specialChip.getByRole('button', { name: 'メンバー146', exact: true });
  await name.click();
  assert.equal(await name.getAttribute('aria-pressed'), 'true');
  assert.equal(await specialChip.getByRole('checkbox').isChecked(), false);
  assert.ok((await page.locator('.scene-visibility-picker__info').innerText()).includes('全シーン非表示'));
  // A saved ratio wins over the new default and survives reload.
  await page.evaluate(() => localStorage.setItem('stageflow.ui.portraitPanel.v1', JSON.stringify({ version: 1, ratio: 0.30 })));
  await openProject(); await page.waitForTimeout(150);
  const saved = await metrics();
  assert.ok(Math.abs(saved.panel.h - saved.H * 0.30) < 1);
  await page.getByRole('button', { name: 'パネル高さを既定に戻す', exact: true }).click();
  assert.equal(await page.evaluate(() => localStorage.getItem('stageflow.ui.portraitPanel.v1')), null);
  // The exact breakpoint and landscape DOM keep the existing two-line status.
  const breakpoint = [];
  for (const width of [899, 900]) {
    await page.setViewportSize({ width, height: 1300 }); await page.waitForTimeout(100);
    const m = await metrics();
    assert.equal((m.headerAreas.match(/"/g) ?? []).length / 2, width < 900 ? 2 : 1);
    breakpoint.push({ width, headerHeight: m.header.h });
  }
  const landscape = [];
  for (const [height, width] of sizes) {
    await page.setViewportSize({ width, height }); await page.waitForTimeout(100);
    assert.equal(await page.locator('.app-shell').getAttribute('data-workspace-layout'), null);
    assert.equal(await page.locator('.portrait-panel-header').count(), 0);
    assert.equal(await page.locator('.scene-visibility-chip__badge').count(), 0);
    assert.equal(await page.locator('.scene-visibility-chip__text small').count(), 146);
    landscape.push({ size: `${width}x${height}`, statusLines: 146 });
  }
  assert.deepEqual(errors, []);
  console.table(results.map(r => ({ size: r.size, panel: r.panel.h.toFixed(1), rows: r.rows,
    stage: r.stage.h.toFixed(1), stagePercent: (r.stage.h / r.H * 100).toFixed(1),
    canvas: r.canvas.h.toFixed(1), header: r.header.h })));
  console.log('PASS: initial density, 900px header switch, 44px targets, badges, saved height, all 6 landscape sizes; no page errors.');
  await fs.mkdir('output/playwright', { recursive: true });
  await fs.writeFile('output/playwright/portrait-density-metrics.json', JSON.stringify({ results, savedHeight: saved.panel.h, breakpoint, landscape, errors }, null, 2));
} finally { await browser.close(); }
