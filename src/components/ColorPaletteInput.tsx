import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from "react";

const DEFAULT_COLOR_PALETTE = [
  "#fca5a5", "#f87171", "#ef4444", "#ff6b35", "#fb923c",
  "#fdba74", "#fbbf24", "#facc15", "#fde047", "#ffd54f",
  "#fda4af", "#fb7185", "#f43f5e", "#f9a8d4", "#f472b6",
  "#ec4899", "#ff4db8", "#e879f9", "#d946ef", "#c084fc",
  "#d8b4fe", "#b388ff", "#a855f7", "#ab47bc", "#8b5cf6",
  "#818cf8", "#6366f1", "#60a5fa", "#3b82f6", "#42a5f5",
  "#93c5fd", "#7dd3fc", "#38bdf8", "#29b6f6", "#0ea5e9",
  "#67e8f9", "#22d3ee", "#06b6d4", "#00bcd4", "#00e5c0",
  "#5eead4", "#2dd4bf", "#20c997", "#14b8a6", "#34d399",
  "#10b981", "#86efac", "#4ade80", "#22c55e", "#76ff03",
  "#a3e635", "#84cc16", "#bef264", "#16a34a", "#f59e0b",
  "#f97316", "#ff7f50", "#ff8a80", "#64748b", "#111827",
];

const normalizeColor = (color: string) => color.trim().toLowerCase();

type ColorPaletteInputProps = {
  value: string;
  onChange: (color: string) => void;
  label: string;
  compact?: boolean;
  disabled?: boolean;
  palette?: string[];
};

export function ColorPaletteInput({
  value,
  onChange,
  label,
  compact = false,
  disabled = false,
  palette = DEFAULT_COLOR_PALETTE,
}: ColorPaletteInputProps) {
  const [open, setOpen] = useState(false);
  const [popoverPosition, setPopoverPosition] = useState({ left: 0, top: 0 });
  const rootRef = useRef<HTMLDivElement | null>(null);
  const popoverRef = useRef<HTMLDivElement | null>(null);
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
    if (disabled) {
      setOpen(false);
      return;
    }
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
  }, [disabled, open]);

  useLayoutEffect(() => {
    if (!open || !rootRef.current) {
      return;
    }
    const updatePosition = () => {
      if (!rootRef.current) return;
      const triggerRect = rootRef.current.getBoundingClientRect();
      const popoverRect = popoverRef.current?.getBoundingClientRect();
      const width = popoverRect?.width ?? (compact ? 236 : 276);
      const height = popoverRect?.height ?? 176;
      const margin = 10;
      const maxLeft = Math.max(margin, window.innerWidth - width - margin);
      const maxTop = Math.max(margin, window.innerHeight - height - margin);
      const preferredTop = triggerRect.bottom + 8;
      const fallbackTop = triggerRect.top - height - 8;
      setPopoverPosition({
        left: Math.min(Math.max(margin, triggerRect.left), maxLeft),
        top: Math.min(
          Math.max(margin, preferredTop > maxTop ? fallbackTop : preferredTop),
          maxTop,
        ),
      });
    };

    updatePosition();
    window.addEventListener("resize", updatePosition);
    window.addEventListener("scroll", updatePosition, true);
    return () => {
      window.removeEventListener("resize", updatePosition);
      window.removeEventListener("scroll", updatePosition, true);
    };
  }, [compact, open, colors.length]);

  return (
    <div
      className={`color-palette-input${compact ? " is-compact" : ""}`}
      ref={rootRef}
      onClick={(event) => event.stopPropagation()}
    >
      <button
        type="button"
        className="color-palette-trigger"
        disabled={disabled}
        style={{ backgroundColor: currentColor }}
        onClick={() => setOpen((current) => !current)}
        aria-label={`${label}を選ぶ`}
        aria-controls={open ? paletteId : undefined}
        aria-expanded={open}
        title={`${label}を選ぶ`}
      />
      {open && (
        <div
          className="color-palette-popover"
          id={paletteId}
          ref={popoverRef}
          role="listbox"
          aria-label={label}
          style={popoverPosition}
        >
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
