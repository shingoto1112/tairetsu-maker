import type { CSSProperties } from "react";
import {
  ROSTER_FOOTER_HEIGHT, ROSTER_NUMBER_WIDTH, ROSTER_SHEET_PADDING,
  rosterTitle, type RosterExportSnapshot, type RosterPage,
} from "../utils/rosterExportLayout";

type Props = {
  snapshot: RosterExportSnapshot;
  page: RosterPage;
  width: number;
  height?: number;
};
const cellStyle: CSSProperties = {
  border: "1px solid #dbe7ee", padding: "6px 8px", textAlign: "left",
  verticalAlign: "top", overflowWrap: "anywhere", whiteSpace: "pre-wrap",
  lineHeight: "20px", fontWeight: 400,
};

/** Static output only: no inputs, add rows, controls, or selection state. */
export const RosterExportSheet = ({ snapshot, page, width, height }: Props) => {
  const unit = snapshot.mode === "members" ? "人" : "個";
  return (
    <div data-roster-export-sheet style={{
      boxSizing: "border-box", width, height, padding: ROSTER_SHEET_PADDING,
      display: "flex", flexDirection: "column", background: "#ffffff", color: "#0f172a",
      fontFamily: '"Noto Sans JP", "Hiragino Kaku Gothic ProN", "Yu Gothic", sans-serif',
      fontSize: 44 / 3, lineHeight: "20px",
    }}>
      <div data-roster-export-heading style={{ marginBottom: 12, overflowWrap: "anywhere" }}>
        <div style={{ fontWeight: 700, fontSize: 20, lineHeight: "28px" }}>{snapshot.title}</div>
        <div style={{ color: "#0f766e", fontSize: 18, lineHeight: "26px", fontWeight: 700 }}>{rosterTitle(snapshot.mode)}</div>
        <div>書き出し日: {new Date(snapshot.exportedAt).toLocaleDateString("ja-JP")}　総数: {snapshot.totalCount}{unit}</div>
        <div style={{ marginTop: 4 }}>
          {page.columns.map((column) => `${column.label}: ${column.items.length}${unit}`).join(" ／ ")}
        </div>
      </div>
      <table style={{ borderCollapse: "collapse", tableLayout: "fixed", width: "100%", fontSize: "inherit", flexShrink: 0 }}>
        <colgroup>
          <col style={{ width: ROSTER_NUMBER_WIDTH }} />
          {page.columns.map((column) => <col key={column.id} />)}
        </colgroup>
        <thead data-roster-export-columns>
          <tr>
            <th style={{ ...cellStyle, fontWeight: 700, background: "#f8fafc", padding: "10px 2px" }}>No.</th>
            {page.columns.map((column) => (
              <th key={column.id} style={{ ...cellStyle, fontWeight: 700, background: "#f8fafc", borderTop: `6px solid ${column.color ?? "#94a3b8"}` }}>
                {column.label}（{column.items.length}{unit}）
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {Array.from({ length: page.rowEnd - page.rowStart }, (_, offset) => {
            const rowIndex = page.rowStart + offset;
            return <tr key={rowIndex} data-roster-export-row>
              <th style={{ ...cellStyle, color: "#64748b", textAlign: "center", padding: "6px 2px" }}>{rowIndex + 1}</th>
              {page.columns.map((column) => <td key={column.id} style={cellStyle}>{column.items[rowIndex]?.name ?? ""}</td>)}
            </tr>;
          })}
        </tbody>
      </table>
      {snapshot.totalCount === 0 && <div style={{ paddingTop: 12 }}>名簿は空です。</div>}
      <div data-roster-export-footer style={{
        marginTop: height ? "auto" : 12, height: ROSTER_FOOTER_HEIGHT,
        flexShrink: 0, textAlign: "right", color: "#64748b", lineHeight: `${ROSTER_FOOTER_HEIGHT}px`,
      }}>{page.pageNumber} / {page.totalPages}</div>
    </div>
  );
};
