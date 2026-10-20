import { expect, it } from 'vitest';
import { PNG } from 'pngjs';
import { compare } from './vector-pdf-visual-diff.mjs';

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
