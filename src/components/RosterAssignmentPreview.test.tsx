/* @vitest-environment jsdom */

import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { formationExportFixture } from "../utils/formationExportFixture";
import { RosterAssignmentSceneStrip } from "./RosterAssignmentSceneStrip";
import { RosterAssignmentStagePreview } from "./RosterAssignmentStagePreview";
import { StaticStagePreview } from "./StaticStagePreview";

afterEach(cleanup);

describe("roster assignment scene strip and preview", () => {
  it("lists every scene in time order and switches scenes without editing", async () => {
    const project = formationExportFixture();
    const onSelectFrame = vi.fn();
    const sorted = [...project.frames].sort((a, b) => a.timeSec - b.timeSec);
    render(<RosterAssignmentSceneStrip project={project} frames={project.frames} selectedFrameId={sorted[0].id} onSelectFrame={onSelectFrame} />);
    const cards = screen.getAllByRole("button");
    expect(cards).toHaveLength(project.frames.length);
    expect(cards[0].getAttribute("aria-pressed")).toBe("true");
    await userEvent.click(cards[1]);
    expect(onSelectFrame).toHaveBeenCalledWith(sorted[1].id);
  });

  it("draws the selected scene read-only and outlines the selected prop", () => {
    const project = formationExportFixture();
    const object = project.stageObjects[0];
    const { container } = render(<RosterAssignmentStagePreview project={project} frame={project.frames[0]} highlightedObjectId={object.id} />);
    expect(screen.getByRole("region", { name: /隊列（見るだけ）/ })).toBeTruthy();
    // jsdom has no layout width, so only the wrapper renders; the highlight is covered by the static drawing test below.
    expect(container.querySelector(".roster-stage-preview__drawing")).toBeTruthy();
  });

  it("explains when the selected prop is hidden in this scene", () => {
    const project = formationExportFixture();
    const object = project.stageObjects[0];
    const frame = { ...project.frames[0], objectStates: { ...project.frames[0].objectStates,
      [object.id]: { ...(project.frames[0].objectStates[object.id] ?? { objectId: object.id, x: 1, y: 1, widthMeters: 1, heightMeters: 1, rotation: 0, zIndex: 1 }), visible: false } } };
    const hiddenProject = { ...project, frames: [frame, ...project.frames.slice(1)] };
    render(<RosterAssignmentStagePreview project={hiddenProject} frame={frame} highlightedObjectId={object.id} />);
    expect(screen.getByText(`「${object.name}」はこのシーンでは非表示です。`)).toBeTruthy();
  });
  it("outlines only the highlighted prop in the static drawing and leaves exports unmarked", () => {
    const project = formationExportFixture();
    const object = project.stageObjects[0];
    const range = { left: 0, right: project.stage.widthMeters, top: 0, bottom: project.stage.depthMeters };
    const { container, rerender } = render(<StaticStagePreview project={project} frame={project.frames[0]} stageWidth={project.stage.widthMeters}
      range={range} outputWidth={800} highlightedObjectId={object.id} />);
    expect(container.querySelectorAll(".print-object.is-highlighted")).toHaveLength(1);
    rerender(<StaticStagePreview project={project} frame={project.frames[0]} stageWidth={project.stage.widthMeters} range={range} outputWidth={800} />);
    expect(container.querySelectorAll(".print-object.is-highlighted")).toHaveLength(0);
  });
});
