import { InputHTMLAttributes, useEffect, useState } from "react";

type NumericInputProps = Omit<
  InputHTMLAttributes<HTMLInputElement>,
  "type" | "value" | "onChange" | "min" | "max"
> & {
  value?: number;
  onValueChange: (value: number) => void;
  min?: number;
  max?: number;
  formatValue?: (value: number) => string;
};

const defaultFormatValue = (value: number) => (Number.isFinite(value) ? `${Number(value.toFixed(6))}` : "");

const isEditingPlaceholder = (value: string) => {
  const trimmed = value.trim();
  return trimmed === "" || trimmed === "-" || trimmed === "+" || trimmed === "." || trimmed === "-." || trimmed === "+.";
};

const clampNumber = (value: number, min?: number, max?: number) => {
  let next = value;
  if (typeof min === "number") next = Math.max(min, next);
  if (typeof max === "number") next = Math.min(max, next);
  return next;
};

export function NumericInput({
  value,
  onValueChange,
  min,
  max,
  formatValue = defaultFormatValue,
  onBlur,
  onFocus,
  ...props
}: NumericInputProps) {
  const [draftValue, setDraftValue] = useState(value === undefined ? "" : formatValue(value));
  const [isFocused, setIsFocused] = useState(false);

  useEffect(() => {
    if (!isFocused) {
      setDraftValue(value === undefined ? "" : formatValue(value));
    }
  }, [formatValue, isFocused, value]);

  const commitValue = (rawValue: string, shouldFormat: boolean) => {
    if (isEditingPlaceholder(rawValue)) {
      if (shouldFormat) {
        setDraftValue(value === undefined ? "" : formatValue(value));
      }
      return;
    }

    const parsedValue = Number(rawValue);
    if (!Number.isFinite(parsedValue)) {
      if (shouldFormat) {
        setDraftValue(value === undefined ? "" : formatValue(value));
      }
      return;
    }

    const nextValue = clampNumber(parsedValue, min, max);
    onValueChange(nextValue);
    if (shouldFormat) {
      setDraftValue(formatValue(nextValue));
    }
  };

  return (
    <input
      {...props}
      type="number"
      min={min}
      max={max}
      value={draftValue}
      onFocus={(event) => {
        setIsFocused(true);
        onFocus?.(event);
      }}
      onChange={(event) => {
        const nextDraftValue = event.target.value;
        setDraftValue(nextDraftValue);
        commitValue(nextDraftValue, false);
      }}
      onBlur={(event) => {
        setIsFocused(false);
        commitValue(event.target.value, true);
        onBlur?.(event);
      }}
    />
  );
}
