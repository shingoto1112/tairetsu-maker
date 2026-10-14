import { chromium, expect } from '@playwright/test';
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

// Isolated local IndexedDB + all external requests blocked. No production services.
const origin = process.env.REPOSITORY_TEST_ORIGIN ?? 'http://127.0.0.1:5392';
const out = path.resolve('output/build30');
await mkdir(out, { recursive: true });
const base = JSON.parse(await readFile('src/repositories/contract/fixtures/commitProjects.json', 'utf8')).stage;
const names = ['男右1', '鈴木一郎', 'たかはしゆ', '佐々木小次郎', 'Takahashi', 'あいうえおかき', 'AB12', '男右10'];
const fixture = (mode, width, height) => ({
  ...structuredClone(base), id: `build30-${mode}-${width}`, title: `build30 ${mode} ${width}x${height}`, mode,
  viewerPerspective: 'performer', guideSettings: { snapGuideEnabled: false, snapToGuideEnabled: false },
  stage: { ...base.stage, widthMeters: 9, depthMeters: 5.4, gridSizeMeters: .5, showGrid: true,
    frontDirection: 'bottom', horizontalGuideMode: 'centerSplit', memberDiameterMeters: .4 },
  paradeSettings: { width: 9, totalDistance: 10.13, backwardDistanceMeters: 2.31, cellSizeMeters: .5,
    direction: 'up', rulerPosition: 'both', horizontalMeasureMode: 'centerSplit', emphasizeEvery5m: true, emphasizeEvery10m: true },
  members: names.map((name, i) => ({ id: `m${i}`, name, color: '#0d8b78', visible: true })),
  memberGroups: [], objectGroups: [],
  stageObjects: [{ id: 'o0', type: 'prop', name: '道具', color: '#2563eb', shape: 'rectangle',
    widthMeters: .73, heightMeters: .8, defaultX: 7.7, defaultY: mode === 'stage' ? 3.8 : 3.73,
    defaultRotation: 0, visible: true, locked: false, zIndex: 0 }],
  frames: [{ id: 's0', label: 'シーン1', timeSec: 0,
    positions: Object.fromEntries(names.map((_, i) => [`m${i}`, { x: (mode === 'stage' ? 2 : .4) + i % 4 * (mode === 'stage' ? 1.5 : .75), y: (i < 4 ? 1.6 : 3.4) }])),
    memberVisibility: {}, objectStates: { o0: { objectId: 'o0', x: 7.7, y: mode === 'stage' ? 3.8 : 3.73,
      widthMeters: .73, heightMeters: .8, rotation: 0, visible: true, zIndex: 0 } },
    ...(mode === 'parade' ? { sceneViewState: { zoom: (width === 1180 ? 42 : 31) / .4 / 32, scrollLeft: 0, scrollTop: 0 } } : {}) }],
});
const results = [], operations = [], errors = [], blocked = new Set();
if (process.argv[2]) {
  try { const prior = JSON.parse(await readFile(path.join(out, 'browser-results.json'), 'utf8')); results.push(...prior.results); operations.push(...prior.operations); } catch {}
}
const record = (records, value) => {
  const index = records.findIndex(item => item.mode === value.mode && item.width === value.width);
  if (index < 0) records.push(value); else records[index] = value;
};
const browser = await chromium.launch({ headless: true });
let lastPage;
const save = async page => {
  await page.locator('.toolbar-save-button').click();
  await expect(page.locator('.toolbar-save-button')).not.toHaveClass(/is-dirty/);
};
const read = (page, id) => page.evaluate(async id => {
  const { IndexedDbProjectRepository } = await import('/src/repositories/indexedDbRepository.ts');
  const repository = new IndexedDbProjectRepository();
  const project = (await repository.get(id)).project; repository.close(); return project;
}, id);
const lattice = (value, step, origin) => Math.abs((value - origin) / step - Math.round((value - origin) / step)) < 1e-6;
try {
  for (const mode of ['stage', 'parade']) for (const [width, height] of [[1180, 820], [820, 1180]]) {
    if (process.argv[2] && process.argv[2] !== mode && process.argv[2] !== `${mode}-${width}`) continue;
    const context = await browser.newContext({ viewport: { width, height } });
    await context.route('**/*', route => {
      const url = new URL(route.request().url());
      if (url.origin === origin || ['data:', 'blob:'].includes(url.protocol)) return route.continue();
      blocked.add(url.origin); return route.abort();
    });
    const page = await context.newPage(); lastPage = page; page.on('pageerror', error => errors.push(error.message));
    page.setDefaultTimeout(45000);
    page.on('requestfailed', request => { if (request.url().startsWith(origin)) console.log('LOCAL REQUEST FAILED', request.url(), request.failure()?.errorText); });
    const project = fixture(mode, width, height);
    await writeFile(path.join(out, `${mode}-${width}x${height}-fixture.json`), JSON.stringify(project, null, 2));
    await page.goto(origin, { waitUntil: 'domcontentloaded', timeout: 90000 }); await expect(page.locator('.library-shell')).toBeVisible();
    await page.evaluate(async project => {
      const { IndexedDbProjectRepository } = await import('/src/repositories/indexedDbRepository.ts');
      const repository = new IndexedDbProjectRepository(); await repository.initialize();
      await repository.commit({ project, localRevision: '1', expectedRepositoryRevision: null, operationId: project.id }); repository.close();
    }, project);
    await page.reload(); await page.getByRole('button', { name: `${project.title}を開く`, exact: true }).click();
    await expect(page.locator('.toolbar')).toBeVisible();
    const notice = page.getByRole('button', { name: 'お知らせを閉じる', exact: true }); if (await notice.count()) await notice.click();
    const tokenSelector = mode === 'stage' ? '.member-token' : '.parade-member';
    const surface = page.locator(mode === 'stage' ? '.stage-surface' : '.parade-stage');
    await expect(page.locator(tokenSelector)).toHaveCount(8);
    await page.evaluate(() => document.fonts.ready);
    // Wait for resize/fit settling; this also detects accidental coordinate normalization on load.
    await expect.poll(async () => (await page.locator(tokenSelector).first().boundingBox()).width).toBeGreaterThan(25);
    await save(page);
    const loaded = await read(page, project.id);
    assert.deepEqual(loaded.frames[0].positions, project.frames[0].positions, 'load must not snap existing positions');
    const labels = await page.locator(tokenSelector).evaluateAll(tokens => tokens.map(token => {
      const circle = token.getBoundingClientRect(), label = token.querySelector('[class$="__label"]');
      const lines = [...label.children].map(line => {
        const range = document.createRange(); range.selectNodeContents(line); const rect = range.getBoundingClientRect();
        return { text: line.textContent, width: rect.width, height: rect.height,
          outside: Math.max(0, circle.left - rect.left, rect.right - circle.right, circle.top - rect.top, rect.bottom - circle.bottom) };
      });
      return { name: token.getAttribute('aria-label'), title: token.title, diameter: circle.width,
        fontSize: parseFloat(getComputedStyle(token).fontSize), lines, outside: Math.max(...lines.map(line => line.outside)) };
    }));
    const grid = await page.locator(mode === 'stage' ? '.stage-grid-line--horizontal' : '.parade-grid-line--horizontal')
      .evaluateAll(lines => lines.map(line => Number(line.dataset.position)));
    if (mode === 'stage') assert.deepEqual(grid, [.4, .9, 1.4, 1.9, 2.4, 2.9, 3.4, 3.9, 4.4, 4.9]);
    else assert.ok(grid.every(y => lattice(y, .5, 10.13)));
    const expectedLines = [['男右1'], ['鈴木', '一郎'], ['たかは', 'しゆ'], ['佐々木', '小次郎'], ['Takah', 'ashi'], ['あいう', 'えお…'], ['AB', '12'], ['男右', '10']];
    labels.forEach((label, i) => {
      assert.equal(label.name, names[i]); assert.equal(label.title, names[i]);
      assert.deepEqual(label.lines.map(line => line.text), expectedLines[i]);
      assert.ok(label.outside < .2, `${mode} ${width} ${JSON.stringify(label)}`);
      assert.ok(label.fontSize >= 8);
    });
    await page.screenshot({ path: path.join(out, `${mode}-${width}x${height}.png`) });
    record(results, { mode, width, height, labels, grid, paradeZoom: mode === 'parade' ? project.frames[0].sceneViewState.zoom : undefined });
    console.log('SCREEN PASS', mode, width, height, JSON.stringify(labels.map(({ name, diameter, fontSize, outside }) => ({ name, diameter, fontSize, outside }))));
    await writeFile(path.join(out, 'browser-results.json'), JSON.stringify({ results, operations, errors, blocked: [...blocked] }, null, 2));

    // Both tabs start expanded and can be closed by the user.
    await page.getByRole('tab', { name: 'ステージ', exact: true }).click();
    await expect(page.locator('.settings-disclosure')).toHaveAttribute('open', '');
    if (mode === 'stage' && width === 1180) {
      await page.getByText('詳しい設定', { exact: true }).scrollIntoViewIfNeeded();
      await page.screenshot({ path: path.join(out, 'stage-settings-open.png') });
    }
    await page.getByText('詳しい設定', { exact: true }).click(); await expect(page.locator('.settings-disclosure')).not.toHaveAttribute('open', '');
    await page.getByRole('tab', { name: 'メンバー', exact: true }).click();

    // Same screen: move a selection to the nearby edge, paste, then Undo each edit.
    const a = page.locator(tokenSelector).filter({ hasText: '男右1' }).first();
    const b = page.locator(tokenSelector).filter({ hasText: 'えお…' });
    await a.click(); await b.click({ modifiers: ['Control'] });
    await expect(a).toHaveClass(/is-selected/); await expect(b).toHaveClass(/is-selected/);
    const box = await a.boundingBox(), area = await surface.boundingBox();
    const x = box.x + box.width / 2, y = box.y + box.height / 2;
    // stage performer reverses y; parade scroll uses unreflected internal coordinates.
    const sign = mode === 'stage' ? -1 : 1;
    const extent = mode === 'stage' ? 5.4 : 12.44;
    const meters = mode === 'stage' ? 2.7 : -1.7;
    await page.mouse.move(x, y); await page.mouse.down();
    await page.mouse.move(x, y + sign * area.height / extent * meters, { steps: 12 }); await page.mouse.up(); await save(page);
    const moved = await read(page, project.id), p0 = moved.frames[0].positions.m0, p5 = moved.frames[0].positions.m5;
    assert.ok(Math.abs((p5.y - p0.y) - (project.frames[0].positions.m5.y - project.frames[0].positions.m0.y)) < 1e-9, 'group y spacing');
    assert.ok(Math.abs((p5.x - p0.x) - (project.frames[0].positions.m5.x - project.frames[0].positions.m0.x)) < 1e-9, 'group x spacing');
    assert.ok(p0.y !== project.frames[0].positions.m0.y, 'drag must move');
    assert.ok(lattice(p0.y, .5, mode === 'stage' ? 5.4 : 10.13));
    await page.keyboard.press('ControlOrMeta+Z'); await save(page);
    assert.deepEqual((await read(page, project.id)).frames[0].positions, project.frames[0].positions, 'drag Undo restores exact positions');
    await page.keyboard.press('Escape'); await a.click();
    await expect(page.locator('.selected-position-card')).toContainText('男右1');
    await page.getByRole('button', { name: 'コピー', exact: true }).first().click();
    const pasteArea = await surface.boundingBox();
    const pointer = { x: pasteArea.x + pasteArea.width * .53, y: pasteArea.y + pasteArea.height * (mode === 'stage' ? .55 : .25) };
    if (mode === 'parade') {
      const view = await page.locator('.parade-viewport').boundingBox();
      const left = Math.max(view.x, pasteArea.x), right = Math.min(view.x + view.width, pasteArea.x + pasteArea.width);
      const top = Math.max(view.y, pasteArea.y), bottom = Math.min(view.y + view.height, pasteArea.y + pasteArea.height);
      pointer.x = left + (right - left) * .53; pointer.y = top + (bottom - top) * .4;
    }
    await page.mouse.move(pointer.x, pointer.y);
    await page.getByRole('button', { name: /^(貼り付け|貼付)$/ }).first().click(); await save(page);
    const pasted = await read(page, project.id), newMember = pasted.members.find(member => !names.includes(member.name));
    assert.ok(newMember, 'member pasted');
    const position = pasted.frames[0].positions[newMember.id];
    assert.ok(lattice(position.x, .5, 5)); assert.ok(lattice(position.y, .5, mode === 'stage' ? 5.4 : 10.13));
    const display = { x: (pointer.x - pasteArea.x) / pasteArea.width * 9, y: (pointer.y - pasteArea.y) / pasteArea.height * extent };
    const raw = mode === 'stage' ? { x: 9 - display.x, y: 5.4 - display.y } : display;
    const expected = await page.evaluate(async ({ raw, stage, parade }) => {
      const { snapPastedMemberPosition } = await import('/src/utils/placementGrid.ts'); return snapPastedMemberPosition(raw, stage, parade);
    }, { raw, stage: { ...project.stage, depthMeters: extent }, parade: mode === 'parade' ? project.paradeSettings : undefined });
    assert.ok(Math.abs(position.x - expected.x) < 1e-6 && Math.abs(position.y - expected.y) < 1e-6, JSON.stringify({ position, expected, raw }));
    await page.keyboard.press('ControlOrMeta+Z'); await save(page);
    assert.deepEqual((await read(page, project.id)).frames[0].positions, project.frames[0].positions, 'paste Undo exact');
    record(operations, { mode, width, moved: { p0, p5 }, requestedPaste: raw, pasted: position, undo: 'exact' });

    if (width === 1180) {
      // Full saved name stays in the selection card and roster. Display shortening is only visual.
      await page.locator(tokenSelector).filter({ hasText: 'えお…' }).click();
      await expect(page.locator('.selected-position-card')).toContainText('あいうえおかき');
      await expect(page.locator('.member-manager')).toContainText('あいうえおかき');
      await page.getByRole('button', { name: '全体名簿を開く', exact: true }).click();
      const roster = page.getByRole('dialog', { name: 'メンバー/道具の管理', exact: true });
      await expect(roster).toBeVisible();
      const rosterNames = await roster.locator('.roster-table__cell-input').evaluateAll(inputs => inputs.map(input => input.value));
      for (const name of names) assert.ok(rosterNames.includes(name), `roster full name: ${name}`);
      await roster.getByRole('button', { name: '隊列表へ戻る', exact: true }).click();
      const exported = await page.evaluate(async project => {
        const { createTairetsuArchive, readTairetsuArchive } = await import('/src/utils/tairetsuFile.ts');
        const archive = await createTairetsuArchive(project); return (await readTairetsuArchive(new File([archive], 'build30.zip'))).project;
      }, project);
      assert.deepEqual(exported.frames[0].positions, project.frames[0].positions, 'ZIP existing coordinates unchanged');
      assert.deepEqual(exported.members.map(member => member.name), names, 'ZIP full names unchanged');
      if (mode === 'stage') {
        const files = await page.evaluate(async project => {
          const { generateA4Document } = await import('/scripts/testing/export-a4.tsx');
          const result = await generateA4Document(project, 'png', { verticalOrigin: 'bottom' });
          return await Promise.all(result.files.map(async file => ({ name: file.name, bytes: file.size,
            data: await new Promise(resolve => { const reader = new FileReader(); reader.onload = () => resolve(reader.result.split(',')[1]); reader.readAsDataURL(file); }) })));
        }, project);
        assert.ok(files.length); for (const [i, file] of files.entries()) {
          assert.ok(file.bytes > 1000); await writeFile(path.join(out, `stage-a4-${i + 1}.png`), Buffer.from(file.data, 'base64'));
        }
      }
    }
    await writeFile(path.join(out, 'browser-results.json'), JSON.stringify({ results, operations, errors, blocked: [...blocked] }, null, 2));
    await context.close();
  }
  assert.deepEqual(errors, []);
  console.log('BUILD30_BROWSER PASS: 4 screens, initially-open settings, group drag/paste/Undo, ZIP, A4 PNG.');
} catch (error) {
  if (lastPage && !lastPage.isClosed()) {
    await lastPage.screenshot({ path: path.join(out, 'browser-failure.png') });
    await writeFile(path.join(out, 'browser-failure.html'), await lastPage.content());
    console.log('BUTTONS AT FAILURE', await lastPage.getByRole('button').evaluateAll(elements => elements.map(element => element.getAttribute('aria-label') || element.textContent)));
  }
  throw error;
} finally { await browser.close(); }
