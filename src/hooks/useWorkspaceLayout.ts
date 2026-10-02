import { useEffect, useState } from "react";

const PORTRAIT_QUERY = "(orientation: portrait) and (max-width: 1400px)";

/** Layout uses the layout viewport; keyboard height only changes the available space. */
export const useWorkspaceLayout = () => {
  const [isPortrait, setIsPortrait] = useState(() => window.matchMedia(PORTRAIT_QUERY).matches);
  const [viewport, setViewport] = useState(() => ({
    height: window.visualViewport?.height ?? window.innerHeight,
    keyboardOpen: false,
  }));

  useEffect(() => {
    const query = window.matchMedia(PORTRAIT_QUERY);
    const updateLayout = () => setIsPortrait(query.matches);
    const updateViewport = () => {
      const height = window.visualViewport?.height ?? window.innerHeight;
      setViewport({ height, keyboardOpen: window.innerHeight - height > 160 });
    };
    query.addEventListener("change", updateLayout);
    window.addEventListener("resize", updateViewport);
    window.visualViewport?.addEventListener("resize", updateViewport);
    updateLayout();
    updateViewport();
    return () => {
      query.removeEventListener("change", updateLayout);
      window.removeEventListener("resize", updateViewport);
      window.visualViewport?.removeEventListener("resize", updateViewport);
    };
  }, []);

  return { isPortrait, ...viewport };
};
