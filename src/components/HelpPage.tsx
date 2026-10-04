import { Fragment, useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ChevronDown, X } from "lucide-react";
import { getAppFeatureFlags } from "../platform/runtime";
import { PUBLIC_LINKS } from "../config/publicLinks";
import { useModalFocus } from "../hooks/useModalFocus";
import { helpSections } from "./helpContent";
import "./helpPage.css";

// Only the draft's emphasis is interpreted. No HTML or remote Markdown parser.
function HelpText({ text }: { text: string }) {
  return <>{text.split(/(\*\*.*?\*\*|「サポート」)/g).map((part, index) =>
    part === "「サポート」" ? <a key={index} href={PUBLIC_LINKS.support} target="_blank" rel="noopener noreferrer">「サポート」</a> :
    part.startsWith("**") ? <strong key={index}>{part.slice(2, -2)}</strong> : <Fragment key={index}>{part}</Fragment>)}</>;
}

export default function HelpPage({ onClose }: { onClose: () => void }) {
  const ref = useRef<HTMLElement>(null);
  const overlay = useRef<HTMLDivElement>(null);
  const id = useId();
  const [expanded, setExpanded] = useState<Set<number>>(() => new Set());
  useEffect(() => {
    const siblings = Array.from(document.body.children).filter((element): element is HTMLElement =>
      element instanceof HTMLElement && element !== overlay.current);
    const prior = siblings.map(element => element.inert);
    siblings.forEach(element => { element.inert = true; });
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      siblings.forEach((element, index) => { element.inert = prior[index]; });
      document.body.style.overflow = overflow;
    };
  }, []);
  const trapFocus = useModalFocus(ref);
  const sections = helpSections.filter(section => !section.collaboration || getAppFeatureFlags().collaborationV2);
  return createPortal(<div className="help-page-backdrop" ref={overlay}>
    <section className="help-page" ref={ref} role="dialog" aria-modal="true" aria-labelledby={`${id}-title`} tabIndex={-1}
      onKeyDown={event => {
        if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); onClose(); }
        else trapFocus(event);
      }}>
      <header className="help-page-header">
        <div><h2 id={`${id}-title`}>使い方</h2><p>知っていると便利な機能</p></div>
        <button className="icon-button" type="button" aria-label="使い方を閉じる" onClick={onClose}><X size={22} /></button>
      </header>
      <div className="help-page-body">
        {sections.map((section, index) => <section className="help-page-section" key={section.title}>
          <h3><button type="button" id={`${id}-heading-${index}`} aria-expanded={expanded.has(index)} aria-controls={`${id}-section-${index}`}
            onClick={() => setExpanded(previous => { const next = new Set(previous); if (next.has(index)) next.delete(index); else next.add(index); return next; })}>
            <span>{section.title}</span><ChevronDown size={20} aria-hidden="true" />
          </button></h3>
          <div className="help-page-content" id={`${id}-section-${index}`} role="region" aria-labelledby={`${id}-heading-${index}`} hidden={!expanded.has(index)}>
            {section.location && <p className="help-page-location"><strong>場所:</strong> {section.location}</p>}
            {section.collaboration ? <p>準備中です。</p> : <ul>{section.items.map(item => <li key={item}><HelpText text={item} /></li>)}</ul>}
          </div>
        </section>)}
      </div>
    </section>
  </div>, document.body);
}
