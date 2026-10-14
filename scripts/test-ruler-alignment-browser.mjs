import { chromium, expect } from '@playwright/test';
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

const origin = process.env.REPOSITORY_TEST_ORIGIN ?? 'http://127.0.0.1:5392';
assert.ok(/^http:\/\/127\.0\.0\.1:539[2-9]$/.test(origin));
const out = path.resolve('output/build30');
await mkdir(out, { recursive: true });
const base = JSON.parse(await readFile('src/repositories/contract/fixtures/commitProjects.json', 'utf8')).stage;
const cases = [
  ...[12, 30].flatMap(width => ['meters', 'centerSplit'].map(counting => ({ mode: 'stage', width, counting, front: 'bottom', perspective: 'audience', viewport: [1180, 820] }))),
  { mode: 'stage', width: 12, counting: 'meters', front: 'top', perspective: 'performer', viewport: [1180, 820], zoom: true },
  { mode: 'stage', width: 12, counting: 'centerSplit', front: 'bottom', perspective: 'audience', viewport: [820, 1180], shot: true },
  { mode: 'parade', width: 12, counting: 'meters', viewport: [1180, 820], scroll: true, zoom: true },
  { mode: 'parade', width: 12, counting: 'centerSplit', viewport: [820, 1180], scroll: true, shot: true },
  // Integer length exposes 0m/start ticks on the frame; noninteger T/B checks interior 0m.
  { mode: 'parade', width: 12, counting: 'meters', total: 10, backward: 0, viewport: [1180, 820] },
];
const fixture = (c, index) => ({ ...structuredClone(base), id: `ruler-${index}`, title: `目盛り測定 ${index}`, mode: c.mode,
  viewerPerspective: c.perspective ?? 'audience', guideSettings: { snapGuideEnabled: false, snapToGuideEnabled: false },
  stage: { ...base.stage, widthMeters: c.width, depthMeters: 5.4, gridSizeMeters: .5, showGrid: true,
    frontDirection: c.front ?? 'bottom', horizontalGuideMode: c.counting, memberDiameterMeters: .4,
    emphasizeHorizontalNumbers: true, emphasizeHorizontalEvery5: true, emphasizeHorizontalEvery10: true,
    emphasizeVerticalNumbers: true, emphasizeVerticalEvery5m: true, emphasizeVerticalEvery10m: true },
  paradeSettings: { width: c.width, totalDistance: c.total ?? 30.13, backwardDistanceMeters: c.backward ?? 2.31,
    cellSizeMeters: .5, direction: 'up', rulerPosition: 'both', horizontalMeasureMode: c.counting === 'meters' ? 'normalMeter' : 'centerSplit',
    emphasizeHorizontalNumbers: true, emphasizeHorizontalEvery5: true, emphasizeHorizontalEvery10: true,
    emphasizeVerticalNumbers: true, emphasizeEvery5m: true, emphasizeEvery10m: true },
  members: [{ id: 'm0', name: '測定', color: '#0d8b78', visible: true }], memberGroups: [], stageObjects: [], objectGroups: [],
  frames: [{ id: 's0', label: '目盛りとグリッド', timeSec: 0, positions: { m0: { x: c.width / 2 - 1, y: 2.4 } },
    memberVisibility: {}, objectStates: {}, ...(c.mode === 'parade' ? { sceneViewState: { zoom: 1, scrollLeft: 0, scrollTop: 0 } } : {}) }],
});
const measurements = [], operations = [], errors = [], blocked = new Set();
const browser = await chromium.launch({ headless: true });
let lastPage;
const settle = page => page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
async function measure(page, c, name) {
  const data = await page.evaluate(({ c, name }) => {
    const parade = c.mode === 'parade', surface = document.querySelector(parade ? '.parade-stage' : '.stage-surface');
    const area = surface.getBoundingClientRect(), border = parseFloat(getComputedStyle(surface).borderLeftWidth);
    const viewport = document.querySelector(parade ? '.parade-viewport' : '.stage-fit-area').getBoundingClientRect();
    const yExtent = parade ? (c.total ?? 30.13) + (c.backward ?? 2.31) : 5.4;
    const clip = { left: Math.max(0, viewport.left), right: Math.min(innerWidth, viewport.right), top: Math.max(0, viewport.top), bottom: Math.min(innerHeight, viewport.bottom) };
    const centerLine = surface.querySelector(parade ? '.parade-center-line' : '.center-line');
    const centerRect = centerLine.getBoundingClientRect();
    const centerReference = area.left + area.width / 2 + (parade ? border : 0);
    const centerDelta = centerRect.left + centerRect.width / 2 - centerReference;
    const rows = [];
    for (const [axis, rulerSelector, lineSelector] of [
      ['x', parade ? '.parade-horizontal-ruler span' : '.meter-ruler--horizontal .meter-ruler__tick', parade ? '.parade-grid-line--vertical' : '.stage-grid-line--vertical'],
      ['y', parade ? '.parade-ruler--left span, .parade-ruler--right span' : '.meter-ruler--vertical .meter-ruler__tick', parade ? '.parade-grid-line--horizontal' : '.stage-grid-line--horizontal'],
    ]) {
      for (const label of document.querySelectorAll(rulerSelector)) {
        const rect = label.getBoundingClientRect(), css = getComputedStyle(label);
        if (css.display === 'none' || !rect.width || !rect.height || rect.right < clip.left || rect.left > clip.right || rect.bottom < clip.top || rect.top > clip.bottom) continue;
        const position = Number(label.dataset.position), extent = axis === 'x' ? c.width : yExtent;
        const displayPosition = !parade && c.perspective === 'performer' ? extent - position : position;
        const edge = Math.abs(position) < 1e-7 || Math.abs(position - extent) < 1e-7;
        const start = axis === 'x' ? area.left : area.top, size = axis === 'x' ? area.width : area.height;
        let reference, target;
        if (edge) {
          reference = start + (displayPosition < extent / 2 ? border / 2 : size - border / 2);
          target = '外枠';
        } else {
          const line = [...surface.querySelectorAll(lineSelector)].find(e => Math.abs(Number(e.dataset.position) - position) < 1e-7);
          if (!line) throw Error(`${name}: missing corresponding ${axis} line at internal ${position}`);
          const r = line.getBoundingClientRect(); reference = axis === 'x' ? r.left + r.width / 2 : r.top + r.height / 2;
          target = `線/${line.dataset.emphasis}/${axis === 'x' ? r.width : r.height}px`;
        }
        const labelCenter = axis === 'x' ? rect.left + rect.width / 2 : rect.top + rect.height / 2;
        let tickCenter = null;
        if (!parade) {
          const pseudo = getComputedStyle(label, '::after'), matrix = new DOMMatrix(pseudo.transform);
          const pseudoSize = parseFloat(axis === 'x' ? pseudo.width : pseudo.height);
          const pseudoStart = parseFloat(axis === 'x' ? pseudo.left : pseudo.top);
          const translation = axis === 'x' ? matrix.m41 : matrix.m42;
          tickCenter = (axis === 'x' ? rect.left : rect.top) + pseudoStart + translation + pseudoSize / 2;
        }
        rows.push({ axis, side: axis === 'x' ? '上' : label.parentElement.className.includes('right') ? '右' : '左',
          position, label: label.textContent, target, reference, labelCenter, tickCenter,
          labelDelta: labelCenter - reference, tickDelta: tickCenter === null ? null : tickCenter - reference });
      }
    }
    return { name, mode: c.mode, width: c.width, depth: yExtent, counting: c.counting, perspective: c.perspective ?? 'audience',
      front: c.front ?? 'bottom', viewport: c.viewport, dpr: devicePixelRatio,
      centerDelta, surface: { width: area.width, height: area.height }, scroll: { top: document.querySelector(parade ? '.parade-viewport' : '.stage-fit-area').scrollTop }, rows };
  }, { c, name });
  assert.ok(Math.abs(data.centerDelta) <= .25, `center line ${name} ${data.centerDelta}`);
  assert.equal(data.dpr, 2); assert.ok(data.rows.some(r => r.axis === 'x')); assert.ok(data.rows.some(r => r.axis === 'y'));
  measurements.push(data);
  await writeFile(path.join(out, 'ruler-measurements.json'), JSON.stringify({ measurements, operations, errors, blocked: [...blocked] }, null, 2));
  for (const row of data.rows) {
    assert.ok(Math.abs(row.labelDelta) <= .25, `${name} label ${JSON.stringify(row)}`);
    if (row.tickDelta !== null) assert.ok(Math.abs(row.tickDelta) <= .25, `${name} tick ${JSON.stringify(row)}`);
  }
  console.log('MEASURE PASS', name, 'ticks', data.rows.length, 'max label', Math.max(...data.rows.map(r => Math.abs(r.labelDelta))), 'max tick', Math.max(...data.rows.map(r => Math.abs(r.tickDelta ?? 0))));
}
try {
  for (const [index, c] of cases.entries()) {
    const context = await browser.newContext({ viewport: { width: c.viewport[0], height: c.viewport[1] }, deviceScaleFactor: 2 });
    await context.route('**/*', route => {
      const u = new URL(route.request().url());
      if (u.origin === origin || ['data:', 'blob:'].includes(u.protocol)) return route.continue();
      blocked.add(u.origin); return route.abort();
    });
    const page = await context.newPage(); lastPage = page; page.on('pageerror', e => errors.push(e.message));
    const project = fixture(c, index), name = `${index}-${c.mode}-${c.width}m-${c.counting}-${c.perspective ?? 'audience'}-${c.viewport.join('x')}`;
    await page.goto(origin, { waitUntil: 'domcontentloaded', timeout: 90000 }); await expect(page.locator('.library-shell')).toBeVisible();
    await page.evaluate(async project => {
      const { IndexedDbProjectRepository } = await import('/src/repositories/indexedDbRepository.ts');
      const r = new IndexedDbProjectRepository(); await r.initialize();
      await r.commit({ project, localRevision: '1', expectedRepositoryRevision: null, operationId: project.id }); r.close();
    }, project);
    await page.reload(); await page.getByRole('button', { name: `${project.title}を開く`, exact: true }).click();
    await expect(page.locator('.toolbar')).toBeVisible();
    const notice = page.getByRole('button', { name: 'お知らせを閉じる', exact: true }); if (await notice.count()) await notice.click();
    const surface = page.locator(c.mode === 'stage' ? '.stage-surface' : '.parade-stage');
    await expect(surface).toBeVisible(); await page.evaluate(() => document.fonts.ready); await settle(page);
    if (c.mode === 'stage') {
      await page.getByRole('button', { name: 'ステージを全体表示に戻す', exact: true }).click(); await settle(page);
    }
    if (c.scroll) {
      await page.locator('.parade-viewport').evaluate(v => { v.scrollTop = 450; }); await settle(page);
      assert.ok(await page.locator('.parade-viewport').evaluate(v => v.scrollTop) > 0);
    }
    await measure(page, c, name);
    if (index === 0 || c.shot) await page.screenshot({ path: path.join(out, `ruler-${c.mode}-${c.viewport.join('x')}.png`) });
    if (c.zoom) {
      const viewport = page.locator(c.mode === 'stage' ? '.stage-fit-area' : '.parade-viewport');
      const before = await surface.boundingBox();
      await viewport.evaluate(v => { const r = v.getBoundingClientRect(); v.dispatchEvent(new WheelEvent('wheel', { bubbles: true, cancelable: true, ctrlKey: true, deltaY: -100, clientX: r.left + r.width / 2, clientY: r.top + r.height / 2 })); });
      await expect.poll(async () => (await surface.boundingBox()).width).toBeGreaterThan(before.width + 1); await settle(page);
      await viewport.evaluate(v => { v.scrollLeft = 0; }); await settle(page);
      await measure(page, c, name + '-zoom');
    }
    if (index === 0) {
      const lines = await page.locator('.stage-grid-line').evaluateAll(elements => elements.map(e => e.dataset.position));
      await page.getByRole('tab', { name: 'ステージ', exact: true }).click();
      await page.getByRole('checkbox', { name: 'メートル目盛り', exact: true }).uncheck();
      await expect(page.locator('.stage-canvas-with-rulers')).toHaveClass(/hide-rulers/);
      await expect(page.locator('.meter-ruler--horizontal')).toBeHidden();
      assert.deepEqual(await page.locator('.stage-grid-line').evaluateAll(elements => elements.map(e => e.dataset.position)), lines);
      await page.getByRole('checkbox', { name: 'メートル目盛り', exact: true }).check();
      await expect(page.locator('.meter-ruler--horizontal')).toBeVisible(); await settle(page);
      await measure(page, c, name + '-rulers-restored');
      console.log('HIDE_RULERS PASS');
    }
    if (index === 6) {
      // Real canvas → raw context-menu point → App entry → save. Both target-specific lattices are independent of the ruler CSS.
      const read = () => page.evaluate(async id => {
        const { IndexedDbProjectRepository } = await import('/src/repositories/indexedDbRepository.ts');
        const repository = new IndexedDbProjectRepository(); const p = (await repository.get(id)).project; repository.close(); return p;
      }, project.id);
      const save = async () => { await page.locator('.toolbar-save-button').click(); await expect(page.locator('.toolbar-save-button')).not.toHaveClass(/is-dirty/); };
      const point = await page.locator('.parade-viewport').evaluate(v => {
        const r = v.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
      });
      for (const [kind, name] of [['member', 'メンバー追加'], ['object', '道具追加']]) {
        await page.mouse.click(point.x, point.y, { button: 'right' });
        await page.getByRole('button', { name, exact: true }).click(); await save();
        const stored = await read();
        const added = kind === 'member' ? stored.members.find(m => m.id !== 'm0') : stored.stageObjects[0];
        const position = kind === 'member' ? stored.frames[0].positions[added.id] : stored.frames[0].objectStates[added.id];
        const step = kind === 'member' ? .5 : .25;
        for (const [value, originValue] of [[position.x, c.width / 2], [position.y, project.paradeSettings.totalDistance]]) {
          const index = (value - originValue) / step;
          assert.ok(Math.abs(index - Math.round(index)) < 1e-7, JSON.stringify({ kind, position }));
        }
        operations.push({ kind, position });
        await page.keyboard.press('ControlOrMeta+Z'); await save();
        const undone = await read();
        assert.deepEqual(undone.frames[0].positions, project.frames[0].positions);
        assert.deepEqual(undone.frames[0].objectStates, project.frames[0].objectStates);
        console.log('CONTEXT ENTRY PASS', kind, JSON.stringify(position));
      }
    }
    await context.close();
  }
  assert.deepEqual(errors, []);
  await writeFile(path.join(out, 'ruler-measurements.json'), JSON.stringify({ measurements, operations, errors, blocked: [...blocked] }, null, 2));
  console.log('RULER_ALIGNMENT PASS');
} catch (error) {
  if (lastPage && !lastPage.isClosed()) await lastPage.screenshot({ path: path.join(out, 'ruler-failure.png') });
  throw error;
} finally { await browser.close(); }
