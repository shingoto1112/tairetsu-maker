import { useLayoutEffect, useMemo, useRef, useState } from "react";
import type { FormationFrame, Project } from "../types";
import { createDefaultObjectState, getSnapshotForFrame } from "../utils/interpolation";
import { FORMATION_BOTTOM, FORMATION_TOP, formationSize, formationVerticalRange } from "../utils/formationExportLayout";
import { formationRulerSide } from "../utils/formationRulers";
import { StaticStagePreview } from "./StaticStagePreview";
import "./rosterAssignmentPreview.css";

type Props = {
  project: Project;
  frame: FormationFrame;
  highlightedObjectId?: string;
};

/**
 * Read-only drawing of one scene for the roster assignment screen. Uses the
 * export drawing (no editing events) and resolves only the selected scene.
 */
export const RosterAssignmentStagePreview = ({ project, frame, highlightedObjectId }: Props) => {
  const boxRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  useLayoutEffect(() => {
    const box = boxRef.current;
    if (!box) return;
    const measure = () => setWidth(Math.floor(box.clientWidth));
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    observer.observe(box);
    return () => observer.disconnect();
  }, []);
  // Inherited positions/props must match the scene thumbnails, so resolve the snapshot.
  const resolved = useMemo<FormationFrame>(() => ({ ...frame, ...getSnapshotForFrame(project, frame.id) }), [project, frame]);
  const size = formationSize(project, resolved);
  const vertical = formationVerticalRange(project, resolved);
  // Stage: shrink to fit the height so the whole scene is visible. Parade routes are long, so keep full width and scroll.
  const parade = project.mode === "parade";
  const side = formationRulerSide(project);
  const maxDrawingHeight = Math.max(140, Math.min(240, Math.round((typeof window === "undefined" ? 900 : window.innerHeight) * 0.22)));
  const depthMeters = Math.max(0.5, vertical.bottom - vertical.top);
  const fitWidth = side * 2 + size.width * Math.max(40, maxDrawingHeight - FORMATION_TOP - FORMATION_BOTTOM) / depthMeters;
  const outputWidth = parade ? width : Math.min(width, Math.floor(fitWidth));
  const highlighted = highlightedObjectId ? project.stageObjects.find((object) => object.id === highlightedObjectId) : undefined;
  const highlightedHidden = !!highlighted &&
    ((resolved.objectStates[highlighted.id] ?? createDefaultObjectState(highlighted)).visible ?? highlighted.visible) === false;
  return <section className={`roster-stage-preview${parade ? " is-parade" : ""}`} aria-label={`${frame.label} の隊列（見るだけ）`}>
    <div className="roster-stage-preview__drawing" ref={boxRef}>
      {width > 80 && <div className="roster-stage-preview__fit" style={{ width: outputWidth }}>
        <StaticStagePreview project={project} frame={resolved} stageWidth={size.width} side={side}
          range={{ left: 0, right: size.width, top: vertical.top, bottom: vertical.bottom }}
          outputWidth={outputWidth} highlightedObjectId={highlightedObjectId} />
      </div>}
    </div>
    {highlightedHidden && <p className="roster-stage-preview__note">「{highlighted!.name}」はこのシーンでは非表示です。</p>}
  </section>;
};
