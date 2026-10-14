import { collectGroupedItems, type RosterColumn, type RosterGroup } from "./rosterColumns";
import { formatExportTimestamp, sanitizeExportFileName, withFileExtension } from "./exportFileName";
import type { CompletedExport, ExportSource } from "./mobileExportTypes";

export const XLSX_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
type Sheet = { name: string; columns: RosterColumn<{ id: string; name: string }>[]; rowCount: number };
const ns = "http://schemas.openxmlformats.org/spreadsheetml/2006/main";
const relNs = "http://schemas.openxmlformats.org/package/2006/relationships";
const officeRel = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
const xml = (body: string) => `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>${body}`;

const fallbackColor = "FF94A3B8";
const clamp = (value: number, max: number) => Math.min(max, Math.max(0, value));

/** DOM-independent CSS numeric colors, composited over the workbook's white background. */
export const normalizeRosterColor = (input?: string): string => {
  const value = input?.trim() ?? "";
  let channels: number[];
  let alpha = 1;
  const hex = /^#([\da-f]{3}|[\da-f]{4}|[\da-f]{6}|[\da-f]{8})$/i.exec(value)?.[1];
  if (hex) {
    const full = hex.length <= 4 ? Array.from(hex, char => char + char).join("") : hex;
    channels = [0, 2, 4].map(index => parseInt(full.slice(index, index + 2), 16));
    if (full.length === 8) alpha = parseInt(full.slice(6), 16) / 255;
  } else {
    const body = /^rgba?\(([^()]*)\)$/i.exec(value)?.[1].trim();
    if (!body) return fallbackColor;
    let parts: string[];
    if (body.includes(",")) {
      if (body.includes("/")) return fallbackColor;
      parts = body.split(",").map(part => part.trim());
      if (parts.length !== 3 && parts.length !== 4) return fallbackColor;
    } else {
      const [rgb, opacity, extra] = body.split("/");
      if (extra !== undefined) return fallbackColor;
      parts = rgb.trim().split(/\s+/);
      if (parts.length !== 3) return fallbackColor;
      if (opacity !== undefined) parts.push(opacity.trim());
    }
    if (parts.some(part => !/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)%?$/.test(part))) return fallbackColor;
    channels = parts.slice(0, 3).map(part => clamp(parseFloat(part), part.endsWith("%") ? 100 : 255) * (part.endsWith("%") ? 255 / 100 : 1));
    if (parts.length === 4) alpha = clamp(parseFloat(parts[3]), parts[3].endsWith("%") ? 100 : 1) / (parts[3].endsWith("%") ? 100 : 1);
  }
  if (![...channels, alpha].every(Number.isFinite)) return fallbackColor;
  return "FF" + channels.map(channel => Math.round(channel * alpha + 255 * (1 - alpha)).toString(16).padStart(2, "0")).join("").toUpperCase();
};

/** Zero-based column index, including Excel's last column XFD. */
export const xlsxColumnName = (index: number): string => {
  if (!Number.isInteger(index) || index < 0 || index >= 16384) throw new Error("Excelの列数上限（16,384列、No.列を含む）を超えています。グループ数を減らしてから書き出してください。");
  let name = "";
  for (let n = index + 1; n > 0; n = Math.floor((n - 1) / 26)) name = String.fromCharCode(65 + (n - 1) % 26) + name;
  return name;
};

export const validateRosterXlsxSize = (columnCount: number, rowCount: number): void => {
  xlsxColumnName(columnCount - 1);
  if (!Number.isInteger(rowCount) || rowCount < 1 || rowCount > 1048576) throw new Error("Excelの行数上限（1,048,576行、見出しを含む）を超えています。最長のグループの人数を減らしてから書き出してください。");
};

/** Escape literal OOXML escape sequences first, then XML-illegal UTF-16 units.
 * Keep tabs/newlines; encode CR so XML newline normalization cannot change it.
 * Reject overlong cells instead of silently losing roster names. */
const textXml = (value: string): string => {
  if (value.length > 32767) throw new Error("Excelのセル上限（32,767文字）を超える名前またはグループ名があります。短くしてから書き出してください。");
  const escaped = value.replace(/_x[0-9a-f]{4}_/gi, match => `_x005F_${match.slice(1)}`);
  let text = "";
  for (const char of escaped) {
    const code = char.charCodeAt(0);
    text += (code < 32 && code !== 9 && code !== 10) || code === 0xfffe || code === 0xffff || (char.length === 1 && code >= 0xd800 && code <= 0xdfff)
      ? `_x${code.toString(16).toUpperCase().padStart(4, "0")}_` : char;
  }
  return text.replace(/[&<>"']/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" })[char]!);
};

