import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { visibleItems } from "../announcements/contract";
import { getAnnouncementService, markRead, readIds } from "../announcements/service";
const loadPage = () => import("./AnnouncementsPage");
const Page = lazy(loadPage);
export function useAnnouncements() {
  const service = getAnnouncementService();
  const [feed, setFeed] = useState(service.getFeed), [read, setRead] = useState(readIds), [open, setOpen] = useState(false);
  const trigger = useRef<HTMLElement | null>(null), mounted = useRef(false);
  const items = useMemo(() => visibleItems(feed), [feed]);
  const unreadIds = items.filter(item => !read.includes(item.id)).map(item => item.id);
  useEffect(() => {
    mounted.current = true;
    void service.refresh("home").then(value => { if (mounted.current) setFeed(value); });
    const preload = () => { void loadPage().catch(() => {}); };
    const timer = window.setTimeout(preload, 1500); window.addEventListener("online", preload);
    return () => { mounted.current = false; clearTimeout(timer); window.removeEventListener("online", preload); };
  }, [service]);
  const onDisplayed = useCallback((ids: string[]) => setRead(previous => ids.every(id => previous.includes(id)) ? previous : markRead(ids, previous)), []);
  const close = () => { setOpen(false); requestAnimationFrame(() => trigger.current?.focus({ preventScroll: true })); };
  return {
    hasUnread: unreadIds.length > 0,
    openAnnouncements: () => {
      trigger.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      setOpen(true); void service.refresh("open").then(value => { if (mounted.current) setFeed(value); });
    },
    announcementsPage: open ? <Suspense fallback={<div role="status">お知らせを読み込み中…</div>}><Page items={items} unreadIds={unreadIds} onDisplayed={onDisplayed} onClose={close} /></Suspense> : null,
  };
}
