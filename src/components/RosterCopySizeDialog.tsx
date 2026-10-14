import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { useModalFocus } from "../hooks/useModalFocus";
import { createEmptyFormationProject } from "../project/createEmptyFormationProject";
import { oversizedRosterObjects, type OversizedObjectPolicy } from "../project/rosterCopy";
import type { NewFormationInput } from "./FormationLibrary";

export function RosterCopySizeDialog({ input, busy, onBack, onChoose }: {
  input: NewFormationInput; busy: boolean; onBack: () => void; onChoose: (policy: OversizedObjectPolicy) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const overlay = useRef<HTMLDivElement>(null);
  const trapFocus = useModalFocus(ref);
  useEffect(() => {
    const siblings = Array.from(document.body.children).filter((node): node is HTMLElement =>
      node instanceof HTMLElement && node !== overlay.current);
    const prior = siblings.map(node => node.inert);
    siblings.forEach(node => { node.inert = true; });
    const overflow = document.body.style.overflow; document.body.style.overflow = "hidden";
    return () => { siblings.forEach((node, index) => { node.inert = prior[index]; }); document.body.style.overflow = overflow; };
  }, []);
  const destination = createEmptyFormationProject(input.title, input, null);
  const objects = oversizedRosterObjects(input.rosterCopy!.source, destination);
  const parade = input.formationMode === "parade";
  return createPortal(<div className="new-formation-backdrop" ref={overlay}>
    <div className="new-formation-dialog roster-copy-size-dialog" ref={ref} role="dialog" aria-modal="true"
      aria-labelledby="roster-copy-size-title" tabIndex={-1} onKeyDown={event => {
        if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); if (!busy) onBack(); }
        else trapFocus(event);
      }}>
      <header><h2 id="roster-copy-size-title">ステージに入らない道具があります</h2></header>
      <p>{parade ? "パレード" : "ステージ"}の寸法：幅{destination.stage.widthMeters}m・{parade ? "全長" : "奥行き"}{destination.stage.depthMeters}m</p>
      <ul className="roster-copy-overflow-list">{objects.map(object => <li key={object.id}>
        {object.name}：幅{object.widthMeters}m・奥行き{object.heightMeters}m
      </li>)}</ul>
      <p>縮める場合は、はみ出す方向だけ寸法を合わせます。最初のシーンでは道具は非表示です。</p>
      <footer>
        <button className="mini-button primary" type="button" disabled={busy} onClick={() => onChoose("shrink")}>ステージに入る大きさに縮めてコピー</button>
        <button className="mini-button" type="button" disabled={busy} onClick={() => onChoose("exclude")}>入らない道具はコピーしない</button>
        <button className="mini-button" type="button" disabled={busy} onClick={onBack}>戻ってステージの大きさを変える</button>
      </footer>
    </div>
  </div>, document.body);
}
