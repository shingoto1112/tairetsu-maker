// @vitest-environment jsdom
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { createSampleProject } from "../sampleProject";
import { SceneThumbnailPreview } from "./SceneThumbnailPreview";

afterEach(cleanup);
describe("scene preview rendering", () => {
  it("keeps inherited positions fresh after an earlier scene is edited", () => {
    const project = createSampleProject();
    const id = project.members[0].id;
    project.frames[1] = { ...project.frames[1], positions: {} };
    const frame = project.frames[1];
    const view = render(<SceneThumbnailPreview project={project} frame={frame} visible />);
    const x = view.container.querySelector("circle")!.getAttribute("cx");
    const changed = { ...project, frames: project.frames.map((f,i) => i === 0 ? { ...f, positions: { ...f.positions, [id]: {x:7.25,y:3} } } : f) };
    view.rerender(<SceneThumbnailPreview project={changed} frame={frame} visible />);
    expect(view.container.querySelector("circle")!.getAttribute("cx")).toBe("7.25");
    expect(x).not.toBe("7.25");
  });
  it("shows current edits when an offscreen preview becomes visible", () => {
    const project = createSampleProject(), frame = project.frames[0], id = project.members[0].id;
    const view = render(<SceneThumbnailPreview project={project} frame={frame} visible={false} />);
    expect(view.container.querySelector("svg")).not.toBeNull();
    expect(view.container.querySelector("circle")).toBeNull();
    const changedFrame = { ...frame, memberAppearanceOverrides: { [id]: { color: "#123456" } } };
    const changed = { ...project, frames: [changedFrame,...project.frames.slice(1)] };
    view.rerender(<SceneThumbnailPreview project={changed} frame={changedFrame} visible />);
    expect(view.container.querySelector("circle")!.getAttribute("fill")).toBe("#123456");
    view.rerender(<SceneThumbnailPreview project={changed} frame={changedFrame} visible={false} />);
    expect(view.container.querySelector("circle")).toBeNull();
  });
  it("preserves stage dimensions, assignments and group colors", () => {
    const project = createSampleProject(), id = project.members[0].id;
    const object = project.stageObjects[0];
    const frame = { ...project.frames[0], stageWidthMeters:21, stageDepthMeters:9,
      objectAssignments:{[object.id]:[id]} };
    project.useGlobalStageSize = false;
    project.frames = [frame];
    project.memberGroups = [{id:"anonymous-group",name:"匿名組",memberIds:[project.members[1].id],color:"#abcdef"}];
    const view=render(<SceneThumbnailPreview project={project} frame={frame} visible />);
    expect(view.container.querySelector("svg")!.getAttribute("viewBox")).toBe("0 0 21 9");
    expect(view.container.querySelectorAll("circle")).toHaveLength(project.members.length-1);
    expect(view.container.querySelector("circle")!.getAttribute("fill")).toBe("#abcdef");
  });
});
