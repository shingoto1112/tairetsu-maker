import { useId } from "react";
import { getMemberLabelFontSize, splitMemberLabel } from "../utils/memberLabel";
import {
  applyMemberDiameterAction, MEMBER_DIAMETER_MAX, MEMBER_DIAMETER_MIN,
  MEMBER_DIAMETER_PRESETS, type MemberDiameterAction,
} from "../utils/memberDiameter";

type Props = {
  value: number;
  onChange: (action: MemberDiameterAction) => void;
  disabled?: boolean;
  error?: string;
};

export const MemberDiameterPicker = ({ value, onChange, disabled = false, error }: Props) => {
  const id = useId();
  const finite = Number.isFinite(value);
  const belowMinimum = finite && value < MEMBER_DIAMETER_MIN;
  const diameter = finite ? Math.max(0, Math.min(MEMBER_DIAMETER_MAX, value)) * 64 : 0;
  const lines = splitMemberLabel("さくら");
  const fontSize = getMemberLabelFontSize(diameter, lines, { min: 0 });
  const change = (action: MemberDiameterAction) => {
    if (!disabled && applyMemberDiameterAction(value, action) !== value) onChange(action);
  };
  return <fieldset className="member-diameter-picker" disabled={disabled}
    aria-describedby={`${id}-hint${error ? ` ${id}-error` : ""}`} aria-invalid={Boolean(error)}>
    <legend>メンバーの丸の大きさ（直径）</legend>
    <div className="member-diameter-picker__presets">
      {MEMBER_DIAMETER_PRESETS.map(preset => <label key={preset}
        className={"member-diameter-picker__option" + (value === preset ? " is-selected" : "")}>
        <input type="radio" name={id} value={preset} checked={value === preset}
          onChange={() => change({ type: "select", value: preset })} />
        <span>{preset === 1 ? "1.0" : preset}m</span>
      </label>)}
    </div>
    <div className="member-diameter-picker__adjust">
      <output aria-live="polite" aria-atomic="true">今の値 {finite ? value.toFixed(2) : "—"}m</output>
      <button type="button" disabled={disabled || !finite || value <= MEMBER_DIAMETER_MIN}
        aria-label="丸の直径を0.05m小さくする" onClick={() => change({ type: "step", direction: -1 })}>−</button>
      <button type="button" disabled={disabled || !finite || value >= MEMBER_DIAMETER_MAX}
        aria-label="丸の直径を0.05m大きくする" onClick={() => change({ type: "step", direction: 1 })}>＋</button>
    </div>
    <div className="member-diameter-picker__preview">
      <svg width="180" height="94" viewBox="0 0 180 94" aria-hidden="true" focusable="false">
        <path d="M26 10v8 M26 14h64 M90 10v8" fill="none" stroke="currentColor" />
        <text x="105" y="18" fontSize="12" fill="currentColor">1m</text>
        <circle cx="58" cy="56" r={diameter / 2} fill="var(--accent)" stroke="white" strokeWidth="2" />
        <text x="58" y="56" textAnchor="middle" dominantBaseline="central" fill="white"
          fontSize={fontSize} fontWeight="700">{lines[0]}</text>
      </svg>
      <small>大きさの目安<br />印刷時の見え方とは異なります</small>
    </div>
    <small id={`${id}-hint`} className={belowMinimum ? "member-diameter-picker__legacy" : undefined}>
      {belowMinimum ? "以前の値を保持しています。0.5m未満は新しく選べません。＋で0.5mになります。" : "0.5〜1.0mから選べます（−／＋は0.05mずつ）。"}
    </small>
    {error && <small id={`${id}-error`} className="formation-field-error" role="alert">{error}</small>}
  </fieldset>;
};
