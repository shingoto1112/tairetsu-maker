import type { VerticalOrigin } from "../utils/gridEmphasis";
import type { CSSProperties } from "react";
import { StaticStagePreview } from "./StaticStagePreview";
import type { FormationSnapshot } from "../utils/mobileExportTypes";
import { FORMATION_TOP, sceneTimeLabel, type FormationBlock, type FormationPage } from "../utils/formationExportLayout";
import { MOBILE_PADDING, MOBILE_WIDTH, MOBILE_INNER_WIDTH } from "../utils/mobileExportLayout";
import { createDefaultObjectState } from "../utils/interpolation";
import type { Project } from "../types";

/** A vector locator avoids rasterizing a second, potentially enormous parade diagram. */
export const FormationLocator = ({ block, project }: { block: FormationBlock; project: Project }) => {
  const { fullRange: full, range } = block;
  const width = full.right - full.left, height = full.bottom - full.top;
  return <div className="formation-locator" style={{ height: 72 }}>
    <svg width="112" height="60" viewBox={`${full.left} ${full.top} ${width} ${height}`} aria-label="全体図の切り出し範囲">
      <rect x={full.left} y={full.top} width={width} height={height} fill="#f1f5f9" stroke="#94a3b8" vectorEffect="non-scaling-stroke" />
      <line x1={block.stageWidth / 2} x2={block.stageWidth / 2} y1={full.top} y2={full.bottom} stroke="#94a3b8" strokeDasharray="2 2" vectorEffect="non-scaling-stroke" />
      {project.stageObjects.map((object) => {
        const state = block.frame.objectStates?.[object.id] ?? createDefaultObjectState(object);
        if ((state.visible ?? object.visible) === false) return null;
        return <rect key={object.id} x={state.x} y={state.y} width={state.widthMeters} height={state.heightMeters}
          transform={`rotate(${state.rotation} ${state.x + state.widthMeters / 2} ${state.y + state.heightMeters / 2})`} fill="#94a3b8" />;
      })}
      {project.members.map((member) => {
        const position = block.frame.positions[member.id];
        if (!position || member.visible === false || block.frame.memberVisibility?.[member.id] === false
          || Object.values(block.frame.objectAssignments ?? {}).some((ids) => ids.includes(member.id))) return null;
        return <circle key={member.id} cx={position.x} cy={position.y} r={(project.stage.memberDiameterMeters ?? 0.5) / 2} fill="#64748b" />;
      })}
      <rect data-formation-locator-range x={range.left} y={range.top}
        width={range.right - range.left} height={range.bottom - range.top} fill="#0d8b7833" stroke="#0f766e" strokeWidth="2" vectorEffect="non-scaling-stroke" />
    </svg>
    <span>緑の範囲を拡大<br />グレーの帯は前後の図と共通</span>
  </div>;
};

export const FormationMobilePage = ({ snapshot, page, verticalOrigin = "top" }: { snapshot: FormationSnapshot; page: FormationPage; verticalOrigin?: VerticalOrigin }) =>
  <div data-mobile-export-page={page.pageNumber} className="formation-mobile-page"
    style={{ width: MOBILE_WIDTH, height: page.height, padding: MOBILE_PADDING }}>
    <header style={{ height: 30, display: "flex", fontSize: 16, lineHeight: "22px", color: "#64748b", gap: 12 }}>
      <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{snapshot.title}・隊列表</span>
      <span>{page.pageNumber}/{page.totalPages}</span>
    </header>
    {page.blocks.map((block, index) => {
      const { range, scale, tile, side } = block;
      const drawingWidth = (range.right - range.left) * scale + side * 2;
      const drawingHeight = (range.bottom - range.top) * scale;
      const offset = (MOBILE_INNER_WIDTH - drawingWidth) / 2;
      const bands: CSSProperties[] = [];
      if (tile && tile.index > 0) bands.push({ left: 0, top: 0, width: (tile.coreLeft + (tile.coreLeft - tile.left) - range.left) * scale, height: drawingHeight });
      if (tile && tile.index < tile.count - 1) bands.push({ right: 0, top: 0, width: (range.right - tile.coreRight) * 2 * scale, height: drawingHeight });
      if (block.overlapTop) bands.push({ left: 0, right: 0, top: 0, height: block.overlapTop * scale });
      if (block.overlapBottom) bands.push({ left: 0, right: 0, bottom: 0, height: block.overlapBottom * scale });
      return <section key={`${block.frame.id}:${index}`} data-formation-block={block.detail ? "detail" : "overview"} style={{ height: block.height, overflow: "hidden" }}>
        <div style={{ height: block.headingHeight }}>
          <h2 style={{ margin: 0, fontSize: 30, lineHeight: "38px", fontWeight: 700, overflowWrap: "anywhere", whiteSpace: "pre-wrap", color: "#0f766e" }}>{block.frame.label}</h2>
          <div style={{ fontSize: 16, lineHeight: "26px", color: "#64748b" }}>{sceneTimeLabel(block.frame.timeSec)}</div>
          {block.caption && <div style={{ fontSize: 18, lineHeight: "26px", overflowWrap: "anywhere", color: "#475569" }}>{block.caption}</div>}
        </div>
        {block.detail && <FormationLocator block={block} project={snapshot.project} />}
        <div style={{ position: "relative", width: drawingWidth, marginLeft: Math.max(0, offset) }}>
          <StaticStagePreview verticalOrigin={verticalOrigin} project={snapshot.project} frame={block.frame} stageWidth={block.stageWidth} range={range} outputWidth={drawingWidth} side={side}
            wholeMembersWithinRange={block.detail && snapshot.project.mode !== "parade"} />
          <div style={{ position: "absolute", left: side, top: FORMATION_TOP, width: drawingWidth - side * 2, height: drawingHeight, pointerEvents: "none", overflow: "hidden", zIndex: 10000 }}>
            {bands.map((style, band) => <div key={band} data-formation-overlap style={{ position: "absolute", background: "rgba(100,116,139,.12)", border: "1px dashed rgba(100,116,139,.32)", boxSizing: "border-box", ...style }} />)}
          </div>
        </div>
      </section>;
    })}
  </div>;
