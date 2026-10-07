import { useId, useLayoutEffect, useRef, useState } from "react";
import type { Notice } from "../hooks/useNotice";

type ExportImportPanelProps = {
  notice: Notice | null;
  warnings: string[];
  onDismissNotice: () => void;
};

export const ExportImportPanel = ({ notice, warnings, onDismissNotice }: ExportImportPanelProps) => {
  const overlayRef = useRef<HTMLElement>(null);

  // Stay inside the visible canvas area when Safari pans/resizes its visual viewport for the keyboard.
  useLayoutEffect(() => {
    const overlay = overlayRef.current;
    const host = overlay?.parentElement;
    if (!overlay || !host) return;
    const canvas = host.querySelector<HTMLElement>(".stage-fit-area, .parade-viewport");
    const viewport = window.visualViewport;
    const updatePosition = () => {
      const hostRect = host.getBoundingClientRect();
      const measuredCanvas = canvas?.getBoundingClientRect();
      // A small native keyboard workspace can leave no canvas height. Keep the
      // notice's close control within the host's remaining operation area.
      const canvasRect = measuredCanvas && measuredCanvas.height >= 44 ? measuredCanvas : hostRect;
      const visibleTop = viewport?.offsetTop ?? 0;
      const visibleBottom = visibleTop + (viewport?.height ?? window.innerHeight);
      const top = Math.max(canvasRect.top, hostRect.top, visibleTop);
      const bottom = Math.min(hostRect.bottom, visibleBottom);
      overlay.style.setProperty("--status-top", `${Math.max(0, top - hostRect.top)}px`);
      overlay.style.setProperty("--status-height", `${Math.max(0, bottom - top)}px`);
    };
    const observer = new ResizeObserver(updatePosition);
    observer.observe(host);
    if (canvas) observer.observe(canvas);
    window.addEventListener("resize", updatePosition);
    window.addEventListener("scroll", updatePosition, true);
    viewport?.addEventListener("resize", updatePosition);
    viewport?.addEventListener("scroll", updatePosition);
    updatePosition();
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", updatePosition);
      window.removeEventListener("scroll", updatePosition, true);
      viewport?.removeEventListener("resize", updatePosition);
      viewport?.removeEventListener("scroll", updatePosition);
    };
  }, []);

  return (
    <section ref={overlayRef} className="status-overlay" aria-label="お知らせ">
      {/* Keep the live regions mounted before their content changes. Controls are outside them. */}
      <div className={`status-toast${notice ? " is-visible" : ""}`}>
        <p className="status-toast__message" role="status" aria-live="polite" aria-atomic="true">
          {notice && <span key={notice.id}>{notice.message}</span>}
        </p>
        {notice && <button type="button" className="status-overlay__button" onClick={onDismissNotice}
          aria-label="お知らせを閉じる" title="お知らせを閉じる">×</button>}
      </div>
      <WarningsDisclosure key={JSON.stringify(warnings)} warnings={warnings} />
    </section>
  );
};

const WarningsDisclosure = ({ warnings }: { warnings: string[] }) => {
  const warningsId = useId();
  const [dismissed, setDismissed] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const showWarnings = warnings.length > 0 && !dismissed;
  return <>
      <p className="visually-hidden" role="status" aria-live="polite" aria-atomic="true">
        {showWarnings ? `警告${warnings.length}件` : ""}
      </p>
      {showWarnings && <div className="status-warnings">
        <div className="status-warnings__controls">
          <button type="button" className="status-overlay__button" aria-expanded={expanded}
            aria-controls={warningsId} onClick={() => setExpanded(!expanded)}>
            警告{warnings.length}件 {expanded ? "▴" : "▾"}
          </button>
          <button type="button" className="status-overlay__button" aria-label="お知らせを閉じる"
            title="警告を閉じる" onClick={() => setDismissed(true)}>×</button>
        </div>
        <ul id={warningsId} className="status-warnings__list" hidden={!expanded}>
          {warnings.map((warning, index) => <li key={`${index}:${warning}`}>{warning}</li>)}
        </ul>
      </div>}
    </>;
};
