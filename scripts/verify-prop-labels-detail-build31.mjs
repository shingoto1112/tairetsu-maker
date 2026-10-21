import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { PNG } from 'pngjs';
import { compare, compareGraphemes } from './vector-pdf-visual-diff.mjs';

// Called by the offline harness: same production modules, ports, font files and
// browser settings as the full-document checks. No additional server or network.
export async function verifyDetails(page, context, screen, directory) {
  const results = [];
  for (const mode of ['stage', 'parade']) {
    const name = `${screen.name}-${mode}-detail`;
    console.log('Generating', name);
    const data = await page.evaluate(async mode => {
      const h = window.h, mm = 25.4 / 96, p = h.formationExportFixture();
      p.mode = mode; p.title = '道具名・拡大検証';
      p.stage = { ...p.stage, widthMeters: 12, depthMeters: 20, frontDirection: 'bottom' };
      p.paradeSettings = { totalDistance: 80, backwardDistanceMeters: 5, width: 12, cellSizeMeters: 1,
        direction: 'up', rulerPosition: 'both', horizontalMeasureMode: 'centerSplit', emphasizeEvery5m: true, emphasizeEvery10m: true };
      const names = ['みかん箱1', 'みかん箱2', 'みかん箱準備', '大旗①', '舞妓台', '襖幕2', '箱', '旗👩🏽‍🎤', '箱한글', '箱e\u0301'];
      // All specified rotations on square/capsule props, a narrow curtain, and
      // tiny props with numbered names. Keep their surrounding area clear.
      p.stageObjects = Array.from({ length: 25 }, (_, i) => ({ id: `o${i}`, type: 'prop', name: names[i % 10],
        color: '#2563eb', shape: i % 5 === 3 ? 'circle' : i % 5 === 4 ? 'curtain' : 'rectangle',
        widthMeters: i >= 20 ? .05 : i % 5 === 4 ? 2.2 : 1.2,
        heightMeters: i >= 20 ? .04 : i % 5 === 4 ? .15 : .8,
        defaultX: .8 + i % 5 * 2.2, defaultY: 1 + Math.floor(i / 5) * (mode === 'stage' ? 3.6 : 16),
        defaultRotation: [0, 45, 90, 137, 180][i % 5], visible: true, locked: false, zIndex: 0 }));
      p.members = [{ id: 'm0', name: '担当', color: '#0d8b78' }];
      p.frames = [{ id: 's0', label: 'ラベル検査', timeSec: 0, positions: { m0: { x: 11.5, y: mode === 'stage' ? 19 : 84 } },
        objectStates: Object.fromEntries(p.stageObjects.map(o => [o.id, { objectId: o.id, x: o.defaultX, y: o.defaultY,
          widthMeters: o.widthMeters, heightMeters: o.heightMeters, rotation: o.defaultRotation, visible: true, zIndex: 0 }])),
        objectAssignments: { o0: ['m0'], o3: ['m0'], o4: ['m0'], o20: ['m0'] } }];
      const original = JSON.stringify(p), options = { ...h.layout.defaultPrintOptions, includeAssignments: true };
      h.flushSync(() => h.root.render(h.React.createElement(h.PrintPreview, { project: p, options })));
      const doc = document.querySelector('.print-document'); doc.classList.add('is-exporting'); doc.style.fontFamily = 'BIZUDPGothic';
      const checks = [], models = [], factor = 6;
      const inspect = root => {
        const measure = h.labels.createPrintObjectLabelMeasurer();
        for (const label of root.querySelectorAll('[data-print-object-label]')) {
          const { input, style } = h.labels.labelInput(label), expected = measure(input, style);
          const object = label.parentElement, local = object.cloneNode(true);
          const actualBox = object.getBoundingClientRect(), anchor = label.getBoundingClientRect(), css = getComputedStyle(object);
          const targetX = actualBox.x + actualBox.width / 2 + (input.width / mm - parseFloat(css.width)) / 2;
          const targetY = actualBox.y + actualBox.height / 2 + (input.height / mm - parseFloat(css.height)) / 2;
          if (Math.abs(anchor.x - targetX) * mm > .01 || Math.abs(anchor.y - targetY) * mm > .01) throw Error('Label anchor left saved shape centre');
          Object.assign(local.style, { position: 'fixed', left: '0', top: '0', transform: 'none', fontFamily: style.family, width: css.width, height: css.height });
          Object.assign(local.querySelector('[data-print-object-label]').style, { transform: 'none', left: '50%', top: '50%' });
          document.body.append(local);
          try {
            const rect = local.getBoundingClientRect(), localRows = [...local.querySelectorAll('.print-object-label__line')];
            const actual = localRows.map(row => {
              const range = document.createRange(); range.selectNodeContents(row); const r = range.getBoundingClientRect();
              return { text: row.textContent, x: (r.x + r.width / 2 - rect.x - rect.width / 2) * mm,
                y: (r.y + r.height / 2 - rect.y - rect.height / 2) * mm, width: r.width * mm, height: r.height * mm,
                size: parseFloat(getComputedStyle(row).fontSize) * mm };
            });
            if (actual.map(row => row.text).join('') !== input.text) throw Error('Actual DOM text lost: ' + input.text);
            if (actual.length > 2 || actual.some(row => row.size < 1.8 - .0001 || row.size > input.maxSize + .0001)) throw Error('Actual DOM size/count invalid');
            // Independently check DOM Range corners against the outer shape,
            // including the interior arc. Expected padding-fit is checked separately.
            let inside = true;
            const hw = rect.width * mm / 2, hh = rect.height * mm / 2, radius = object.classList.contains('shape-circle') ? Math.min(hw, hh) : 0;
            for (const row of actual) for (const sx of [-1, 1]) for (const sy of [-1, 1]) {
              const x = Math.abs(row.x + sx * row.width / 2), y = Math.abs(row.y + sy * row.height / 2);
              if (x > hw + .01 || y > hh + .01 || Math.hypot(Math.max(0, x - hw + radius), Math.max(0, y - hh + radius)) > radius + .01) inside = false;
            }
            if (!expected.overflow && !inside) throw Error('Actual glyph bounds outside shape: ' + JSON.stringify({ input, actual }));
            if (expected.overflow && (actual.length !== 1 || Math.abs(actual[0].x) > .01 || Math.abs(actual[0].y) > .01)) throw Error('Overflow not centred');
            if (getComputedStyle(object).overflow !== 'visible') throw Error('Object clips label');
            checks.push({ text: input.text, assignment: object.classList.contains('print-assignment-sheet__object'),
              shape: object.className, rotation: object.style.transform, width: input.width, height: input.height,
              cssWidth: css.width, cssHeight: css.height, anchor: label.style.cssText,
              size: expected.size, lines: actual, overflow: expected.overflow, actualInside: inside });
          } finally { local.remove(); }
        }
      };
      let renderDoc;
      const result = await h.withExportClone(doc, async clone => {
        clone.style.fontFamily = 'BIZUDPGothic'; const built = h.vector.buildA4Document(p, ['s0'], clone, options);
        inspect(clone); models.push(...built); renderDoc = clone.cloneNode(true);
        return await h.renderScenePages(built, { title: p.title, orientation: h.layout.getPrintOrientation(p), fillStrokes: mode === 'parade', clipPage: mode === 'parade' });
      });
      // Tight label comparisons exclude the legacy CSS minimum prop border box
      // and grid sampling: these have independent whole-document regressions.
      // Keep group transforms, and only retain prop-label text descendants.
      const onlyLabels = nodes => nodes.flatMap(n => n.kind === 'group' ? [{ ...n,
        children: n.id.endsWith('-label') ? n.children : onlyLabels(n.children) }] : []);
      const labelPdf = await h.renderScenePages(models.map(m => ({ ...m, drawings: onlyLabels(m.drawings) })),
        { title: p.title, orientation: h.layout.getPrintOrientation(p), fillStrokes: mode === 'parade', clipPage: mode === 'parade' });
      const pdf = await h.pdfjs.getDocument({ data: new Uint8Array(await labelPdf.blob.arrayBuffer()), useSystemFonts: false }).promise;
      const pdfPage = await pdf.getPage(1), viewport = pdfPage.getViewport({ scale: factor });
      const canvas = document.createElement('canvas'); canvas.width = Math.ceil(viewport.width); canvas.height = Math.ceil(viewport.height);
      await pdfPage.render({ canvasContext: canvas.getContext('2d'), viewport }).promise;
      const pdfImage = canvas.toDataURL('image/png'); canvas.width = 0; canvas.height = 0;
      const extracted = (await pdfPage.getTextContent()).items.filter(x => 'str' in x).map(x => x.str);
      const plain = extracted.join('').replace(/\s/g, '');
      for (const text of names.slice(0, 7)) if (!plain.includes(text)) throw Error('PDF full name missing: ' + text);
      // Real public fallback, triggered after DOM creation by an unsupported
      // model shape. The production fallback preserves that rectangular DOM.
      const shape = p.stageObjects[0].shape; p.stageObjects[0].shape = 'test-unsupported-shape';
      const fallback = await h.generateA4Pdf({ project: p, frameIds: ['s0'], element: doc, options, title: p.title });
      p.stageObjects[0].shape = shape;
      if (!h.vector.vectorPdfDiagnostics().some(x => x.reason.includes('test-unsupported-shape'))) throw Error('Public fallback not exercised');
      const fallbackPdf = await h.pdfjs.getDocument({ data: new Uint8Array(await fallback.blob.arrayBuffer()) }).promise;
      const fallbackPage = await fallbackPdf.getPage(1), fallbackView = fallbackPage.getViewport({ scale: 2 });
      canvas.width = Math.ceil(fallbackView.width); canvas.height = Math.ceil(fallbackView.height);
      await fallbackPage.render({ canvasContext: canvas.getContext('2d'), viewport: fallbackView }).promise;
      const fallbackImage = canvas.toDataURL('image/png'); canvas.width = 0; canvas.height = 0;
      const a4 = h.a4PageSize(h.layout.getPrintOrientation(p)), w = Math.ceil(models[0].width / mm - 1e-7), height = Math.ceil(models[0].height / mm - 1e-7);
      const fit = h.fitPdfImage(w, height, a4.width, a4.height), zoom = fit.width * factor / w;
      const wrapper = document.createElement('div'); wrapper.dataset.detailReference = '';
      Object.assign(wrapper.style, { position: 'fixed', left: '0', top: '0', width: Math.ceil(a4.width * factor) + 'px', height: Math.ceil(a4.height * factor) + 'px', background: 'white', overflow: 'hidden', zIndex: '20000' });
      const sheet = renderDoc.querySelector('.print-page');
      Object.assign(sheet.style, { position: 'absolute', left: '0', top: '0', margin: '0', transformOrigin: '0 0', transform: `translate(${fit.x * factor}px,${fit.y * factor}px) scale(${zoom})`, fontFamily: 'BIZUDPGothic' });
      wrapper.append(sheet); document.body.append(wrapper);
      sheet.style.visibility = 'hidden';
      sheet.querySelectorAll('[data-print-object-label]').forEach(label => { label.style.visibility = 'visible'; });
      const boxes = [...sheet.querySelectorAll('[data-print-object-label]')].map(label => {
        const rows = [...label.querySelectorAll('.print-object-label__line')].map(row => { const range = document.createRange(); range.selectNodeContents(row); return range.getBoundingClientRect(); });
        const left = Math.min(...rows.map(r => r.left)), top = Math.min(...rows.map(r => r.top));
        const right = Math.max(...rows.map(r => r.right)), bottom = Math.max(...rows.map(r => r.bottom));
        return { text: label.dataset.labelText, x: Math.floor(left - 12), y: Math.floor(top - 12), width: Math.ceil(right - left + 24), height: Math.ceil(bottom - top + 24) };
      });
      // Camera uses PrintPreview(stage-only), not the live editor canvas.
      h.flushSync(() => h.root.render(h.React.createElement(h.PrintPreview, { project: p, scope: 'current', selectedFrameId: 's0', variant: 'stage-only', options: { ...options, includeAssignments: false, includeSceneName: false } })));
      const cameraDoc = document.querySelector('#root .print-document');
      cameraDoc.classList.add('is-exporting');
      const camera = await h.elementToPngBlob(cameraDoc, { pixelRatio: 2 });
      const { cameraImageToPdfBlob } = await import('/src/utils/pdfExport.ts'); const cameraPdf = await cameraImageToPdfBlob(camera, p.title);
      await h.withExportClone(cameraDoc, async clone => { inspect(clone); if (clone.querySelector('.print-assignment-sheet,.print-scene-title')) throw Error('Camera contains export UI'); });
      const range = { left: 0, right: 12, top: 0, bottom: mode === 'stage' ? 20 : 85 };
      h.flushSync(() => h.root.render(h.React.createElement(h.StaticStagePreview, { project: p, frame: p.frames[0], stageWidth: 12, range, outputWidth: 800 })));
      const staticDoc = document.querySelector('.static-stage-preview');
      const staticImage = await h.elementToPngBlob(staticDoc, { pixelRatio: 2 });
      await h.withExportClone(staticDoc, async clone => inspect(clone));
      h.flushSync(() => h.root.render(h.React.createElement(h.StaticStagePreview, { project: p, frame: p.frames[0], stageWidth: 12, range, outputWidth: 300, hideLabels: true })));
      if (document.querySelector('#root [data-print-object-label]')) throw Error('Hidden static labels reappeared');
      if (JSON.stringify(p) !== original) throw Error('Project mutated');
      return { mode, checks, boxes, extracted, pageExtent: { width: models[0].width, height: models[0].height, fit }, pass: true, width: Math.ceil(a4.width * factor), height: Math.ceil(a4.height * factor),
        pdf: await window.encode(result.blob), pdfImage, fallback: await window.encode(fallback.blob), fallbackImage,
        camera: await window.encode(camera), cameraPdf: await window.encode(cameraPdf), staticImage: await window.encode(staticImage) };
    }, mode);
    const cdp = await context.newCDPSession(page);
    const shot = await cdp.send('Page.captureScreenshot', { format: 'png', clip: { x: 0, y: 0, width: data.width, height: data.height, scale: 1 }, captureBeyondViewport: true });
    await cdp.detach();
    const ref = PNG.sync.read(Buffer.from(shot.data, 'base64')), actual = PNG.sync.read(Buffer.from(data.pdfImage.split(',')[1], 'base64'));
    assert.equal(ref.width, actual.width); assert.equal(ref.height, actual.height);
    // Pack tight crops into a contact sheet; this also prevents a missing small
    // label from being diluted by the rest of the A4 page.
    const tileW = Math.ceil((Math.max(...data.boxes.map(b => b.width)) + 10) / 3) * 3;
    const tileH = Math.ceil((Math.max(...data.boxes.map(b => b.height)) + 10) / 3) * 3;
    const atlas = () => { const image = new PNG({ width: tileW * 5, height: tileH * Math.ceil(data.boxes.length / 5) }); image.data.fill(255); return image; };
    const a = atlas(), b = atlas(), regions = {}, fallbackBoxes = [];
    data.boxes.forEach((box, i) => {
      const x = i % 5 * tileW, y = Math.floor(i / 5) * tileH;
      PNG.bitblt(ref, a, box.x, box.y, box.width, box.height, x, y); PNG.bitblt(actual, b, box.x, box.y, box.width, box.height, x, y);
      const packed = { x, y, width: box.width, height: box.height };
      if (/👩|한|\u0301/u.test(box.text)) fallbackBoxes.push(packed); else regions[`${i}:${box.text}`] = [packed];
    });
    // Retain 432dpi crops for human inspection, but run the EXISTING 2px AA
    // support at its original 144dpi. Applying a fixed 2px window at 3x the
    // resolution would change the established sampling tolerance.
    const at144dpi = source => {
      const out = new PNG({ width: source.width / 3, height: source.height / 3 });
      for (let y = 0; y < out.height; y++) for (let x = 0; x < out.width; x++) for (let c = 0; c < 4; c++) {
        let total = 0;
        for (let dy = 0; dy < 3; dy++) for (let dx = 0; dx < 3; dx++) total += source.data[((y * 3 + dy) * source.width + x * 3 + dx) * 4 + c];
        out.data[(y * out.width + x) * 4 + c] = Math.round(total / 9);
      }
      return PNG.sync.write(out);
    };
    const scaleBox = box => ({ x: box.x / 3, y: box.y / 3, width: box.width / 3, height: box.height / 3 });
    const ordinary = compare(at144dpi(a), at144dpi(b), Object.fromEntries(Object.entries(regions).map(([key, boxes]) => [key, boxes.map(scaleBox)])));
    const mixed = compareGraphemes(at144dpi(a), at144dpi(b), fallbackBoxes.map(scaleBox));
    await writeFile(`${directory}/${name}-dom-labels.png`, PNG.sync.write(a));
    await writeFile(`${directory}/${name}-pdf-labels.png`, PNG.sync.write(b));
    await writeFile(`${directory}/${name}-labels-diff.png`, ordinary.diff);
    const { pdf, pdfImage, fallback, fallbackImage, camera, cameraPdf, staticImage, ...record } = data;
    for (const [suffix, encoded] of Object.entries({ '.pdf': pdf, '-fallback.pdf': fallback, '-fallback.png': fallbackImage, '-camera.png': camera, '-camera.pdf': cameraPdf, '-static.png': staticImage }))
      await writeFile(`${directory}/${name}${suffix}`, Buffer.from(encoded.split(',')[1], 'base64'));
    record.comparison = ordinary.result; record.mixed = mixed.glyphs; record.pass = ordinary.pass && mixed.pass;
    await writeFile(`${directory}/${name}-results.json`, JSON.stringify(record, null, 2));
    results.push(record); console.log(name, 'pass:', record.pass, 'geometry labels:', record.checks.length, 'max ordinary ratio:', Math.max(...Object.values(ordinary.result).map(r => r.ratio)));
    await page.evaluate(() => document.querySelector('[data-detail-reference]')?.remove());
  }
  return results;
}
