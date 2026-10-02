import { useCallback, useEffect, useRef, useState } from "react";

export type NoticeKind = "persistent" | "success";
export type Notice = { message: string; kind: NoticeKind; id: number };

/** Unclassified notices stay visible. Each emission replaces the previous one, even with identical text. */
export const useNotice = (initialMessage: string | null = null) => {
  const sequence = useRef(0);
  const [notification, setNotification] = useState<Notice | null>(() =>
    initialMessage ? { message: initialMessage, kind: "persistent", id: 0 } : null,
  );
  const setNotice = useCallback((message: string | null, kind: NoticeKind = "persistent") => {
    setNotification(message ? { message, kind, id: ++sequence.current } : null);
  }, []);
  const dismissNotice = useCallback(() => setNotification(null), []);

  useEffect(() => {
    if (notification?.kind !== "success") return;
    const timer = window.setTimeout(() => {
      setNotification((current) => current === notification ? null : current);
    }, 3000);
    return () => window.clearTimeout(timer);
  }, [notification]);

  return { notice: notification?.message ?? null, notification, setNotice, dismissNotice };
};
