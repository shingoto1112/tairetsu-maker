/** Small, read-only TrueType inspector. Coverage always comes from the SOURCE
 * format-4 cmap, without parsing a second full font through jsPDF. */
export function inspectTrueType(bytes: Uint8Array) {
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const range = (offset: number, length: number) => {
    if (!Number.isInteger(offset) || offset < 0 || length < 0 || offset + length > v.byteLength)
      throw new Error("TrueTypeテーブルの範囲が不正です。");
  };
  range(0, 12);
  if (v.getUint32(0) !== 0x00010000) throw new Error("TrueType入力だけに対応しています。");
  const tables = new Map<string, { offset: number; length: number }>();
  const count = v.getUint16(4); range(12, count * 16);
  for (let i = 0; i < count; i++) {
    const p = 12 + i * 16, tag = String.fromCharCode(...bytes.subarray(p, p + 4));
    const offset = v.getUint32(p + 8), length = v.getUint32(p + 12); range(offset, length);
    tables.set(tag, { offset, length });
  }
  const table = (tag: string, min: number) => {
    const t = tables.get(tag);
    if (!t || t.length < min) throw new Error(`TrueType ${tag}が不正です。`);
    return t.offset;
  };
  const head = table("head", 54), hhea = table("hhea", 36), maxp = table("maxp", 6);
  const unitsPerEm = v.getUint16(head + 18), glyphCount = v.getUint16(maxp + 4), metricCount = v.getUint16(hhea + 34);
  if (!unitsPerEm || !glyphCount || !metricCount || metricCount > glyphCount) throw new Error("TrueTypeメトリクスが不正です。");
  const hmtx = table("hmtx", metricCount * 4 + (glyphCount - metricCount) * 2);
  const cmap = table("cmap", 4), cmapEnd = cmap + tables.get("cmap")!.length;
  const cmapCount = v.getUint16(cmap + 2); range(cmap + 4, cmapCount * 8);
  let format4 = 0;
  // Same Unicode BMP selection as jsPDF: Windows platform 3, encoding 1, format 4.
  for (let i = 0; i < cmapCount; i++) {
    const p = cmap + 4 + i * 8, sub = cmap + v.getUint32(p + 4); range(sub, 2);
    if (v.getUint16(p) === 3 && v.getUint16(p + 2) === 1 && v.getUint16(sub) === 4) { format4 = sub; break; }
  }
  if (!format4) throw new Error("jsPDF用のUnicode cmap format 4がありません。");
  range(format4, 14);
  const length = v.getUint16(format4 + 2), segments = v.getUint16(format4 + 6) / 2;
  if (!Number.isInteger(segments) || !segments || length < 16 + segments * 8 || format4 + length > cmapEnd)
    throw new Error("cmap format 4が不正です。");
  range(format4, length);
  const ends = format4 + 14, starts = ends + segments * 2 + 2, deltas = starts + segments * 2, offsets = deltas + segments * 2;
  const glyph = (code: number): number => {
    if (code < 0 || code >= 0xffff) return 0;
    let lo = 0, hi = segments - 1;
    while (lo < hi) { const mid = (lo + hi) >>> 1; if (v.getUint16(ends + mid * 2) < code) lo = mid + 1; else hi = mid; }
    if (code > v.getUint16(ends + lo * 2) || code < v.getUint16(starts + lo * 2)) return 0;
    const delta = v.getInt16(deltas + lo * 2), relative = v.getUint16(offsets + lo * 2);
    let gid: number;
    if (!relative) gid = (code + delta) & 0xffff;
    else {
      const p = offsets + lo * 2 + relative + (code - v.getUint16(starts + lo * 2)) * 2;
      if (p + 2 > format4 + length) throw new Error("cmapグリフ参照が不正です。");
      gid = v.getUint16(p); if (gid) gid = (gid + delta) & 0xffff;
    }
    if (gid >= glyphCount) throw new Error("cmapグリフ番号が不正です。");
    return gid;
  };
  const longLoca = v.getInt16(head + 50);
  if (longLoca !== 0 && longLoca !== 1) throw new Error("loca形式が不正です。");
  const loca = table("loca", (glyphCount + 1) * (longLoca ? 4 : 2)), glyf = table("glyf", 0);
  const glyphOffset = (gid: number) => longLoca ? v.getUint32(loca + gid * 4) : v.getUint16(loca + gid * 2) * 2;
  // Includes GID 0 (.notdef), all composite dependencies and their loca bounds.
  for (let gid = 0; gid < glyphCount; gid++) {
    const start = glyphOffset(gid), end = glyphOffset(gid + 1);
    if (start > end || end > tables.get("glyf")!.length) throw new Error("loca参照が不正です。");
    if (start === end) continue;
    if (end - start < 10) throw new Error("グリフが壊れています。");
    if (v.getInt16(glyf + start) >= 0) continue;
    let p = glyf + start + 10, flags: number;
    do {
      if (p + 4 > glyf + end) throw new Error("複合グリフが壊れています。");
      flags = v.getUint16(p);
      if (v.getUint16(p + 2) >= glyphCount) throw new Error("複合グリフ参照が不正です。");
      p += 4 + (flags & 1 ? 4 : 2) + (flags & 8 ? 2 : flags & 64 ? 4 : flags & 128 ? 8 : 0);
      if (p > glyf + end) throw new Error("複合グリフの範囲が不正です。");
    } while (flags & 32);
  }
  return { glyph, glyphCount, unitsPerEm, ascender: v.getInt16(hhea + 4), descender: v.getInt16(hhea + 6),
    advance: (code: number) => v.getUint16(hmtx + Math.min(glyph(code), metricCount - 1) * 4),
    tableTags: [...tables.keys()] };
}
export type TrueTypeInfo = ReturnType<typeof inspectTrueType>;
const inspected = new WeakMap<Uint8Array, TrueTypeInfo>();
export function sourceTrueType(bytes: Uint8Array) {
  let info = inspected.get(bytes);
  if (!info) { info = inspectTrueType(bytes); inspected.set(bytes, info); }
  return info;
}
export function validateSubset(source: TrueTypeInfo, bytes: Uint8Array, codes: readonly number[]) {
  const subset = inspectTrueType(bytes);
  if (source.unitsPerEm !== subset.unitsPerEm || source.ascender !== subset.ascender || source.descender !== subset.descender)
    throw new Error("サブセットの基本メトリクスが変わりました。");
  for (const code of codes) if (!subset.glyph(code) || subset.advance(code) !== source.advance(code))
    throw new Error(`サブセットの文字・字幅が一致しません (U+${code.toString(16)})。`);
  return subset;
}