const createSheet = (name: string, items: { id: string; name: string }[], groups: RosterGroup[], key: "memberIds" | "objectIds"): Sheet => {
  const grouped = collectGroupedItems(items, groups, key);
  const columns = grouped.filter(column => column.groupId !== null || column.items.length > 0 || grouped.length === 1);
  const rowCount = columns.reduce((max, column) => Math.max(max, column.items.length + 1), 1);
  validateRosterXlsxSize(columns.length + 1, rowCount);
  return { name, columns, rowCount };
};

type ColumnStyle = { header: number; name: number };
const gridColor = "FFD5DBE3";
// Column separators are near-black on every cell (user decision 2026-10-14): a colored line on only
// one side read as belonging to the neighbouring column. Group color stays on the header ■ and underline.
const columnLineColor = "FF0F172A";
const borderXml = (headerColor?: string) => `<border><left style="thin"><color rgb="${columnLineColor}"/></left><right style="thin"><color rgb="${columnLineColor}"/></right><top style="thin"><color rgb="${gridColor}"/></top>${headerColor ? `<bottom style="thick"><color rgb="${headerColor}"/></bottom>` : `<bottom style="thin"><color rgb="${gridColor}"/></bottom>`}<diagonal/></border>`;
const xfXml = (bold: boolean, fill: boolean, borderId: number) => `<xf numFmtId="0" fontId="${bold ? 1 : 0}" fillId="${fill ? 2 : 0}" borderId="${borderId}" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>`;

/** One header style per normalized color across both sheets, independent of group IDs; name cells share one style. */
const createStyles = (sheets: Sheet[]) => {
  const borders = ['<border><left/><right/><top/><bottom/><diagonal/></border>', borderXml()];
  const xfs = ['<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>', xfXml(true, true, 1), xfXml(false, false, 1)];
  const nameStyle = 2;
  const byColor = new Map<string, ColumnStyle>();
  for (const sheet of sheets) for (const column of sheet.columns) {
    const color = normalizeRosterColor(column.color);
    if (byColor.has(color)) continue;
    borders.push(borderXml(color));
    xfs.push(xfXml(true, true, borders.length - 1));
    byColor.set(color, { header: xfs.length - 1, name: nameStyle });
  }
  return { byColor, xml: xml(`<styleSheet xmlns="${ns}"><fonts count="2"><font><sz val="11"/><color rgb="FF0F172A"/><name val="Yu Gothic"/></font><font><b/><sz val="11"/><color rgb="FF0F172A"/><name val="Yu Gothic"/></font></fonts><fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FFF1F5F9"/><bgColor indexed="64"/></patternFill></fill></fills><borders count="${borders.length}">${borders.join("")}</borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="${xfs.length}">${xfs.join("")}</cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>`) };
};

const stringCell = (ref: string, style: number, value: string) => `<c r="${ref}" s="${style}" t="inlineStr"><is><t xml:space="preserve">${textXml(value)}</t></is></c>`;
// Rows keep a fixed height, so names are not wrapped (a wrapped line would be clipped).
// Widen the column instead; Excel width units are about one "0" of the default font.
const NAME_WIDTH_CAP = 50;
const nameWidth = (text: string) => Math.ceil(Array.from(text).reduce((width, char) => width + (char.codePointAt(0)! > 255 ? 2.2 : 1.2), 0) + 3);
const sheetXml = (sheet: Sheet, styles: Map<string, ColumnStyle>): string => {
  // Build only real cells, rather than a rectangular array with blank placeholders.
  const rows: string[][] = Array.from({ length: sheet.rowCount }, (_, index) => [index === 0 ? stringCell("A1", 1, "No.") : `<c r="A${index + 1}" s="1"><v>${index}</v></c>`]);
  const widths = [7];
  for (const [index, column] of sheet.columns.entries()) {
    const color = normalizeRosterColor(column.color);
    const style = styles.get(color)!;
    const letter = xlsxColumnName(index + 1);
    textXml(`■ ${column.label}`); // The two rich-text runs together must fit in one cell.
    rows[0].push(`<c r="${letter}1" s="${style.header}" t="inlineStr"><is><r><rPr><b/><color rgb="${color}"/></rPr><t xml:space="preserve">■ </t></r><r><rPr><b/><color rgb="FF0F172A"/></rPr><t xml:space="preserve">${textXml(column.label)}</t></r></is></c>`);
    let width = Math.min(NAME_WIDTH_CAP, Math.max(15, nameWidth(`■ ${column.label}`)));
    for (const [row, item] of column.items.entries()) {
      rows[row + 1].push(stringCell(`${letter}${row + 2}`, style.name, item.name));
      width = Math.min(NAME_WIDTH_CAP, Math.max(width, nameWidth(item.name)));
    }
    widths.push(width);
  }
  return xml(`<worksheet xmlns="${ns}"><dimension ref="A1:${xlsxColumnName(sheet.columns.length)}${sheet.rowCount}"/><sheetViews><sheetView workbookViewId="0" showGridLines="0"><pane xSplit="1" ySplit="1" topLeftCell="B2" activePane="bottomRight" state="frozen"/></sheetView></sheetViews><sheetFormatPr defaultRowHeight="22"/><cols>${widths.map((width, index) => `<col min="${index + 1}" max="${index + 1}" width="${width}" customWidth="1"/>`).join("")}</cols><sheetData>${rows.map((cells, index) => `<row r="${index + 1}" ht="${index === 0 ? 26 : 22}" customHeight="1">${cells.join("")}</row>`).join("")}</sheetData><ignoredErrors><ignoredError sqref="A1:${xlsxColumnName(sheet.columns.length)}${sheet.rowCount}" numberStoredAsText="1"/></ignoredErrors></worksheet>`);
};

