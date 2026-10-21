/** TrueType-only browser adaptation of subset-font 2.9.0's HarfBuzz call sequence.
 * https://github.com/papandreou/subset-font (index.js)
 * Copyright (c) 2012, Andreas Lind Petersen. All rights reserved. BSD-3-Clause.
 * Full notice: public/licenses/subset-font.txt. harfbuzzjs 1.6.3: MIT.
 * No fontverter/WOFF/variation/shaping support. All raw ABI ownership lives here. */
const FUNCTIONS = ["_initialize", "malloc", "free", "hb_blob_create", "hb_blob_destroy", "hb_blob_get_data", "hb_blob_get_length",
  "hb_face_create", "hb_face_destroy", "hb_face_reference_blob", "hb_subset_input_create_or_fail", "hb_subset_input_destroy",
  "hb_subset_input_unicode_set", "hb_subset_input_set", "hb_subset_input_set_flags", "hb_set_clear", "hb_set_add", "hb_subset_or_fail"] as const;
type FunctionName = typeof FUNCTIONS[number];
type HbExports = Record<FunctionName, (...args: number[]) => number> & { memory: WebAssembly.Memory };
export const REQUIRED_HB_EXPORTS = ["memory", ...FUNCTIONS];
export function createHbSubsetter(exports: WebAssembly.Exports) {
  if (!(exports.memory instanceof WebAssembly.Memory) || FUNCTIONS.some(name => typeof exports[name] !== "function"))
    throw new Error("harfbuzzjs 1.6.3のサブセットABIが一致しません。");
  const hb = exports as HbExports;
  hb._initialize(); // once per instance, not per document
  const nonzero = (value: number, operation: string) => {
    if (!value) throw new Error(`HarfBuzz ${operation}に失敗しました。`);
    return value;
  };
  const tag = (s: string) => [...s].reduce((n, c) => (n << 8) + c.charCodeAt(0), 0);
  return (source: Uint8Array, codes: readonly number[]): Uint8Array => {
    if (source.length < 12 || new DataView(source.buffer, source.byteOffset, source.byteLength).getUint32(0) !== 0x00010000)
      throw new Error("TrueType入力だけに対応しています。");
    if (codes.some(c => !Number.isInteger(c) || c < 0 || c >= 0xffff || c >= 0xd800 && c <= 0xdfff))
      throw new Error("サブセット対象は独立したBMP文字だけです。");
    let input = 0, buffer = 0, blob = 0, face = 0, subset = 0, result = 0;
    try {
      input = nonzero(hb.hb_subset_input_create_or_fail(), "input");
      buffer = nonzero(hb.malloc(source.byteLength), "malloc");
      // Never retain a view across ANY allocating WASM call (memory.grow detaches it).
      new Uint8Array(hb.memory.buffer).set(source, buffer);
      blob = nonzero(hb.hb_blob_create(buffer, source.byteLength, 2 /* WRITABLE, borrowed buffer */, 0, 0), "blob");
      face = nonzero(hb.hb_face_create(blob, 0), "face");
      const features = nonzero(hb.hb_subset_input_set(input, 6 /* LAYOUT_FEATURE_TAG */), "features");
      hb.hb_set_clear(features);
      // NO_HINTING | NO_LAYOUT_CLOSURE. Do not retain GIDs or glyph names.
      hb.hb_subset_input_set_flags(input, 0x00000001 | 0x00000200);
      const drop = nonzero(hb.hb_subset_input_set(input, 3 /* DROP_TABLE_TAG */), "drop tables");
      for (const name of ["GSUB", "GPOS", "vhea", "vmtx", "gasp", "DSIG"]) hb.hb_set_add(drop, tag(name));
      // Preserve font copyright/license records, including OFL's URL (name IDs 13/14).
      const names = nonzero(hb.hb_subset_input_set(input, 4 /* NAME_ID */), "name IDs");
      for (const id of [0, 13, 14]) hb.hb_set_add(names, id);
      const unicodes = nonzero(hb.hb_subset_input_unicode_set(input), "unicodes");
      hb.hb_set_clear(unicodes);
      for (const code of codes) hb.hb_set_add(unicodes, code);
      subset = nonzero(hb.hb_subset_or_fail(face, input), "subset");
      result = nonzero(hb.hb_face_reference_blob(subset), "result blob");
      const offset = nonzero(hb.hb_blob_get_data(result, 0), "result data");
      const length = nonzero(hb.hb_blob_get_length(result), "result length");
      if (offset + length > hb.memory.buffer.byteLength) throw new Error("HarfBuzz出力範囲が不正です。");
      return new Uint8Array(hb.memory.buffer, offset, length).slice(); // own copy BEFORE destroy/free
    } finally {
      if (result) hb.hb_blob_destroy(result);
      if (subset) hb.hb_face_destroy(subset);
      if (input) hb.hb_subset_input_destroy(input);
      if (face) hb.hb_face_destroy(face);
      if (blob) hb.hb_blob_destroy(blob);
      if (buffer) hb.free(buffer);
    }
  };
}

/** MIME-restricted servers (including bundled app origins) can use ArrayBuffer. */
export async function instantiateHbResponse(response: Response) {
  if (!response.ok) throw new Error(`サブセットWASMを読み込めませんでした (${response.status})。`);
  try { return (await WebAssembly.instantiateStreaming(response.clone(), {})).instance.exports; }
  catch { return (await WebAssembly.instantiate(await response.arrayBuffer(), {})).instance.exports; }
}
