import { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import { useModalFocus } from "../hooks/useModalFocus";
import { kindLabels, safeLink, type visibleItems } from "../announcements/contract";
import { allowedOrigins } from "../announcements/service";
import "./announcementsPage.css";
export function AnnouncementBody({ body }: { body: string }) {
  const blocks: { list: boolean; lines: string[] }[] = [];
  for (const line of body.replace(/\r\n?/g, "\n").split("\n")) {
    if (!line.trim()) { blocks.push({ list: false, lines: [] }); continue; }
    const list = /^(・|- )/.test(line), last = blocks[blocks.length - 1];
    const text = list ? line.replace(/^(・|- )/, "") : line;
    if (last && last.lines.length && last.list === list) last.lines.push(text);
    else blocks.push({ list, lines: [text] });
  }
  return <>{blocks.filter(b => b.lines.length).map((b, i) => b.list ? <ul key={i}>{b.lines.map((line, j) => <li key={j}>{line}</li>)}</ul> : <p key={i}>{b.lines.join("\n")}</p>)}</>;
}
const dateFormat = new Intl.DateTimeFormat("ja-JP", { timeZone: "Asia/Tokyo", year: "numeric", month: "long", day: "numeric" });
export default function AnnouncementsPage({ items, unreadIds, onDisplayed, onClose }: {
  items: ReturnType<typeof visibleItems>; unreadIds: string[]; onDisplayed: (ids: string[]) => void; onClose: () => void;
}) {
  const ref = useRef<HTMLElement>(null), overlay = useRef<HTMLDivElement>(null), id = useId();
  const [newIds] = useState(() => new Set(unreadIds));
  useEffect(() => {
    const siblings = Array.from(document.body.children).filter((e): e is HTMLElement => e instanceof HTMLElement && e !== overlay.current);
    const prior = siblings.map(e => e.inert), overflow = document.body.style.overflow;
    siblings.forEach(e => { e.inert = true; }); document.body.style.overflow = "hidden";
    return () => { siblings.forEach((e, i) => { e.inert = prior[i]; }); document.body.style.overflow = overflow; };
  }, []);
  const trapFocus = useModalFocus(ref);
  useEffect(() => { onDisplayed(items.map(item => item.id)); }, [items, onDisplayed]);
  return createPortal(<div className="announcements-backdrop" ref={overlay}>
    <section className="announcements-page" ref={ref} role="dialog" aria-modal="true" aria-labelledby={id} tabIndex={-1}
      onKeyDown={e => { if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); onClose(); } else trapFocus(e); }}>
      <header><h2 id={id}>お知らせ</h2><button type="button" className="icon-button" aria-label="お知らせ一覧を閉じる" onClick={onClose}><X size={22} aria-hidden="true" /></button></header>
      <div className="announcements-body">{!items.length && <p>お知らせはありません</p>}
        {items.map(item => <article key={item.id}>
          <div className="announcement-meta"><time dateTime={item.publishedAt}>{dateFormat.format(new Date(item.publishedAt))}</time><span>{kindLabels[item.kind]}</span>{newIds.has(item.id) && <strong>新着</strong>}</div>
          <h3>{item.title}</h3><AnnouncementBody body={item.body} />
          {item.links.filter(link => safeLink(link.url, allowedOrigins)).map((link, i) => <p key={i}><a href={link.url} target="_blank" rel="noopener noreferrer" onClick={e => { if (!safeLink(link.url, allowedOrigins)) e.preventDefault(); }}>{link.label}</a></p>)}
        </article>)}
      </div>
    </section>
  </div>, document.body);
}
