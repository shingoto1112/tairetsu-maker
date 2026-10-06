import { useEffect, useRef, useState } from "react";

/** Scene times reorder the view, so keep edits local until blur or Enter. */
export const SceneTimeInput = ({ value, onCommit, disabled, title }: {
  value: number;
  onCommit: (value: number) => void;
  disabled?: boolean;
  title?: string;
}) => {
  const [draft, setDraft] = useState(String(value));
  const editing = useRef(false);
  const dirty = useRef(false);
  useEffect(() => {
    if (!editing.current) setDraft(String(value));
  }, [value]);
  const commit = () => {
    editing.current = false;
    const next = draft.trim() === "" ? NaN : Number(draft);
    if (dirty.current && Number.isFinite(next) && next >= 0 && !disabled) {
      dirty.current = false;
      setDraft(String(next));
      onCommit(next);
    } else {
      dirty.current = false;
      setDraft(String(value));
    }
  };
  return <input type="number" min={0} step="0.1" value={draft} disabled={disabled} title={title}
    onFocus={() => { editing.current = true; }}
    onChange={event => { editing.current = true; dirty.current = true; setDraft(event.target.value); }}
    onBlur={commit}
    onKeyDown={event => {
      if (event.key === "Enter" && !event.nativeEvent.isComposing) {
        event.preventDefault();
        event.currentTarget.blur();
      }
    }} />;
};
