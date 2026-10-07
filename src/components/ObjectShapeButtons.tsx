import type { StageObjectShape } from "../types";
import { objectShapeChoice, type ObjectShapeChoice } from "../project/objectAppearance";
import "./objectShapeSizeEditor.css";

export const ObjectShapeIcon = ({ shape, color = "#0f766e" }: { shape: StageObjectShape; color?: string }) =>
  <span aria-hidden="true" className={`stage-object shape-${shape} object-shape-icon`} style={{ backgroundColor: color }} />;

export function ObjectShapeButtons({ shape, disabled, label = "道具の形", onChange }: {
  shape: StageObjectShape; disabled?: boolean; label?: string; onChange: (shape: ObjectShapeChoice) => void;
}) {
  return <div className="object-shape-buttons" role="group" aria-label={label}>
    {(["rectangle", "circle"] as const).map(choice => <button type="button" key={choice} disabled={disabled}
      aria-pressed={objectShapeChoice(shape) === choice} onClick={() => onChange(choice)}>
      {choice === "rectangle" ? "□ 四角形" : "⬭ 円"}
    </button>)}
  </div>;
}