/** App roster columns; no formulas, shared strings, coordinates or IDs. */
export const generateRosterXlsx = async (source: ExportSource, includeObjects = true, signal?: AbortSignal, date = new Date()): Promise<CompletedExport> => {
  const check = () => { if (signal?.aborted) throw new DOMException("作成を取り消しました。", "AbortError"); };
  check();
  const snapshot = structuredClone(source);
  const sheets = [createSheet("メンバー", snapshot.members, snapshot.memberGroups, "memberIds")];
  if (includeObjects && snapshot.objects.length) {
    sheets.push(createSheet("道具", snapshot.objects, snapshot.objectGroups, "objectIds"));
  }
  // Validate and encode before loading the ZIP library.
  const styles = createStyles(sheets);
  const worksheets = sheets.map(sheet => sheetXml(sheet, styles.byColor));
  const { default: JSZip } = await import("jszip");
  check();
  const zip = new JSZip();
  zip.file("[Content_Types].xml", xml(`<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>${sheets.map((_, index) => `<Override PartName="/xl/worksheets/sheet${index + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join("")}</Types>`));
  zip.file("_rels/.rels", xml(`<Relationships xmlns="${relNs}"><Relationship Id="rId1" Type="${officeRel}/officeDocument" Target="xl/workbook.xml"/></Relationships>`));
  zip.file("xl/workbook.xml", xml(`<workbook xmlns="${ns}" xmlns:r="${officeRel}"><bookViews><workbookView/></bookViews><sheets>${sheets.map((sheet, index) => `<sheet name="${sheet.name}" sheetId="${index + 1}" r:id="rId${index + 1}"/>`).join("")}</sheets></workbook>`));
  zip.file("xl/_rels/workbook.xml.rels", xml(`<Relationships xmlns="${relNs}">${sheets.map((_, index) => `<Relationship Id="rId${index + 1}" Type="${officeRel}/worksheet" Target="worksheets/sheet${index + 1}.xml"/>`).join("")}<Relationship Id="rIdStyles" Type="${officeRel}/styles" Target="styles.xml"/></Relationships>`));
  zip.file("xl/styles.xml", styles.xml);
  worksheets.forEach((sheet, index) => zip.file(`xl/worksheets/sheet${index + 1}.xml`, sheet));
  const bytes = await zip.generateAsync({ type: "uint8array", compression: "DEFLATE" }, check);
  check();
  // Bound the title independently so the roster label and timestamp always survive.
  const title = sanitizeExportFileName(snapshot.projectTitle).replace(/[\u0000-\u001f\u007f]/g, "_");
  const bounded = Array.from(title).slice(0, 60).join("");
  const name = withFileExtension(`${bounded}_名簿_${formatExportTimestamp(date)}`, "xlsx");
  const file = new File([bytes as Uint8Array<ArrayBuffer>], name, { type: XLSX_MIME });
  return { files: [file], preview: null, targetLabel: "名簿（Excel）", scopeLabel: sheets.length === 2 ? "メンバー・道具" : "メンバー", pageCount: sheets.length };
};
