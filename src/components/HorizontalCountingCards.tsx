import { useId } from "react";
import { createHorizontalRulerLabels, horizontalCountingOptions, type HorizontalCountingMode } from "../utils/horizontalRuler";
type Props = { value: HorizontalCountingMode; onChange: (value: HorizontalCountingMode) => void; compact?: boolean; disabled?: boolean };
const CountingDiagram = ({ mode }: { mode: HorizontalCountingMode }) => {
  const labels = createHorizontalRulerLabels(6, mode);
  const members = mode === "meters" ? [1, 2, 3, 4, 5] : [1.5, 2.5, 3.5, 4.5];
  return <svg className="counting-diagram" viewBox="0 0 240 98" overflow="visible" aria-hidden="true" focusable="false">
    <rect className="counting-diagram__stage" x="20" y="28" width="200" height="60" />
    {[1, 2, 4, 5].map(x => <line className="counting-diagram__grid" key={x} x1={20 + x * 200 / 6} x2={20 + x * 200 / 6} y1="28" y2="88" />)}
    {[48, 68].map(y => <line className="counting-diagram__grid" key={y} x1="20" x2="220" y1={y} y2={y} />)}
    <line className="counting-diagram__center" x1="120" x2="120" y1="28" y2="88" />
    {labels.map(item => <text key={item.key} x={20 + item.positionMeters * 200 / 6} y="18">{item.label}</text>)}
    {members.map(x => <circle key={x} className="counting-diagram__member" cx={20 + x * 200 / 6} cy="58" r="9" />)}
  </svg>;
};
export const HorizontalCountingCards = ({ value, onChange, compact = false, disabled = false }: Props) => {
  const name = useId();
  return <fieldset className={"horizontal-counting" + (compact ? " horizontal-counting--compact" : "")} disabled={disabled}>
    <legend>横の数え方</legend>
    <div className="horizontal-counting__cards">
      {horizontalCountingOptions.map((option, index) => <label key={option.value} className={"counting-card" + (value === option.value ? " is-selected" : "")}>
        <span className="counting-card__heading">
          <input type="radio" name={name} value={option.value} checked={value === option.value} onChange={() => onChange(option.value)} />
          <strong>{index === 0 ? "①" : "②"} {option.title}</strong>
          <span className="counting-card__check" aria-hidden="true">{value === option.value ? "✓" : ""}</span>
        </span>
        <CountingDiagram mode={option.value} />
        <small>{option.description}</small>
      </label>)}
    </div>
  </fieldset>;
};
