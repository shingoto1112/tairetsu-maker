import { memo, useId } from "react";
import { LayoutGrid } from "lucide-react";
import type { ProjectSummary } from "../repositories/types";
import { useProjectCardPreview, type ProjectCardPreviewSource } from "../hooks/useProjectCardPreview";
import "./projectCardPreview.css";

export type { ProjectCardPreviewSource } from "../hooks/useProjectCardPreview";

export const ProjectCardPreview = memo(function ProjectCardPreview({ summary, source }: {
  summary: ProjectSummary; source: ProjectCardPreviewSource;
}) {
  const { ref, model } = useProjectCardPreview(summary, source);
  const patternId = `project-card-grid-${useId().replace(/:/g, "")}`;
  return <div ref={ref} className="project-card-preview" aria-hidden="true">
    {model ? <svg className="project-card-preview__drawing" width="100%" height="100%"
      viewBox={`0 ${model.top} ${model.width} ${model.height}`} preserveAspectRatio="xMidYMid meet" aria-hidden="true">
      <defs>
        <pattern id={patternId} patternUnits="userSpaceOnUse" width={model.gridStep} height={model.gridStep}
          patternTransform={`translate(${model.gridOriginX} 0)`}>
          <path d={`M ${model.gridStep} 0 H 0 V ${model.gridStep}`} fill="none" stroke="#d8e2ec" strokeWidth="0.025" />
        </pattern>
      </defs>
      <rect x="0" y={model.top} width={model.width} height={model.height} fill="#fff" />
      <rect x="0" y={model.top} width={model.width} height={model.height} fill={`url(#${patternId})`}
        stroke="#d8e2ec" strokeWidth="0.04" />
      <line x1={model.width / 2} y1={model.top} x2={model.width / 2} y2={model.top + model.height}
        stroke="#0d8b78" strokeOpacity="0.35" strokeWidth="0.035" />
      {model.objects.map((object, index) => <rect key={index} data-preview-object=""
        x={object.x} y={object.y} width={object.width} height={object.height}
        rx={object.shape === "circle" ? object.width / 2 : 0.06}
        transform={`rotate(${object.rotation} ${object.x + object.width / 2} ${object.y + object.height / 2})`}
        fill={object.color} fillOpacity={object.opacity} stroke={object.color} strokeWidth="0.04" />)}
      {model.points.map((point, index) => <circle key={index} cx={point.x} cy={point.y} r={model.radius}
        fill={point.color} stroke="#fff" strokeWidth={model.pointStrokeWidth} />)}
    </svg> : <LayoutGrid className="project-card-preview__placeholder" aria-hidden="true" />}
  </div>;
});
