import { useId } from "react";
import type { VerticalOrigin } from "../utils/gridEmphasis";

export const VerticalOriginOptions = ({ value, onChange, disabled = false }: {
  value: VerticalOrigin; onChange: (value: VerticalOrigin) => void; disabled?: boolean;
}) => {
  const name = useId();
  return <fieldset className="vertical-origin-options" disabled={disabled}>
    <legend>縦の目盛りの0mの位置</legend>
    <div>{(["top", "bottom"] as const).map(origin =>
      <label key={origin}><input type="radio" name={name} value={origin} checked={value === origin}
        onChange={() => onChange(origin)} />{origin === "top" ? "上を0mにする" : "下を0mにする"}</label>)}</div>
  </fieldset>;
};
