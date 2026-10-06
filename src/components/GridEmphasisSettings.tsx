import type { ParadeSettings, StageConfig } from "../types";
export const GridEmphasisSettings = ({ stage, parade, disabled, onStageChange, onParadeChange }: {
  stage: StageConfig; parade?: ParadeSettings; disabled?: boolean;
  onStageChange: (patch: Partial<StageConfig>) => void;
  onParadeChange?: (patch: Partial<ParadeSettings>) => void;
}) => {
  const settings = parade ?? stage;
  const horizontal = [
    ["emphasizeHorizontalNumbers", "目盛りの数字の線を濃くする"],
    ["emphasizeHorizontalEvery5", "5ごとの線を濃くする（数字5, 10, 15…）"],
    ["emphasizeHorizontalEvery10", "10ごとの線を濃くする（数字10, 20…）"],
  ] as const;
  const vertical = [
    ["emphasizeVerticalNumbers", "1mごとの数字の線を濃くする"],
    [parade ? "emphasizeEvery5m" : "emphasizeVerticalEvery5m", "5mごとの線を濃くする"],
    [parade ? "emphasizeEvery10m" : "emphasizeVerticalEvery10m", "10mごとの線を濃くする"],
  ] as const;
  return <div className="grid-emphasis-settings">{[
    { title: "横の目盛り（左右）", fields: horizontal },
    { title: parade ? "縦の目盛り（距離）" : "縦の目盛り（前後）", fields: vertical },
  ].map(group => <fieldset key={group.title} disabled={disabled}>
    <legend>{group.title}</legend><div className="toggle-list">{group.fields.map(([field, label]) =>
      <label key={field}><input type="checkbox"
        checked={Boolean((settings as unknown as Record<string, unknown>)[field] ?? (parade && ["emphasizeEvery5m", "emphasizeEvery10m"].includes(field)))}
        onChange={event => parade ? onParadeChange?.({ [field]: event.target.checked }) : onStageChange({ [field]: event.target.checked })} />{label}</label>
    )}</div></fieldset>)}</div>;
};
