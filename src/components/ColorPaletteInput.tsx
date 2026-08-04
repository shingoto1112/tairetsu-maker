import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";

const DEFAULT_COLOR_PALETTE = [
  "#1c1c1c", "#6b120a", "#6c310f", "#6e4414", "#705d1b", "#737522", "#587420", "#31721e", "#265d72", "#173a72", "#00026f", "#3d066e", "#671043",
  "#393939", "#961d14", "#984519", "#995f1f", "#9c8128", "#a3a333", "#7ca130", "#48a12d", "#3881a1", "#22549d", "#00009e", "#580d9b", "#931b62",
  "#555555", "#c1271b", "#c35a23", "#c67a2c", "#cba536", "#d1d344", "#9dd140", "#5fcf3d", "#4aa6cd", "#2e6acc", "#0100cc", "#7214ca", "#bd2781",
  "#717171", "#e93423", "#ee6a2c", "#ef9535", "#f6cc44", "#ffff55", "#c2fc50", "#75fb4c", "#5ccbf9", "#3982f5", "#0000f6", "#8d1cf4", "#e7329d",
  "#8e8e8e", "#ea4333", "#ed8637", "#f2a940", "#f8d448", "#feff5c", "#cbfd4e", "#7bfb4c", "#65d5fa", "#4d99f7", "#2d36f7", "#9e29f4", "#e83dad",
  "#aaaaaa", "#ec665d", "#f39f61", "#f5bb67", "#f8de6d", "#fffe6e", "#d7fc6e", "#90fb6d", "#7fdefe", "#6faff9", "#5c66f9", "#b15bf2", "#ea63bf",
  "#c6c6c6", "#ef908c", "#f4bb8e", "#f7cf91", "#fbe791", "#ffff95", "#e2fd94", "#abfc93", "#9fe7fd", "#97c6fa", "#8b93f6", "#c88af9", "#f18bd4",
  "#e3e3e3", "#f3bcb9", "#f9d5bb", "#fae2bc", "#fcf0bc", "#feffbd", "#eefebd", "#cafdbb", "#c2f0fd", "#bfdcfa", "#babefb", "#ddb8fb", "#f4bce3",
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
  const colorInputValue = /^#[0-9a-f]{6}$/i.test(currentColor)
    ? currentColor
    : "#0f766e";
  const colors = useMemo(() => {
    const uniqueColors = palette.filter(
      (color, index, source) =>
        source.findIndex((item) => normalizeColor(item) === normalizeColor(color)) === index,
    );
    return uniqueColors;
  }, [palette]);
  const isPaletteColor = colors.some(
    (color) => normalizeColor(color) === normalizedCurrent,
  );

  useEffect(() => {
    if (disabled) {
      setOpen(false);
      return;
    }
    if (!open) {
      return;
    }

    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (
        !rootRef.current?.contains(target) &&
        !popoverRef.current?.contains(target)
      ) {
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
      {open &&
        createPortal(
          <div
            className="color-palette-popover"
            id={paletteId}
            ref={popoverRef}
            role="listbox"
            aria-label={label}
            style={popoverPosition}
          >
            <div className="color-palette-grid">
              {colors.map((color, index) => {
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
                    aria-label={`${label}: ${Math.floor(index / 13) + 1}段目 ${index % 13 + 1}列目`}
                    aria-selected={isSelected}
                    role="option"
                  />
                );
              })}
            </div>
            <label className="color-palette-custom">
              <span>{isPaletteColor ? "その他の色" : "現在の色"}</span>
              <input
                type="color"
                value={colorInputValue}
                onChange={(event) => onChange(event.target.value)}
                aria-label={`${label}を自由に選ぶ`}
              />
            </label>
          </div>,
          document.body,
        )}
    </div>
  );
}
