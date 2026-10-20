import { useId } from "react";
import type { StageConfig, ViewerPerspective } from "../types";
import { createStageExportView } from "../utils/stageExportView";

// A small schematic: use the export ruler transform, including legacy front settings.
const diagramSize = { widthMeters: 6, depthMeters: 3 };
const OrientationDiagram = ({ verticalLabels }: { verticalLabels: ReturnType<typeof createStageExportView>["verticalLabels"] }) => {
  return <svg className="counting-diagram" viewBox="0 0 240 98" aria-hidden="true" focusable="false">
    <rect className="counting-diagram__stage" x="44" y="14" width="176" height="72" />
    {[1, 2, 3, 4, 5].map(x => <line key={x} className="counting-diagram__grid" x1={44 + x * 176 / 6} x2={44 + x * 176 / 6} y1="14" y2="86" />)}
    {verticalLabels.map(({ label, positionMeters }) => {
      const y = 14 + positionMeters * 24;
      return <g key={label}>
        {positionMeters > 0 && positionMeters < 3 && <line className="counting-diagram__grid" x1="44" x2="220" y1={y} y2={y} />}
        <line className="counting-diagram__tick" x1="38" x2="44" y1={y} y2={y} />
        <text className={label === "0m" ? "export-orientation__zero" : undefined} x="20" y={y} dy=".35em">{label}</text>
      </g>;
    })}
  </svg>;
};

export const ExportPerspectiveOptions = ({ value, onChange, stage, compact = false }: {
  value: ViewerPerspective; onChange: (value: ViewerPerspective) => void; stage: StageConfig; compact?: boolean;
}) => {
  const name = useId();
  return <fieldset className={"horizontal-counting export-orientation" + (compact ? " horizontal-counting--compact" : "")}><legend>書き出す向き</legend>
    <div className="horizontal-counting__cards">
      {([ ["performer", "踊る人側から見た向き"], ["audience", "観客側から見た向き"] ] as const).map(([perspective, title], index) => {
        const { verticalLabels } = createStageExportView(diagramSize, stage, perspective);
        const zero = verticalLabels.find(label => label.label === "0m")!;
        const descriptionId = `${name}-${perspective}`;
        return <label className={"counting-card" + (value === perspective ? " is-selected" : "")} key={perspective}>
          <span className="counting-card__heading">
            <input type="radio" name={name} value={perspective} aria-label={title} aria-describedby={descriptionId} checked={value === perspective} onChange={() => onChange(perspective)} />
            <strong>{index === 0 ? "①" : "②"} {title}</strong>
            <span className="counting-card__check" aria-hidden="true">{value === perspective ? "✓" : ""}</span>
          </span>
          <OrientationDiagram verticalLabels={verticalLabels} />
          <small id={descriptionId}>0m（客席側）が{zero.positionMeters === 0 ? "上" : "下"}</small>
        </label>;
      })}
    </div>
  </fieldset>;
};
