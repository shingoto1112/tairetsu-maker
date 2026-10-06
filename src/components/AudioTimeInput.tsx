import { useEffect, useRef, useState } from "react";
import { formatTimeTenths, parseTimeInput } from "../utils/time";

/** Time field shown as m:ss.s; keeps a draft while typing and commits on blur or Enter. */
export const AudioTimeInput = ({ value, onCommit, disabled, ariaLabel, max }: {
  value: number;
  onCommit: (seconds: number) => void;
  disabled?: boolean;
  ariaLabel: string;
  max?: number;
}) => {
  const [draft, setDraft] = useState(formatTimeTenths(value));
  const editing = useRef(false);
  useEffect(() => { if (!editing.current) setDraft(formatTimeTenths(value)); }, [value]);
  const commit = () => {
    if (!editing.current) return;
    editing.current = false;
    const parsed = parseTimeInput(draft);
    if (parsed === null || disabled) { setDraft(formatTimeTenths(value)); return; }
    const next = Math.round(Math.min(Math.max(0, parsed), max ?? Infinity) * 10) / 10;
    setDraft(formatTimeTenths(next));
    if (Math.abs(next - value) >= 0.05) onCommit(next);
  };
  return <input type="text" inputMode="decimal" aria-label={ariaLabel} value={draft} disabled={disabled}
    onFocus={() => { editing.current = true; }}
    onChange={(event) => { editing.current = true; setDraft(event.target.value); }}
    onBlur={commit}
    onKeyDown={(event) => {
      if (event.key === "Enter" && !event.nativeEvent.isComposing) { event.preventDefault(); commit(); }
    }} />;
};
