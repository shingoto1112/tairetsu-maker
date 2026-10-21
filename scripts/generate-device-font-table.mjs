// Generates src/utils/vectorPdf/deviceGlyphs.generated.ts: which BMP characters a PDF may leave to the
// viewer's own Japanese font (non-embedded Adobe-Japan1 CID font, /Encoding /UniJIS-UTF16-H).
//   node scripts/generate-device-font-table.mjs          (writes the file)
//   node scripts/generate-device-font-table.mjs --check  (fails if the committed file is stale)
// Source: pdfjs-dist/cmaps/UniJIS-UTF16-H.bcmap (Adobe cmap-resources, BSD-3-Clause; notice in
// public/licenses/adobe-cmap-resources.txt). The bcmap reader below is a port of pdf.js
// src/core/binary_cmap.js (Apache-2.0); it runs only at development time.
//
// Classes (conservative; anything else stays embedded or image-drawn as before):
//   W  East Asian wide blocks mapped to full-width CIDs (ideographs: any CID; others: CID 633–8717).
//      Substitute fonts draw these one em wide; the renderer places each glyph inside the BIZ advance.
//   S  Symbol blocks (①, Ⅱ, →, ★, ♪, ℃, ○ …) mapped to CIDs 633–8717. East Asian "ambiguous" width:
//      used only when the BIZ advance is a full em, so no placement correction is needed.
//   H  Half-width katakana U+FF61–FF9F mapped to half-width CIDs 231–632 (one half em).
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const source = resolve(root, "node_modules/pdfjs-dist/cmaps/UniJIS-UTF16-H.bcmap");
const target = resolve(root, "src/utils/vectorPdf/deviceGlyphs.generated.ts");
const pdfjsVersion = JSON.parse(readFileSync(resolve(root, "node_modules/pdfjs-dist/package.json"), "utf8")).version;

function decodeBcmap(data) {
  let pos = 0;
  const byte = () => { if (pos >= data.length) throw new Error("bcmap: unexpected end"); return data[pos++]; };
  const num = () => { let n = 0, b; do { b = byte(); n = n * 128 + (b & 0x7f); } while (b & 0x80); return n; };
  const signed = () => { const n = num(); return n % 2 ? -(n - 1) / 2 - 1 : n / 2; };
  const hex = size => Array.from({ length: size + 1 }, byte);
  const hexNum = size => {
    const stack = []; let b; do { b = byte(); stack.push(b & 0x7f); } while (b & 0x80);
    const out = new Array(size + 1).fill(0); let buffer = 0, bits = 0;
    for (let i = size; i >= 0; i--) { while (bits < 8 && stack.length) { buffer |= stack.pop() << bits; bits += 7; } out[i] = buffer & 255; buffer >>= 8; bits -= 8; }
    return out;
  };
  const toInt = a => a.reduce((n, b) => n * 256 + b, 0);
  const add = (a, b) => { let c = 0; for (let i = a.length - 1; i >= 0; i--) { c += a[i] + b[i]; a[i] = c & 255; c >>= 8; } };
  const inc = a => { let c = 1; for (let i = a.length - 1; i >= 0 && c; i--) { c += a[i]; a[i] = c & 255; c >>= 8; } };
  const map = new Map();
  const set = (code, cid) => { if (map.has(code) && map.get(code) !== cid) throw new Error(`bcmap: conflicting mapping for ${code}`); map.set(code, cid); };
  byte(); // header (vertical flag)
  while (pos < data.length) {
    const b = byte(), type = b >> 5;
    if (type === 7) { // comment / usecmap
      const len = num(); for (let i = 0; i < len; i++) num();
      if ((b & 0x1f) === 1) throw new Error("bcmap: usecmap is not supported here");
      continue;
    }
    const sequence = !!(b & 0x10), size = b & 15, count = num();
    if (type === 0 || type === 1) { // codespace / notdef ranges
      let start = hex(size), end = hexNum(size); add(end, start); if (type === 1) num();
      for (let i = 1; i < count; i++) { inc(end); start = hexNum(size); add(start, end); const e = hexNum(size); add(e, start); end = e; if (type === 1) num(); }
    } else if (type === 2) { // single characters
      const ch = hex(size); let cid = num(); set(toInt(ch), cid);
      for (let i = 1; i < count; i++) { inc(ch); if (!sequence) add(ch, hexNum(size)); cid = signed() + cid + 1; set(toInt(ch), cid); }
    } else if (type === 3) { // ranges
      let start = hex(size), end = hexNum(size); add(end, start); let cid = num();
      const range = () => { for (let c = toInt(start), e = toInt(end); c <= e; c++) set(c, cid + c - toInt(start)); };
      range();
      for (let i = 1; i < count; i++) {
        inc(end); if (!sequence) { start = hexNum(size); add(start, end); } else start = end.slice();
        const e = hexNum(size); add(e, start); end = e; cid = num(); range();
      }
    } else throw new Error(`bcmap: unsupported entry type ${type}`);
  }
  return map;
}

