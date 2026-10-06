// @vitest-environment jsdom
import { act, cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createSampleProject } from "../sampleProject";
import { createProjectSummary } from "../project/codec";
import type { ProjectRecord } from "../repositories/types";
import { ProjectCardPreview, type ProjectCardPreviewSource } from "./ProjectCardPreview";

afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });
const setup = () => {
  const project = { ...createSampleProject(), id: "anonymous" };
  const record: ProjectRecord = { project, repositoryRevision: "1", localRevision: "1", sync: null };
  const summary = createProjectSummary(project, "1", null);
  const watched: { target?: Element; callback: IntersectionObserverCallback }[] = [];
  vi.stubGlobal("IntersectionObserver", class {
    private item: typeof watched[number];
    constructor(callback: IntersectionObserverCallback) { this.item = { callback }; watched.push(this.item); }
    observe(target: Element) { this.item.target = target; }
    disconnect() {}
  });
  const visible = (index = 0, isIntersecting = true) => watched[index].callback([
    { target: watched[index].target!, isIntersecting } as IntersectionObserverEntry,
  ], {} as IntersectionObserver);
  const source: ProjectCardPreviewSource = { concurrency: 2, get: vi.fn().mockResolvedValue(record) };
  return { project, record, summary, source, visible };
};
const settle = async () => { await Promise.resolve(); await Promise.resolve(); };

describe("project card SVG and placeholder", () => {
  it("uses a neutral hidden icon before reading and outside the viewport", async () => {
    const data = setup(), view = render(<ProjectCardPreview summary={data.summary} source={data.source} />);
    expect(view.container.querySelector(".project-card-preview__placeholder")).not.toBeNull();
    expect(data.source.get).not.toHaveBeenCalled();
    expect(view.container.firstElementChild!.getAttribute("aria-hidden")).toBe("true");
    await act(async () => { data.visible(); await settle(); });
    expect(view.container.querySelector("circle")).not.toBeNull();
    act(() => data.visible(0, false));
    expect(view.container.querySelector(".project-card-preview__placeholder")).not.toBeNull();
    expect(view.container.querySelector("circle")).toBeNull();
  });
  it("draws a single pattern anchored to the counting origin, props with rotation and no names", async () => {
    const data = setup(); data.project.stage.horizontalGuideMode = "centerSplit";
    data.project.frames[0].objectStates.o_chair.rotation = 45;
    data.project.stageObjects[1].shape = "circle";
    const view = render(<ProjectCardPreview summary={data.summary} source={data.source} />);
    await act(async () => { data.visible(); await settle(); });
    const svg = view.container.querySelector(".project-card-preview__drawing")!;
    expect(svg.getAttribute("viewBox")).toBe("0 0 12 6");
    expect(svg.getAttribute("preserveAspectRatio")).toBe("xMidYMid meet");
    expect(svg.getAttribute("width")).toBe("100%"); expect(svg.getAttribute("height")).toBe("100%");
    expect(svg.querySelectorAll("pattern")).toHaveLength(1);
    expect(svg.querySelector("pattern")!.getAttribute("patternUnits")).toBe("userSpaceOnUse");
    expect(svg.querySelector("pattern")!.getAttribute("patternTransform")).toBe("translate(6.5 0)");
    expect(svg.querySelector("pattern")!.getAttribute("width")).toBe("0.5");
    expect(svg.querySelectorAll("line")).toHaveLength(1);
    const chair = svg.querySelectorAll("[data-preview-object]")[1];
    expect(chair.getAttribute("transform")).toBe("rotate(45 6 5)");
    expect(chair.getAttribute("rx")).toBe("0.4"); expect(chair.getAttribute("fill")).toBe("#f59e0b");
    expect(svg.querySelectorAll("circle")).toHaveLength(3);
    expect(svg.querySelector("text")).toBeNull(); expect(svg.textContent).toBe("");
    expect(svg.querySelector("image, foreignObject, use")).toBeNull();
  });
  it("uses unique local pattern IDs and deduplicates reads for duplicate cards", async () => {
    const data = setup();
    const view = render(<><ProjectCardPreview summary={data.summary} source={data.source} />
      <ProjectCardPreview summary={data.summary} source={data.source} /></>);
    await act(async () => { data.visible(0); data.visible(1); await settle(); });
    const patterns = [...view.container.querySelectorAll("pattern")];
    expect(patterns).toHaveLength(2); expect(patterns[0].id).not.toBe(patterns[1].id);
    for (const pattern of patterns) expect(pattern.closest("svg")!.querySelector(`[fill="url(#${pattern.id})"]`)).not.toBeNull();
    expect(data.source.get).toHaveBeenCalledOnce();
  });
  it("keeps SVG primitive count small for more than 120 people", async () => {
    const data = setup(); data.project.stageObjects = [];
    data.project.members = Array.from({ length: 140 }, (_, i) => ({ id: `person${i}`, name: "Anonymous", color: "#14b8a6" }));
    data.project.frames[0].positions = Object.fromEntries(data.project.members.map((member, i) => [member.id, { x: i % 12, y: i % 6 }]));
    const view = render(<ProjectCardPreview summary={data.summary} source={data.source} />);
    await act(async () => { data.visible(); await settle(); });
    expect(view.container.querySelectorAll("circle")).toHaveLength(140);
    expect(view.container.querySelectorAll("path")).toHaveLength(1);
    expect(view.container.querySelectorAll("line")).toHaveLength(1);
    expect(view.container.querySelector("circle")!.getAttribute("r")).toBe("0.075");
  });
  it.each(["failure", "missing", "empty", "revision"])("falls back for %s", async kind => {
    const data = setup();
    if (kind === "failure") data.source.get = vi.fn().mockRejectedValue(new Error("private"));
    if (kind === "missing") data.source.get = vi.fn().mockResolvedValue(null);
    if (kind === "empty") data.project.frames = [];
    if (kind === "revision") data.record.repositoryRevision = "2";
    const view = render(<ProjectCardPreview summary={data.summary} source={data.source} />);
    await act(async () => { data.visible(); await settle(); });
    expect(view.container.querySelector(".project-card-preview__placeholder")).not.toBeNull();
    expect(view.container.querySelector("pattern")).toBeNull();
  });
  it("keeps the placeholder without viewport observation", () => {
    const data = setup(); vi.stubGlobal("IntersectionObserver", undefined);
    const view = render(<ProjectCardPreview summary={data.summary} source={data.source} />);
    expect(view.container.querySelector(".project-card-preview__placeholder")).not.toBeNull();
    expect(data.source.get).not.toHaveBeenCalled();
  });
});
