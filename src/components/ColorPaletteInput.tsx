import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from "react";

const DEFAULT_COLOR_PALETTE = [
  "#fee2e2", "#fce7f3", "#f3e8ff", "#dbeafe", "#cffafe", "#ccfbf1", "#dcfce7", "#fef3c7", "#f1f5f9",
  "#fca5a5", "#f9a8d4", "#d8b4fe", "#93c5fd", "#67e8f9", "#5eead4", "#86efac", "#fde68a", "#cbd5e1",
  "#ef4444", "#ec4899", "#a855f7", "#3b82f6", "#06b6d4", "#14b8a6", "#22c55e", "#facc15", "#64748b",
  "#991b1b", "#9d174d", "#581c87", "#1e40af", "#155e75", "#0f766e", "#166534", "#92400e", "#111827",
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
