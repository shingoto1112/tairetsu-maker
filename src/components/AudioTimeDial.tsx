import { TimeDial } from "./TimeDial";

/** Loop-specific validation and the exact (possibly fractional) song endpoint. */
export const AudioTimeDial = ({ label, value, duration, otherTime, edge, onCommit, onCancel }: {
  label: string; value: number; duration: number; otherTime: number; edge: "start" | "end";
  onCommit: (seconds: number) => void; onCancel: () => void;
}) => <TimeDial label={label} value={value} maxSeconds={duration}
  validate={next => (edge === "start" ? next < otherTime : next > otherTime) ? null : "開始は終了より前にしてください。"}
  shortcut={{ label: "曲の終わり", seconds: duration }}
  onCommit={seconds => onCommit(seconds)} onCancel={onCancel} />;
