import { useEffect, useId, useMemo, useRef, useState } from "react";

const DEFAULT_COLOR_PALETTE = [
  "#0f766e",
  "#14b8a6",
  "#22c55e",
  "#84cc16",
  "#facc15",
  "#f97316",
  "#ef4444",
  "#ec4899",
  "#a855f7",
  "#6366f1",
  "#3b82f6",
  "#06b6d4",
  "#64748b",
  "#111827",
  "#ffffff",
];

const normalizeColor = (color: string) => color.trim().toLowerCase();

type ColorPaletteInputProps = {
  value: string;
  onChange: (color: string) => void;
  label: string;
  compact?: boolean;
  palette?: string[];
};

export function ColorPaletteInput({
  value,
  onChange,
  label,
  compact = false,
  palette = DEFAULT_COLOR_PALETTE,
}: ColorPaletteInputProps) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const paletteId = useId();
  const currentColor = value || DEFAULT_COLOR_PALETTE[0];
  const normalizedCurrent = normalizeColor(currentColor);
  const colors = useMemo(() => {
    const uniqueColors = palette.filter(
      (color, index, source) =>
        source.findIndex((item) => normalizeColor(item) === normalizeColor(color)) === index,
    );
    if (uniqueColors.some((color) => normalizeColor(color) === normalizedCurrent)) {
      return uniqueColors;
    }
    return [currentColor, ...uniqueColors];
  }, [currentColor, normalizedCurrent, palette]);

  useEffect(() => {
    if (!open) {
      return;
    }

    const handlePointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpen(false);
      }
    };

    window.addEventListener("pointerdown", handlePointerDown);
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("pointerdown", handlePointerDown);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [open]);

  return (
    <div
      className={`color-palette-input${compact ? " is-compact" : ""}`}
      ref={rootRef}
      onClick={(event) => event.stopPropagation()}
    >
      <button
        type="button"
        className="color-palette-trigger"
        style={{ backgroundColor: currentColor }}
        onClick={() => setOpen((current) => !current)}
        aria-label={`${label}を選ぶ`}
        aria-controls={open ? paletteId : undefined}
        aria-expanded={open}
        title={`${label}を選ぶ`}
      />
      {open && (
        <div className="color-palette-popover" id={paletteId} role="listbox" aria-label={label}>
          {colors.map((color) => {
            const isSelected = normalizeColor(color) === normalizedCurrent;
            return (
              <button
                key={color}
                type="button"
                className={`color-palette-swatch${isSelected ? " is-selected" : ""}`}
                style={{ backgroundColor: color }}
                onClick={() => {
                  onChange(color);
                  setOpen(false);
                }}
                aria-label={`${label}: ${color}`}
                aria-selected={isSelected}
                role="option"
              />
            );
          })}
        </div>
      )}
    </div>
  );
}
