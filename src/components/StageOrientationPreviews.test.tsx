// @vitest-environment jsdom
import { renderToStaticMarkup } from "react-dom/server";
import { cleanup, render } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import type { EphemeralSession, EphemeralTarget } from "../collaboration/ephemeralSession";
import { formationExportFixture } from "../utils/formationExportFixture";
import { SceneThumbnailPreview } from "./SceneThumbnailPreview";
import RemoteInteractionLayer from "./RemoteInteractionLayer";

afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

it.each([
  ["stage", "top", "performer", false, 1.75, .75, 2, 1],
  ["stage", "top", "audience", true, 7.75, 4.75, 6, 4],
  ["stage", "bottom", "performer", true, 7.75, 4.75, 6, 4],
  ["stage", "bottom", "audience", false, 1.75, .75, 2, 1],
  ["parade", "top", "performer", false, 1.75, .75, 2, 1],
  ["parade", "bottom", "audience", false, 1.75, .75, 2, 1],
] as const)("%s/%s/%s: thumbnail, remote selections and drags use the same orientation", (mode, frontDirection, perspective, rotated, mx, my, ox, oy) => {
  const p = formationExportFixture(), frame = p.frames[0];
  p.mode = mode; p.stage = { ...p.stage, widthMeters: 10, depthMeters: 6, memberDiameterMeters: .5, frontDirection };
  p.paradeSettings = { width: 10, totalDistance: 6, cellSizeMeters: .5, direction: "up", rulerPosition: "both", emphasizeEvery5m: true, emphasizeEvery10m: true };
  frame.positions.m0 = { x: 2, y: 1 };
  frame.objectStates.flag = { objectId: "flag", x: 2, y: 1, widthMeters: 2, heightMeters: 1, rotation: 37, visible: true, zIndex: 1 };
  const before = structuredClone(p);
  const html = renderToStaticMarkup(<SceneThumbnailPreview project={p} frame={frame} visible viewerPerspective={perspective} />);
  const thumbnail = new DOMParser().parseFromString(html, "text/html");
  expect(thumbnail.querySelector("svg > g")?.getAttribute("transform")).toBe(rotated ? "rotate(180 5 3)" : null);
  const callbacks: FrameRequestCallback[] = [];
  vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => { callbacks.push(cb); return callbacks.length; });
  vi.stubGlobal("cancelAnimationFrame", vi.fn());
  vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({ x: 0, y: 0, left: 0, top: 0, right: 1000, bottom: 600, width: 1000, height: 600, toJSON: () => ({}) });
  const session = {
    subscribeDrags: () => () => {}, subscribe: () => () => {}, renderIntervalMs: 0, renderSample: vi.fn(),
    getSnapshot: () => ({ participants: [{ actorId: "peer", sessionId: "tab", sceneId: frame.id, color: "#123456", displayName: "相手", selected: [["member", "m0"], ["object", "flag"]] }] }),
    drags: new Map([["peer", { actorId: "peer", sessionId: "tab", start: { sceneId: frame.id, mode, dx: .5, dy: .25, targets: [["member", "m0", 2, 1], ["object", "flag", 2, 1]] } }]]),
    position: (_: string, t: EphemeralTarget, dx: number, dy: number) => ({ x: t[2] + dx, y: t[3] + dy }),
  } as unknown as EphemeralSession;
  const { container } = render(<div><RemoteInteractionLayer project={p} session={session} sceneId={frame.id} perspective={perspective} /></div>);
  callbacks.shift()!(performance.now());
  const check = (id: string, dragging: boolean, x: number, y: number) => {
    const ring = container.querySelector<HTMLElement>(`[data-remote-target="${id}"]${dragging ? ".is-dragging" : ":not(.is-dragging)"}`)!;
    expect(parseFloat(ring.style.left)).toBeCloseTo(x * 10);
    expect(parseFloat(ring.style.top)).toBeCloseTo(y / 6 * 100);
    if (id === "flag") expect(ring.style.transform).toBe("rotate(37deg)");
  };
  check("m0", false, mx, my); check("flag", false, ox, oy);
  check("m0", true, rotated ? 7.25 : 2.25, rotated ? 4.5 : 1);
  check("flag", true, rotated ? 5.5 : 2.5, rotated ? 3.75 : 1.25);
  expect(p).toEqual(before);
});
