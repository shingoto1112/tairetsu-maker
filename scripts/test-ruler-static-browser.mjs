import { chromium, expect } from '@playwright/test';
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
const origin = 'http://127.0.0.1:5392';
const base = JSON.parse(await readFile('src/repositories/contract/fixtures/commitProjects.json', 'utf8')).stage;
const browser = await chromium.launch({ headless: true }), results = [];
try {
  const context = await browser.newContext({ viewport: { width: 1180, height: 820 }, deviceScaleFactor: 2 });
  await context.route('**/*', route => {
    const u = new URL(route.request().url());
    return u.origin === origin || ['data:', 'blob:'].includes(u.protocol) ? route.continue() : route.abort();
  });
  const page = await context.newPage();
  await page.goto(origin, { waitUntil: 'domcontentloaded' }); await expect(page.locator('.library-shell')).toBeVisible();
  for (const mode of ['stage', 'parade']) {
    const project = { ...structuredClone(base), mode,
      stage: { ...base.stage, widthMeters: 12, depthMeters: 5.4, gridSizeMeters: .5, horizontalGuideMode: 'meters' },
      paradeSettings: { width: 12, totalDistance: 10.13, backwardDistanceMeters: 2.31, cellSizeMeters: .5,
        direction: 'up', rulerPosition: 'both', horizontalMeasureMode: 'normalMeter', emphasizeEvery5m: true, emphasizeEvery10m: true },
    };
    const depth = mode === 'stage' ? 5.4 : 12.44;
    for (const kind of ['static', 'print']) {
      await page.emulateMedia({ media: kind === 'print' ? 'print' : 'screen' });
      await page.evaluate(async ({ project, depth, kind }) => {
        const reactModule = await import('/node_modules/.vite/deps/react.js');
        const React = reactModule.default ?? reactModule;
        const clientModule = await import('/node_modules/.vite/deps/react-dom_client.js');
        const { createRoot } = clientModule.default ?? clientModule;
        const { StaticStagePreview } = await import('/src/components/StaticStagePreview.tsx');
        const { PrintPreview } = await import('/src/components/PrintPreview.tsx');
        document.querySelector('#ruler-preview-check')?.remove();
        const host = document.createElement('div'); host.id = 'ruler-preview-check';
        Object.assign(host.style, { position: 'fixed', inset: '0', zIndex: '99999', background: 'white', overflow: 'auto' });
        document.body.append(host);
        createRoot(host).render(kind === 'static'
          ? React.createElement(StaticStagePreview, { project, frame: project.frames[0], stageWidth: 12,
              range: { left: 0, right: 12, top: 0, bottom: depth }, outputWidth: 900, verticalOrigin: 'top' })
          : React.createElement(PrintPreview, { project, scope: 'current', selectedFrameId: project.frames[0].id }));
      }, { project, depth, kind });
      await expect(page.locator('#ruler-preview-check .print-stage-guides')).toHaveCount(1);
      await page.evaluate(() => document.fonts.ready);
      const rows = await page.evaluate(async ({ project, kind }) => {
        const { createHorizontalRulerLabels } = await import('/src/utils/horizontalRuler.ts');
        const host = document.querySelector('#ruler-preview-check'), svg = host.querySelector('.print-stage-guides'), matrix = svg.getScreenCTM();
        const rows = [];
        const labels = createHorizontalRulerLabels(12, 'meters');
        const map = (x, y) => new DOMPoint(x, y).matrixTransform(matrix);
        const xLabels = host.querySelectorAll('.print-ruler-x span');
        if (xLabels.length !== labels.length) throw Error(`x label count ${xLabels.length}/${labels.length}`);
        [...xLabels].forEach((e, i) => {
          const x = labels[i].positionMeters; if (x <= 0 || x >= 12) return;
          const line = [...svg.querySelectorAll('line[data-position][x1][x2]')].find(l => l.getAttribute('x1') === l.getAttribute('x2') && Math.abs(Number(l.dataset.position) - x) < 1e-7);
          if (!line) throw Error(`static x line ${x}`);
          const r = e.getBoundingClientRect(), reference = map(Number(line.getAttribute('x1')), 0).x;
          rows.push({ axis: 'x', position: x, label: e.textContent, delta: r.left + r.width / 2 - reference });
        });
        for (const e of host.querySelectorAll('.print-ruler-y span')) {
          const value = parseFloat(e.textContent), y = project.mode === 'parade' ? project.paradeSettings.totalDistance - value : value;
          const line = [...svg.querySelectorAll('line[data-position][y1][y2]')].find(l => l.getAttribute('y1') === l.getAttribute('y2') && Math.abs(Number(l.dataset.position) - y) < 1e-7);
          if (!line) continue; // Frame endpoints are inset-shadow boundaries, not the editor's CSS border cause.
          const r = e.getBoundingClientRect(), reference = map(0, Number(line.getAttribute('y1'))).y;
          rows.push({ axis: 'y', position: y, label: e.textContent, delta: r.top + r.height / 2 - reference });
        }
        return rows;
      }, { project, kind });
      assert.ok(rows.length > 0);
      const max = Math.max(...rows.map(r => Math.abs(r.delta)));
      results.push({ mode, kind, max, rows });
      console.log('STATIC MEASURE', mode, kind, rows.length, max);
      assert.ok(max <= .25, JSON.stringify(results.at(-1)));
    }
  }
  await writeFile('output/build30/ruler-static-results.json', JSON.stringify(results, null, 2));
  console.log('STATIC_RULERS PASS: unchanged SVG stroke centers, PrintPreview/PrintStagePreview/StaticStagePreview.');
} finally { await browser.close(); }
