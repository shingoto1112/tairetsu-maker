import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { chromium, expect } from '@playwright/test';
import { PNG } from 'pngjs';
import { createServer } from 'vite';

const origin = 'http://127.0.0.1:5380';
const shots = process.env.ANNOTATION_SHOT_DIR ?? path.join(os.tmpdir(), 'tairetsu-shots-annotation-improvements');
const vite = await createServer({ envFile: false, server: { host: '127.0.0.1', port: 5380, strictPort: true }, logLevel: 'warn' });
let browser;
try {
  await vite.listen(); console.log('Owned annotation verification PID', process.pid);
  browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1376, height: 1032 }, hasTouch: true });
  // All browser requests are confined to this local test server.
  await context.route('**/*', route => {
    const u = new URL(route.request().url());
    return u.origin === origin || ['blob:', 'data:'].includes(u.protocol) ? route.continue() : route.abort();
  });
  const page = await context.newPage(), errors = [], results = [];
  page.on('pageerror', e => errors.push(e.message));
  await mkdir(shots, { recursive: true }); await page.goto(origin);
  await page.evaluate(async () => {
    const { IndexedDbProjectRepository } = await import('/src/repositories/indexedDbRepository.ts');
    const { normalizeProject } = await import('/src/project/normalizeProject.ts');
    const { formationExportFixture } = await import('/src/utils/formationExportFixture.ts');
    const repo = new IndexedDbProjectRepository(); await repo.initialize();
    for (const mode of ['stage', 'parade']) {
      const p = normalizeProject(formationExportFixture());
      p.id = `half-lines-${mode}`; p.title = `線改善検証${mode}`; p.mode = mode; p.audio = null;
      p.stage.gridSizeMeters = 0.5; p.stage.horizontalGuideMode = 'centerSplit'; p.stage.memberDiameterMeters = 1.2;
      const y = mode === 'stage' ? 2.25 : 2.13;
      p.members = [
        { id: 'm0', name: 'A', color: '#0d8b78', zIndex: -1000000 },
        { id: 'm1', name: 'B', color: '#0d8b78', zIndex: 1000000 },
        { id: 'm2', name: 'C', color: '#0d8b78', zIndex: -2000000 },
      ];
      p.memberGroups = [];
      p.stageObjects[0] = { ...p.stageObjects[0], defaultRotation: 0, zIndex: 2000000 };
      p.frames = p.frames.slice(0, 1);
      p.frames[0].positions = { m0: { x: 3.25, y }, m1: { x: 6.25, y }, m2: { x: 8.75, y } };
      p.frames[0].objectAssignments = {};
      p.frames[0].objectStates = { flag: { objectId: 'flag', x: 8, y: y - 0.75, widthMeters: 1.5, heightMeters: 1.5, rotation: 0, visible: true, zIndex: 2000000 } };
      p.frames[0].sceneViewState = { scrollTop: 0, scrollLeft: 0, zoom: 1 };
      p.frames[0].annotationLines = {
        existing: { x1: 3.25, y1: y, x2: 9.25, y2: y, color: 'red', dash: 'solid' },
        offgrid: { x1: 1.137, y1: 4.193, x2: 8.217, y2: 5.319, color: 'green', dash: 'dashed' },
      };
      if (mode === 'parade') p.paradeSettings = { width: 12, totalDistance: 30.13, backwardDistanceMeters: 2.31, cellSizeMeters: 0.5, direction: 'up', rulerPosition: 'both', horizontalMeasureMode: 'centerSplit', emphasizeEvery5m: true, emphasizeEvery10m: true };
      await repo.commit({ project: p, localRevision: '1', expectedRepositoryRevision: null, operationId: `seed-half-${mode}` });
    }
    repo.close();
  });
  const drag = async (a, b) => { await page.mouse.move(a.x, a.y); await page.mouse.down(); await page.mouse.move(b.x, b.y, { steps: 8 }); await page.mouse.up(); };
  const pixel = (buffer, point) => {
    const p = PNG.sync.read(buffer), i = (Math.round(point.y) * p.width + Math.round(point.x)) * 4;
    return [...p.data.subarray(i, i + 3)];
  };
  for (const mode of ['stage', 'parade']) {
    await page.goto(origin); await page.getByRole('button', { name: `線改善検証${mode}を開く`, exact: true }).click();
    if (mode === 'stage') await page.getByRole('button', { name: 'ステージを全体表示に戻す' }).click();
    const surface = page.locator(mode === 'stage' ? '.stage-surface' : '.parade-stage');
    const ink = surface.locator('.annotation-layer'), input = surface.locator('.annotation-interaction-layer');
    await expect(ink.locator('[data-annotation-line]')).toHaveCount(2);
    const svgBox = await input.boundingBox(), depth = mode === 'stage' ? 8 : 32.44;
    const at = (x, y) => ({ x: svgBox.x + svgBox.width * x / 12, y: svgBox.y + svgBox.height * y / depth });
    const y = mode === 'stage' ? 2.25 : 2.13;
    let overlap, start, middle;
    const refresh = async () => { Object.assign(svgBox, await input.boundingBox()); overlap = at(3.65, y); start = at(3.25, y); middle = at(6.25, y); };
    await refresh();
    const members = surface.locator(mode === 'stage' ? '.member-token' : '.parade-member');
    const objects = surface.locator(mode === 'stage' ? '.stage-object' : '.parade-object');
    const positions = () => members.evaluateAll(nodes => nodes.map(n => [n.style.left, n.style.top]));
    const beforePositions = await positions();
    const layers = await surface.evaluate(el => {
      const z = s => Number(getComputedStyle(el.querySelector(s)).zIndex);
      return { grid: z('.stage-grid-layer, .parade-grid-layer'), ink: z('.annotation-layer'), entities: z('.canvas-elements-layer'), input: z('.annotation-interaction-layer') };
    });
    assert(layers.grid < layers.ink && layers.ink < layers.entities && layers.entities < layers.input);
    assert.deepEqual(await members.evaluateAll(nodes => nodes.map(n => n.style.zIndex)), ['-1000000', '1000000', '-2000000']);
    const normalPixel = pixel(await page.screenshot(), overlap); assert.deepEqual(normalPixel, [13, 139, 120]);
    await page.getByRole('button', { name: '線を引く', exact: true }).click();
    await refresh();
    assert.equal(await input.evaluate(el => getComputedStyle(el).pointerEvents), 'auto');
    assert.equal(await ink.evaluate(el => getComputedStyle(el).pointerEvents), 'none');
    assert.equal(await members.first().evaluate(el => getComputedStyle(el).pointerEvents), 'none');
    // New drawing starts in blank space; its preview crosses people from the first frame.
    await page.mouse.move(at(1.25, y).x, at(1.25, y).y); await page.mouse.down();
    await expect(ink.locator('[data-annotation-line]')).toHaveCount(3);
    await page.mouse.move(at(10.25, y).x, at(10.25, y).y, { steps: 8 });
    assert.deepEqual(pixel(await page.screenshot(), overlap), normalPixel);
    await page.screenshot({ path: `${shots}/${mode}-drawing-preview.png` });
    await page.keyboard.press('Escape'); await page.mouse.up();
    await expect(ink.locator('[data-annotation-line]')).toHaveCount(2);
    await page.getByRole('button', { name: '線を引く', exact: true }).click();
    await refresh();
    // Select a line through a member, then adjust its endpoint under another member.
    await page.mouse.click(middle.x, middle.y);
    await expect(input.locator('[data-endpoint]')).toHaveCount(2);
    assert.equal(await page.evaluate(p => document.elementFromPoint(p.x, p.y)?.getAttribute('data-endpoint'), start), 'start');
    await page.screenshot({ path: `${shots}/${mode}-line-mode-handles.png` });
    const handleBox = await input.locator('circle[pointer-events="none"]').first().boundingBox();
    assert.deepEqual(pixel(await page.screenshot(), { x: handleBox.x + handleBox.width / 2, y: handleBox.y + handleBox.height / 2 }), [255, 255, 255]);
    assert.equal(await input.locator('[data-annotation-line]').count(), 0);
    await drag(start, at(3.5, y + 0.25));
    const read = id => ink.locator(`[data-annotation-line="${id}"]`).evaluate(el => Object.fromEntries(['x1', 'y1', 'x2', 'y2'].map(k => [k, Number(el.getAttribute(k))])));
    assert.deepEqual(await read('existing'), { x1: 3.5, y1: Number((y + 0.25).toFixed(9)), x2: 9.25, y2: y });
    assert.deepEqual(await positions(), beforePositions);
    // Hit the line away from its handles. Moving the whole line keeps its vector.
    const previous = await read('existing'), lineMiddle = at((previous.x1 + previous.x2) / 2, (previous.y1 + previous.y2) / 2);
    await drag(lineMiddle, { x: lineMiddle.x + svgBox.width * 0.25 / 12, y: lineMiddle.y + svgBox.height * 0.25 / depth });
    const moved = await read('existing');
    assert(Math.abs((moved.x2 - moved.x1) - (previous.x2 - previous.x1)) < 1e-9);
    assert(Math.abs((moved.y2 - moved.y1) - (previous.y2 - previous.y1)) < 1e-9);
    assert.deepEqual(await positions(), beforePositions);
    // Capture uses the app's actual export utility while handles remain visible on screen.
    const capture = await surface.evaluate(async el => {
      const { withExportClone, elementToPngBlob } = await import('/src/utils/exportImage.ts');
      const cloneState = await withExportClone(el, async clone => ({ handles: clone.querySelectorAll('[data-endpoint]').length, input: clone.querySelectorAll('.annotation-interaction-layer').length, lines: clone.querySelectorAll('[data-annotation-line]').length }));
      const blob = await elementToPngBlob(el, { pixelRatio: 1 });
      return { cloneState, bytes: [...new Uint8Array(await blob.arrayBuffer())] };
    });
    assert.deepEqual(capture.cloneState, { handles: 0, input: 0, lines: 2 });
    await writeFile(`${shots}/${mode}-camera-export.png`, Buffer.from(capture.bytes));
    await expect(input.locator('[data-endpoint]')).toHaveCount(2);
    const offgrid = await read('offgrid');
    assert.deepEqual(offgrid, { x1: 1.137, y1: 4.193, x2: 8.217, y2: 5.319 });
    await page.getByRole('button', { name: '完了', exact: true }).click();
    await refresh();
    for (const layer of [ink, input]) assert.equal(await layer.evaluate(el => getComputedStyle(el).pointerEvents), 'none');
    // Normal member and object dragging still work through the new containing layer.
    assert.equal(await members.first().evaluate(el => getComputedStyle(el).pointerEvents), 'auto');
    await drag(start, at(4.25, y + 0.5));
    assert.notDeepEqual(await positions(), beforePositions);
    await page.getByRole('tab', { name: '道具', exact: true }).click();
    const object = objects.first(); await expect(object).toHaveCount(1);
    const objectBefore = await object.evaluate(el => [el.style.left, el.style.top]);
    const box = await object.boundingBox();
    await drag({ x: box.x + box.width / 2, y: box.y + box.height / 2 }, { x: box.x + box.width / 2 + 50, y: box.y + box.height / 2 + 25 });
    assert.notDeepEqual(await object.evaluate(el => [el.style.left, el.style.top]), objectBefore);
    assert.deepEqual(await read('offgrid'), offgrid);
    // Two touch points cancel ink while leaving the viewport's pinch handling available.
    await page.getByRole('tab', { name: 'メンバー', exact: true }).click();
    await page.getByRole('button', { name: '線を引く', exact: true }).click();
    await refresh();
    const cdp = await context.newCDPSession(page), a = at(1.25, 3.25), b = at(4.25, 3.25);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ ...a, id: 1 }] });
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ ...a, y: a.y + 20, id: 1 }] });
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ ...a, y: a.y + 20, id: 1 }, { ...b, id: 2 }] });
    await expect(ink.locator('[data-annotation-line]')).toHaveCount(2);
    for (let i = 1; i <= 4; i++) await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ ...a, x: a.x - i * 10, y: a.y + 20, id: 1 }, { ...b, x: b.x + i * 10, id: 2 }] });
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }); await cdp.detach();
    await expect(ink.locator('[data-annotation-line]')).toHaveCount(2);
    await page.getByRole('button', { name: '完了', exact: true }).click();
    await expect.poll(async () => (await input.boundingBox()).width).not.toBe(svgBox.width);
    if (mode === 'parade') {
      const viewport = page.locator('.parade-viewport');
      const top = await viewport.evaluate(el => el.scrollTop);
      const box = await viewport.boundingBox(); await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2); await page.mouse.wheel(0, 150);
      await expect.poll(() => viewport.evaluate(el => el.scrollTop)).not.toBe(top);
    }
    results.push({ mode, layers, preview: 'below people from pointer-down', overlap: 'line selection and endpoint priority; people unchanged', movement: 'half-step and vector preserved', output: capture.cloneState, normal: 'member/object dragging restored', multitouch: 'ink cancelled; pinch changed zoom', offgrid: 'unchanged' });
  }
  assert.deepEqual(errors, []);
  const report = { results, errors, shots, viewport: '1376x1032' };
  await writeFile(`${shots}/results.json`, JSON.stringify(report, null, 2)); console.log(JSON.stringify(report, null, 2));
} finally { await browser?.close(); await vite.close(); }
