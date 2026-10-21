import assert from 'node:assert/strict';
import { PNG } from 'pngjs';

export function compare(referenceData, actualData, regions) {
  const rawA = PNG.sync.read(referenceData), rawB = PNG.sync.read(actualData);
  // One-pixel box filter removes different sampling phases of subpixel-thin
  // strokes. Combined with the one-pixel neighborhood below, support stays 2px.
  function normalize(raw) {
    const p = new PNG({ width: raw.width, height: raw.height });
    for (let y = 0; y < raw.height; y++) for (let x = 0; x < raw.width; x++) {
      let count = 0, sums = [0, 0, 0];
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const xx = x + dx, yy = y + dy; if (xx < 0 || yy < 0 || xx >= raw.width || yy >= raw.height) continue;
        const j = (yy * raw.width + xx) * 4; count++;
        for (let c = 0; c < 3; c++) sums[c] += raw.data[j + c];
      }
      const i = (y * raw.width + x) * 4;
      for (let c = 0; c < 3; c++) p.data[i + c] = Math.round(sums[c] / count);
      p.data[i + 3] = 255;
    }
    return p;
  }
  const a = normalize(rawA), b = normalize(rawB);
  assert.equal(a.width, b.width); assert.equal(a.height, b.height);
  const diff = new PNG({ width: a.width, height: a.height });
  const result = {};
  const unmatched = (p, q, x, y, radius = 1) => {
    const i = (y * p.width + x) * 4;
    // The center pixel is always in the search window. If it already meets the
    // SAME 32-level tolerance, the full min/max envelope cannot reject it. Avoid
    // allocating/searching neighborhoods for matching backgrounds and fills.
    if (Math.abs(p.data[i] - q.data[i]) <= 32 && Math.abs(p.data[i + 1] - q.data[i + 1]) <= 32
      && Math.abs(p.data[i + 2] - q.data[i + 2]) <= 32) return false;
    const min = [255, 255, 255], max = [0, 0, 0];
    for (let dy = -radius; dy <= radius; dy++) for (let dx = -radius; dx <= radius; dx++) {
      const xx = x + dx, yy = y + dy;
      if (xx < 0 || xx >= p.width || yy < 0 || yy >= p.height) continue;
      const j = (yy * q.width + xx) * 4;
      for (let c = 0; c < 3; c++) { min[c] = Math.min(min[c], q.data[j + c]); max[c] = Math.max(max[c], q.data[j + c]); }
    }
    // Different AA kernels need not emit the same intermediate RGB values. Accept
    // colors within the neighboring foreground/background envelope, still confined
    // to 2px including normalization. Missing glyphs also fail exact text checks.
    return [0, 1, 2].some(c => p.data[i + c] < min[c] - 32 || p.data[i + c] > max[c] + 32);
  };
  for (const [name, boxes] of Object.entries(regions)) {
    let pixels = 0, bad = 0;
    const visited = new Set();
    for (const box of boxes) {
      for (let y = Math.max(0, Math.floor(box.y)); y < Math.min(a.height, Math.ceil(box.y + box.height)); y++)
        for (let x = Math.max(0, Math.floor(box.x)); x < Math.min(a.width, Math.ceil(box.x + box.width)); x++) {
          const k = y * a.width + x; if (visited.has(k)) continue; visited.add(k); pixels++;
          const rawMismatch = unmatched(rawA, rawB, x, y, 2) || unmatched(rawB, rawA, x, y, 2);
          const mismatch = rawMismatch && (unmatched(a, b, x, y) || unmatched(b, a, x, y));
          if (mismatch) bad++;
          const i = k * 4;
          if (mismatch) { diff.data[i] = 255; diff.data[i + 1] = 0; diff.data[i + 2] = 80; }
          else { for (let c = 0; c < 3; c++) diff.data[i + c] = Math.round(rawA.data[i + c] * .25 + 190); }
          diff.data[i + 3] = 255;
        }
    }
    result[name] = { pixels, bad, ratio: pixels ? bad / pixels : 0, pass: !pixels || bad / pixels < .003 };
  }
  return { result, diff: PNG.sync.write(diff), pass: Object.values(result).every(r => r.pass) };
}

/** A local check is per grapheme, so a missing small emoji cannot be diluted by
 * the rest of a page. Allow up to 5% of its tight box for OS glyph hinting versus
 * high-resolution PNG downsampling; retain the same 2px/32-color AA support.
 * The existing whole-region 0.3% threshold above is deliberately unchanged. */
export function compareGraphemes(referenceData, actualData, boxes) {
  const compared = compare(referenceData, actualData, { graphemes: boxes });
  const diff = PNG.sync.read(compared.diff);
  const glyphs = boxes.map(box => {
    let pixels = 0, bad = 0;
    for (let y = Math.max(0, Math.floor(box.y)); y < Math.min(diff.height, Math.ceil(box.y + box.height)); y++)
      for (let x = Math.max(0, Math.floor(box.x)); x < Math.min(diff.width, Math.ceil(box.x + box.width)); x++) {
        pixels++; const i = (y * diff.width + x) * 4;
        if (diff.data[i] === 255 && diff.data[i + 1] === 0 && diff.data[i + 2] === 80) bad++;
      }
    return { pixels, bad, ratio: pixels ? bad / pixels : 0, pass: pixels > 0 && bad / pixels < .05 };
  });
  return { ...compared, glyphs, pass: glyphs.length > 0 && glyphs.every(g => g.pass) };
}
