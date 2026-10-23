// @vitest-environment jsdom
import { useState } from "react";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import type { StageConfig } from "../types";
import { formationExportFixture } from "../utils/formationExportFixture";
import { createStageExportView } from "../utils/stageExportView";
import { ExportPerspectiveOptions } from "./ExportPerspectiveOptions";

afterEach(cleanup);
it.each(["bottom", "top", "left", "right", undefined] as const)("%s: cards match the export's zero side and switch by clicking the card", frontDirection => {
  const stage: StageConfig = { ...formationExportFixture().stage, frontDirection, audienceSide: "bottom" };
  const Cards = () => {
    const [value, setValue] = useState<"performer" | "audience">("performer");
    return <ExportPerspectiveOptions stage={stage} value={value} onChange={setValue} compact />;
  };
  const { container } = render(<Cards />);
  expect(screen.getByRole("group", { name: "書き出す向き" })).toBeTruthy();
  const cards = container.querySelectorAll<HTMLLabelElement>(".counting-card");
  expect(cards).toHaveLength(2);
  expect(container.querySelector(".horizontal-counting--compact")).toBeTruthy();
  for (const [index, perspective] of (["performer", "audience"] as const).entries()) {
    const card = cards[index];
    const actualZero = createStageExportView({ widthMeters: 9.3, depthMeters: 5.4 }, stage, perspective).verticalLabels.find(label => label.label === "0m")!;
    const top = actualZero.positionMeters === 0;
    expect(top).toBe(perspective === "performer");
    expect(within(card).getByText(`0m（客席側）が${top ? "上" : "下"}`)).toBeTruthy();
    const zero = within(card).getByText("0m");
    expect(zero.getAttribute("y")).toBe(top ? "14" : "86");
    expect(card.querySelectorAll("svg text")).toHaveLength(4);
    expect(card.querySelector("circle, .counting-diagram__member")).toBeNull();
    expect(within(card).getByRole("radio").getAttribute("aria-describedby")).toBe(card.querySelector("small")?.id);
  }
  expect((within(cards[0]).getByRole("radio") as HTMLInputElement).checked).toBe(true);
  fireEvent.click(cards[1]);
  expect((within(cards[1]).getByRole("radio") as HTMLInputElement).checked).toBe(true);
  expect(cards[1].classList.contains("is-selected")).toBe(true);
  expect(cards[1].querySelector(".counting-card__check")?.textContent).toBe("✓");
});
