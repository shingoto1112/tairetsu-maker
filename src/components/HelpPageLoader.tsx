import { lazy, Suspense, useEffect, useState } from "react";

const loadHelpPage = () => import("./HelpPage");
const HelpPage = lazy(loadHelpPage);

export function useHelpPage() {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    // Keep the text/CSS out of the startup graph, but make the first opening
    // available after the network disappears. Native apps load local assets.
    const preload = () => { void loadHelpPage().catch(() => { /* Opening can retry. */ }); };
    const timer = window.setTimeout(preload, 1500);
    window.addEventListener("online", preload);
    return () => { window.clearTimeout(timer); window.removeEventListener("online", preload); };
  }, []);
  return {
    openHelpPage: () => setOpen(true),
    helpPage: open ? <Suspense fallback={<div role="status">使い方を読み込み中…</div>}>
      <HelpPage onClose={() => setOpen(false)} />
    </Suspense> : null,
  };
}
