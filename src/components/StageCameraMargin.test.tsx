// @vitest-environment jsdom
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { PrintPreview } from "./PrintPreview";
import { formationExportFixture } from "../utils/formationExportFixture";

afterEach(cleanup);

const mm = (value: string) => Number.parseFloat(value);

describe("stage camera image margin", () => {
  it("adds about 10% of the stage width around the stage, counting the rulers toward it", () => {
    const project = formationExportFixture();
    const { container } = render(<PrintPreview project={project} scope="current" selectedFrameId={project.frames[0].id}
      variant="stage-only" stageOnlyMarginRatio={0.1} />);
    const wrapper = container.querySelector<HTMLElement>(".print-stage-outer-margin");
    expect(wrapper).toBeTruthy();
    const stageWidthMm = mm(container.querySelector<HTMLElement>(".print-stage-preview")!.style.getPropertyValue("--print-stage-width-mm"));
    const rulerLeftMm = mm(container.querySelector<HTMLElement>(".print-stage-preview")!.style.getPropertyValue("--print-ruler-left-mm"));
    expect(stageWidthMm).toBeGreaterThan(0);
    // Left: ruler + extra padding reaches the 10% target exactly (no double counting).
    expect(mm(wrapper!.style.paddingLeft) + rulerLeftMm).toBeCloseTo(stageWidthMm * 0.1, 3);
    for (const side of ["paddingTop", "paddingRight", "paddingBottom", "paddingLeft"] as const)
      expect(mm(wrapper!.style[side])).toBeGreaterThanOrEqual(0);
  });

  it("leaves the A4 and other stage-only drawings unchanged when no margin is requested", () => {
    const project = formationExportFixture();
    const { container } = render(<PrintPreview project={project} scope="current" selectedFrameId={project.frames[0].id} variant="stage-only" />);
    expect(container.querySelector(".print-stage-outer-margin")).toBeNull();
    const document = render(<PrintPreview project={project} variant="document" stageOnlyMarginRatio={0.1} />);
    expect(document.container.querySelector(".print-stage-outer-margin")).toBeNull();
  });
});