const bytes = readFileSync(source), cmap = decodeBcmap(bytes);
const within = (c, ranges) => ranges.some(([a, b]) => c >= a && c <= b);
const WIDE = [[0x2e80, 0x2fdf], [0x3000, 0x303e], [0x3041, 0x33ff], [0x3400, 0x4dbf], [0x4e00, 0x9fff], [0xf900, 0xfaff],
  [0xfe30, 0xfe4f], [0xff01, 0xff60], [0xffe0, 0xffe6]];
const IDEOGRAPHS = [[0x3400, 0x4dbf], [0x4e00, 0x9fff], [0xf900, 0xfaff]];
const SYMBOLS = [[0x2100, 0x218f], [0x2190, 0x21ff], [0x2460, 0x24ff], [0x2500, 0x257f], [0x25a0, 0x25ff], [0x2600, 0x26ff]];
const classes = { W: [], S: [], H: [] };
for (let code = 0x20; code < 0xfffe; code++) {
  if (code >= 0xd800 && code <= 0xdfff) continue;
  const cid = cmap.get(code), ch = String.fromCharCode(code);
  if (!cid || /[\p{Mark}\p{Cc}\p{Cf}\p{Cs}\p{Co}\p{Cn}\p{Zl}\p{Zp}]/u.test(ch)) continue;
  const fullWidthCid = cid >= 633 && cid <= 8717;
  if (within(code, WIDE) && (within(code, IDEOGRAPHS) || fullWidthCid)) classes.W.push(code);
  else if (within(code, SYMBOLS) && fullWidthCid) classes.S.push(code);
  else if (code >= 0xff61 && code <= 0xff9f && cid >= 231 && cid <= 632) classes.H.push(code);
}
// Sanity: the characters this app's users need most must be present (fails loudly on a changed source).
for (const [cls, sample] of [["W", "あアー・「」、。々〆ヶ髙﨑漢字０ＡＢ㈱"], ["S", "①⑳Ⅱ→★♪♡℃№○●◎□■△▲"], ["H", "ｱｶﾞﾟｯｰ"]])
  for (const ch of sample) if (!classes[cls].includes(ch.charCodeAt(0))) throw new Error(`expected ${ch} in class ${cls}`);
// Compact form: comma-separated "gap.length" pairs in base 36 (gap from the previous range's end).
const encode = codes => {
  const ranges = [];
  for (const c of codes) { const last = ranges[ranges.length - 1]; if (last && last[1] === c - 1) last[1] = c; else ranges.push([c, c]); }
  let previous = 0;
  return ranges.map(([a, b]) => { const pair = `${(a - previous).toString(36)}.${(b - a).toString(36)}`; previous = b; return pair; }).join(",");
};
const sha256 = createHash("sha256").update(bytes).digest("hex");
const text = `// Generated by scripts/generate-device-font-table.mjs — do not edit by hand.
// Source: pdfjs-dist ${pdfjsVersion} cmaps/UniJIS-UTF16-H.bcmap (sha256 ${sha256}).
// Adobe cmap-resources, BSD-3-Clause: public/licenses/adobe-cmap-resources.txt
// Each string lists BMP code point ranges as base-36 "gap.length" pairs (gap from the previous range's end).
export const DEVICE_GLYPH_SOURCE = { pdfjsDist: "${pdfjsVersion}", sha256: "${sha256}" } as const;
export const DEVICE_GLYPH_COUNTS = { wide: ${classes.W.length}, symbol: ${classes.S.length}, half: ${classes.H.length} } as const;
export const DEVICE_WIDE = "${encode(classes.W)}";
export const DEVICE_SYMBOL = "${encode(classes.S)}";
export const DEVICE_HALF = "${encode(classes.H)}";
`;
if (process.argv.includes("--check")) {
  if (readFileSync(target, "utf8").replace(/\r\n/g, "\n") !== text) { console.error(`${target} is stale; rerun without --check`); process.exit(1); }
  console.log("device glyph table is up to date");
} else {
  writeFileSync(target, text);
  console.log(`wrote ${target}: wide ${classes.W.length}, symbol ${classes.S.length}, half ${classes.H.length}, ${text.length} bytes`);
}
