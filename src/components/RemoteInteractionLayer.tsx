import { useEffect, useRef, useSyncExternalStore } from 'react';
import type { EphemeralSession, EphemeralTarget } from '../collaboration/ephemeralSession';
import type { Project, ViewerPerspective } from '../types';
import { getSafeParadeCanvasDistance } from '../utils/parade';
import './remoteInteraction.css';

export function PresenceIcons({ session }: { session: EphemeralSession }) {
  const state = useSyncExternalStore(session.subscribe, session.getSnapshot);
  // Several tabs by one person are one participant icon; drag previews remain independent.
  const participants = [...new Map(state.participants.map(p => [p.actorId, p])).values()];
  if (!participants.length) return null;
  return <span className="remote-participants" data-ephemeral="presence" aria-label={`${participants.length}人が参加中`} title={state.mode === 'B' ? state.reason : '参加中'}>
    {participants.slice(0, 3).map(p => <span key={p.actorId} className="remote-avatar" style={{ borderColor: safeColor(p.color) }} title={p.displayName} aria-label={p.displayName}>{Array.from(p.displayName)[0] ?? '人'}</span>)}
    {participants.length > 3 && <span className="remote-avatar" title={participants.map(p => p.displayName).join('、')}>+{participants.length - 3}</span>}
  </span>;
}
export function ScenePresence({ session, sceneId }: { session: EphemeralSession; sceneId: string }) {
  const state = useSyncExternalStore(session.subscribe, session.getSnapshot);
  const viewers = [...new Map(state.participants.filter(p => p.sceneId === sceneId).map(p => [p.actorId, p])).values()];
  return viewers.length ? <span className="remote-scene-presence" data-ephemeral="scene" title={`${viewers.map(p => p.displayName).join('、')}が見ています`} aria-label={`${viewers.length}人が見ています`}>● {viewers.length}</span> : null;
}
const safeColor = (color: string) => /^#[0-9a-f]{6}$/i.test(color) ? color : '#7c3aed';

/** Only this subtree receives moves. DOM borders never replace geometry or hit tests.
 * No bitmap/SVG sized to a parade's full length; only visible target DOM is allocated. */
export default function RemoteInteractionLayer({ session, project, sceneId, perspective = 'audience' }: {
  session: EphemeralSession; project: Project; sceneId: string | null; perspective?: ViewerPerspective;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const root = ref.current, surface = root?.parentElement; if (!root || !surface || !sceneId) return;
    let raf = 0, timer: ReturnType<typeof setTimeout> | undefined, lastFrame = 0, disposed = false;
    const draw = () => {
      raf = 0; if (disposed) return;
      const started = performance.now(), rect = surface.getBoundingClientRect();
      if (!rect.width || !rect.height) return;
      const frame = project.frames.find(f => f.id === sceneId); if (!frame) { root.replaceChildren(); return; }
      const global = project.useGlobalStageSize ?? project.useGlobalStageWidth ?? true, parade = project.mode === 'parade';
      const width = parade ? project.paradeSettings?.width ?? 10 : global ? project.stage.widthMeters : frame.stageWidthMeters ?? project.stage.widthMeters;
      const height = parade ? getSafeParadeCanvasDistance(project.paradeSettings?.totalDistance, project.paradeSettings?.backwardDistanceMeters) : global ? project.stage.depthMeters : frame.stageDepthMeters ?? project.stage.depthMeters;
      const viewport = surface.closest('.parade-viewport, .stage-fit-area')?.getBoundingClientRect();
      const fragment = document.createDocumentFragment();
      const append = (target: EphemeralTarget, dx: number, dy: number, color: string, label: string, dragging: boolean, lane: number) => {
        if (!dragging && (target[0] === 'object'
          ? !project.stageObjects.some(o => o.id === target[1]) || !frame.objectStates[target[1]]?.visible
          : !project.members.some(m => m.id === target[1]) || !frame.positions[target[1]] || frame.memberVisibility?.[target[1]] === false)) return;
        const position = dragging ? session.position(sceneId, target, dx, dy, project) : { x: target[2], y: target[3] }; if (!position) return;
        const object = target[0] === 'object', state = object ? frame.objectStates[target[1]] : undefined;
        const w = state?.widthMeters ?? project.stage.memberDiameterMeters ?? project.stage.memberCircleDiameterM ?? .6;
        const h = state?.heightMeters ?? w;
        let x = position.x, y = position.y;
        if (!object) { x -= w / 2; y -= h / 2; }
        if (!parade && perspective === 'performer') { x = width - x - w; y = height - y - h; }
        const left = rect.left + x / width * rect.width, top = rect.top + y / height * rect.height;
        const pixelW = w / width * rect.width, pixelH = h / height * rect.height;
        // Include a rotation-sized margin for objects near a viewport edge.
        const margin = object ? Math.max(pixelW, pixelH) : 8;
        if (viewport && (left + pixelW + margin < viewport.left || left - margin > viewport.right || top + pixelH + margin < viewport.top || top - margin > viewport.bottom)) return;
        const ring = document.createElement('span'); ring.className = `remote-target${dragging ? ' is-dragging' : ''}${object ? ' is-object' : ''}`;
        ring.dataset.remoteTarget = target[1]; ring.title = `${label}が${dragging ? '移動中' : '選択中'}`;
        Object.assign(ring.style, { left: `${x / width * 100}%`, top: `${y / height * 100}%`, width: `${w / width * 100}%`, height: `${h / height * 100}%`, borderColor: safeColor(color), outlineOffset: `${2 + lane * 3}px`, outlineColor: safeColor(color), transform: `rotate(${state?.rotation ?? 0}deg)` });
        fragment.append(ring);
      };
      const participants = session.getSnapshot().participants;
      participants.forEach((peer, lane) => {
        if (peer.sceneId !== sceneId) return;
        peer.selected.forEach(([kind, id]) => {
          const pos = kind === 'member' ? frame.positions[id] : frame.objectStates[id]; if (!pos) return;
          append([kind, id, pos.x, pos.y], 0, 0, peer.color, peer.displayName, false, lane % 5);
        });
      });
      let lane = 0;
      session.drags.forEach(drag => {
        if (drag.start.sceneId !== sceneId || drag.start.mode !== (project.mode ?? 'stage')) return;
        const peer = participants.find(p => p.actorId === drag.actorId && p.sessionId === drag.sessionId); if (!peer) return;
        drag.start.targets.forEach(t => append(t, drag.start.dx, drag.start.dy, peer.color, peer.displayName, true, lane % 5)); lane++;
      });
      root.replaceChildren(fragment); lastFrame = performance.now(); session.renderSample(lastFrame - started);
    };
    const schedule = () => {
      if (disposed || raf || timer) return;
      const delay = session.renderIntervalMs - (performance.now() - lastFrame);
      if (delay > 0) timer = setTimeout(() => { timer = undefined; raf = requestAnimationFrame(draw); }, delay);
      else raf = requestAnimationFrame(draw);
    };
    const release = session.subscribeDrags(schedule), releasePresence = session.subscribe(schedule);
    const resize = new ResizeObserver(schedule); resize.observe(surface);
    window.addEventListener('scroll', schedule, true); window.addEventListener('resize', schedule); schedule();
    return () => { disposed = true; release(); releasePresence(); resize.disconnect(); cancelAnimationFrame(raf); clearTimeout(timer); window.removeEventListener('scroll', schedule, true); window.removeEventListener('resize', schedule); };
  }, [session, project, sceneId, perspective]);
  return <div ref={ref} className="remote-interaction-layer" data-ephemeral="interaction" aria-hidden="true" />;
}
