import { checkAbort } from "./fonts";
import { DEVICE_FONT_RESOURCE } from "./deviceFont";

/** Font name hint for viewers. Android's PDFium-based viewers pick a gothic only for this name (others
 * fall back to Mincho); iOS and desktop viewers use their default Japanese gothic for any name. */
export const DEVICE_FONT_BASE_NAME = "NotoSansCJKjp-Regular";

/** ToUnicode for the written codes. The content strings ARE UTF-16BE code units of BMP characters, so the
 * map is the identity; it is still written explicitly because UniJIS-UTF16-H maps several Unicode
 * characters to one CID (e.g. 〜 and ～), and copy/search must return the original character. */
export function deviceToUnicodeCMap(codes: Iterable<number>) {
  const sorted = [...new Set(codes)].sort((a, b) => a - b);
  if (sorted.some(c => !Number.isInteger(c) || c < 0x20 || c > 0xffff || (c >= 0xd800 && c <= 0xdfff)))
    throw new Error("端末字体の文字コードが不正です。");
  const ranges: [number, number][] = [];
  for (const c of sorted) {
    const last = ranges[ranges.length - 1];
    // A bfrange may only vary in its last byte.
    if (last && last[1] === c - 1 && last[1] >> 8 === c >> 8) last[1] = c; else ranges.push([c, c]);
  }
  const hex = (n: number) => `<${n.toString(16).toUpperCase().padStart(4, "0")}>`;
  const blocks: string[] = [];
  for (let i = 0; i < ranges.length; i += 100) {
    const chunk = ranges.slice(i, i + 100);
    blocks.push(`${chunk.length} beginbfrange\n${chunk.map(([a, b]) => `${hex(a)} ${hex(b)} ${hex(a)}`).join("\n")}\nendbfrange`);
  }
  return ["/CIDInit /ProcSet findresource begin", "12 dict begin", "begincmap",
    "/CIDSystemInfo << /Registry (Adobe) /Ordering (UCS) /Supplement 0 >> def", "/CMapName /Adobe-Identity-UCS def", "/CMapType 2 def",
    "1 begincodespacerange", "<0000> <FFFF>", "endcodespacerange", ...blocks,
    "endcmap", "CMapName currentdict /CMap defineresource pop", "end", "end"].join("\n");
}

/** Adds the non-embedded viewer font to the jsPDF output (whose page content already uses /DJ0) and
 * saves it, optionally with object streams. MANDATORY step: any failure throws — the caller rebuilds the
 * document with embedded fonts. It never returns the input bytes (they reference an undefined font). */
export async function attachDeviceFont(bytes: ArrayBuffer, options: { codes: Iterable<number>; pageCount: number;
  objectStreams: boolean; signal?: AbortSignal }): Promise<Uint8Array> {
  checkAbort(options.signal);
  const { PDFArray, PDFDocument, PDFDict, PDFName, PDFString } = await import("pdf-lib");
  checkAbort(options.signal);
  const doc = await PDFDocument.load(bytes, { updateMetadata: false });
  if (doc.getPageCount() !== options.pageCount) throw new Error("端末字体の追加前にページ数が一致しません。");
  const context = doc.context;
  const toUnicode = context.register(context.flateStream(deviceToUnicodeCMap(options.codes)));
  const descriptor = context.register(context.obj({ Type: "FontDescriptor", FontName: DEVICE_FONT_BASE_NAME, Flags: 4,
    FontBBox: [-1000, -1050, 2930, 1810], ItalicAngle: 0, Ascent: 880, Descent: -120, CapHeight: 733, StemV: 80 }));
  const cidFont = context.register(context.obj({ Type: "Font", Subtype: "CIDFontType0", BaseFont: DEVICE_FONT_BASE_NAME,
    CIDSystemInfo: { Registry: PDFString.of("Adobe"), Ordering: PDFString.of("Japan1"), Supplement: 6 },
    // Full-width CIDs use DW; the half-width class (231–632) is one half em.
    FontDescriptor: descriptor, DW: 1000, W: [231, 632, 500] }));
  const font = context.register(context.obj({ Type: "Font", Subtype: "Type0", BaseFont: DEVICE_FONT_BASE_NAME,
    Encoding: "UniJIS-UTF16-H", DescendantFonts: [cidFont], ToUnicode: toUnicode }));
  const name = PDFName.of(DEVICE_FONT_RESOURCE), done = new Set<unknown>();
  for (const page of doc.getPages()) {
    const resources = page.node.Resources();
    if (!resources) throw new Error("ページの資源辞書がありません。");
    let fonts = resources.lookupMaybe(PDFName.of("Font"), PDFDict);
    if (!fonts) { fonts = context.obj({}); resources.set(PDFName.of("Font"), fonts); }
    if (done.has(fonts)) continue; // jsPDF shares one resource dictionary between pages
    if (fonts.get(name)) throw new Error("端末字体の資源名が既存のフォントと重なります。");
    fonts.set(name, font); done.add(fonts);
  }
  checkAbort(options.signal);
  const saved = await doc.save({ useObjectStreams: options.objectStreams, addDefaultPage: false, updateFieldAppearances: false });
  checkAbort(options.signal);
  // Re-read what will be delivered: every page must resolve the viewer font to a non-embedded Adobe-Japan1 CID font.
  const again = await PDFDocument.load(saved, { updateMetadata: false });
  if (again.getPageCount() !== options.pageCount) throw new Error("端末字体の追加後にページ数が一致しません。");
  for (const page of again.getPages()) {
    const type0 = page.node.Resources()?.lookupMaybe(PDFName.of("Font"), PDFDict)?.lookupMaybe(name, PDFDict);
    const descendant = type0?.lookupMaybe(PDFName.of("DescendantFonts"), PDFArray)?.lookupMaybe(0, PDFDict);
    const fontDescriptor = descendant?.lookupMaybe(PDFName.of("FontDescriptor"), PDFDict);
    if (type0?.get(PDFName.of("Encoding"))?.toString() !== "/UniJIS-UTF16-H" || !type0.get(PDFName.of("ToUnicode")) ||
      descendant?.get(PDFName.of("Subtype"))?.toString() !== "/CIDFontType0" || !fontDescriptor ||
      ["FontFile", "FontFile2", "FontFile3"].some(key => fontDescriptor.get(PDFName.of(key))))
      throw new Error("端末字体の辞書を検証できませんでした。");
  }
  return saved;
}
