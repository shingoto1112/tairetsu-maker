import { Fragment, useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ChevronDown, X } from "lucide-react";
import { getAppFeatureFlags } from "../platform/runtime";
import { PUBLIC_LINKS } from "../config/publicLinks";
import { useModalFocus } from "../hooks/useModalFocus";
import { helpCategories, helpTroubleshooting, type HelpSection } from "./helpContent";
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
  // Keyed by the stable section id, so filtering or rewording never moves the open state.
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
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
  const collaboration = getAppFeatureFlags().collaborationV2;
  const categories = helpCategories
    .map(category => ({ ...category, sections: category.sections.filter(section => !section.collaboration || collaboration) }))
    .filter(category => category.sections.length > 0);
  const toggle = (key: string) => setExpanded(previous => {
    const next = new Set(previous);
    if (next.has(key)) next.delete(key); else next.add(key);
    return next;
  });
  const renderSection = (section: HelpSection, Heading: "h3" | "h4") => {
    const open = expanded.has(section.id);
    return <section className="help-page-section" key={section.id}>
      <Heading className="help-page-section-heading"><button type="button" id={`${id}-heading-${section.id}`} aria-expanded={open}
        aria-controls={`${id}-section-${section.id}`} onClick={() => toggle(section.id)}>
        <span>{section.title}</span><ChevronDown size={20} aria-hidden="true" />
      </button></Heading>
      <div className="help-page-content" id={`${id}-section-${section.id}`} role="region" aria-labelledby={`${id}-heading-${section.id}`} hidden={!open}>
        {section.location && <p className="help-page-location"><strong>場所:</strong> {section.location}</p>}
        <ul>{section.items.map(item => <li key={item}><HelpText text={item} /></li>)}</ul>
      </div>
    </section>;
  };
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
        {categories.map(category => <div className="help-page-category" key={category.id}>
          <h3 className="help-page-category-title">{collaboration || !category.titleWithoutCollaboration ? category.title : category.titleWithoutCollaboration}</h3>
          {category.sections.map(section => renderSection(section, "h4"))}
        </div>)}
        <div className="help-page-category help-page-category--last">{renderSection(helpTroubleshooting, "h3")}</div>
      </div>
    </section>
  </div>, document.body);
}
