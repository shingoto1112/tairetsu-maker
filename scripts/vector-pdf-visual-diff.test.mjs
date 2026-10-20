import { expect, it } from 'vitest';
import { PNG } from 'pngjs';
import { compare, compareGraphemes } from './vector-pdf-visual-diff.mjs';

const image = (shift = 0, missing = false, color = [15, 118, 110]) => {
  const p = new PNG({ width: 90, height: 60 }); p.data.fill(255);
  // Simple glyph-like strokes, fine line and colored solid shape.
  for (let y = 10; y < 48; y++) for (let x = 10; x < 72; x++) {
    if ((x < 15 && !missing) || (y < 15 && x < 28) || (x > 36 && x < 40) || (y > 28 && x > 46)) {
      const i = (y * p.width + x + shift) * 4;
      for (let c = 0; c < 3; c++) p.data[i + c] = color[c];
    }
  }
  return PNG.sync.write(p);
};
const region = { text: [{ x: 0, y: 0, width: 90, height: 60 }] };
it('accepts at most 2px sampling variation, rejects 3px/4px movement, missing glyph stroke and wrong color', () => {
  expect(compare(image(), image(2), region).pass).toBe(true);
  expect(compare(image(), image(3), region).pass).toBe(false);
  expect(compare(image(), image(4), region).pass).toBe(false);
  expect(compare(image(), image(0, true), region).pass).toBe(false);
  expect(compare(image(), image(0, false, [200, 20, 20]), region).pass).toBe(false);
});

it('detects a missing local grapheme even when a page-wide region dilutes it', () => {
  const p = new PNG({ width: 800, height: 600 }); p.data.fill(255);
  const blank = PNG.sync.write(p);
  for (let y = 30; y < 46; y++) for (let x = 30; x < 42; x++) {
    const i = (y * p.width + x) * 4; p.data[i] = 230; p.data[i + 1] = 70; p.data[i + 2] = 10;
  }
  const reference = PNG.sync.write(p), boxes = [{ x: 26, y: 26, width: 20, height: 24 }];
  expect(compare(reference, blank, { page: [{ x: 0, y: 0, width: 800, height: 600 }] }).pass).toBe(true);
  expect(compareGraphemes(reference, reference, boxes).pass).toBe(true);
  expect(compareGraphemes(reference, blank, boxes).pass).toBe(false);
});
