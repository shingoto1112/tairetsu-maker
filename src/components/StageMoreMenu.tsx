import { MoreHorizontal } from "lucide-react";
import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

export type StageMoreAction = {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  pressed?: boolean;
};

export const StageMoreMenu = ({ actions }: { actions: StageMoreAction[] }) => {
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState({ top: 0, right: 0 });
  const buttonRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const id = useId();
  const close = () => { setOpen(false); buttonRef.current?.focus(); };

  useLayoutEffect(() => {
    if (!open) return;
    const rect = buttonRef.current!.getBoundingClientRect();
    setPosition({ top: rect.bottom + 4, right: Math.max(8, window.innerWidth - rect.right) });
    menuRef.current?.querySelector<HTMLButtonElement>("button:not(:disabled)")?.focus();
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const outside = (event: PointerEvent) => {
      const target = event.target as Node;
      if (!menuRef.current?.contains(target) && !buttonRef.current?.contains(target)) setOpen(false);
    };
    const resize = () => setOpen(false);
    document.addEventListener("pointerdown", outside);
    window.addEventListener("resize", resize);
    return () => {
      document.removeEventListener("pointerdown", outside);
      window.removeEventListener("resize", resize);
    };
  }, [open]);

  return <>
    <button ref={buttonRef} className="mini-button icon-only" type="button"
      aria-label="その他のステージ操作" title="その他" aria-haspopup="menu"
      aria-expanded={open} aria-controls={open ? id : undefined} onClick={() => setOpen(!open)}>
      <MoreHorizontal size={20} />
    </button>
    {open && createPortal(
      <div ref={menuRef} id={id} className="stage-more-menu" data-workspace-layout="portrait" role="menu" aria-label="その他のステージ操作"
        style={{ ...position, maxHeight: `calc(100dvh - ${position.top + 8}px)` }}
        onKeyDown={(event) => {
          if (event.key === "Escape") { event.preventDefault(); close(); }
          if (event.key === "Tab") setOpen(false);
          if (event.key === "ArrowDown" || event.key === "ArrowUp" || event.key === "Home" || event.key === "End") {
            event.preventDefault();
            const items = Array.from(menuRef.current!.querySelectorAll<HTMLButtonElement>("button:not(:disabled)"));
            const index = items.indexOf(document.activeElement as HTMLButtonElement);
            const next = event.key === "Home" ? 0 : event.key === "End" ? items.length - 1
              : (index + (event.key === "ArrowDown" ? 1 : -1) + items.length) % items.length;
            items[next]?.focus();
          }
        }}>
        {actions.map((action) => <button key={action.label} type="button"
          role={action.pressed === undefined ? "menuitem" : "menuitemcheckbox"}
          aria-checked={action.pressed} disabled={action.disabled}
          onClick={() => { action.onClick(); close(); }}>{action.label}</button>)}
      </div>, buttonRef.current?.closest(".stage-fullscreen-host") ?? buttonRef.current?.closest(".app-shell") ?? document.body)}
  </>;
};
