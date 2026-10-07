import { expect, it } from "vitest";
import { boundedTicks, paradeMeterTicks, MAX_RENDER_TICKS } from "./boundedTicks";
import { verticalEmphasizedLines } from "./gridEmphasis";
import { createSampleProject } from "../sampleProject";

it("preserves ordinary meter ticks and endpoints", () => {
  expect(paradeMeterTicks(-.5, 3.5)).toEqual([-.5, 0, 1, 2, 3, 3.5]);
  expect(boundedTicks(0, 2, .5)).toEqual([0, .5, 1, 1.5, 2]);
});
it("bounds huge ranges, tiny steps and unrepresentable indices without value-increment loops", () => {
  for (const end of [500, 1e9, 1e20, Number.MAX_VALUE]) {
    expect(paradeMeterTicks(-end, end).length).toBeLessThanOrEqual(MAX_RENDER_TICKS);
    expect(boundedTicks(0, end, .000001).length).toBeLessThanOrEqual(MAX_RENDER_TICKS);
  }
  expect(boundedTicks(0, Infinity)).toEqual([]);
});
it("bounds full-range export lines and cropped export ranges at distant coordinates", () => {
  const stage = createSampleProject().stage;
  const parade = { totalDistance: 1e12, backwardDistanceMeters: 1e12 } as Parameters<typeof verticalEmphasizedLines>[3];
  expect(verticalEmphasizedLines(2e12, .01, stage, parade).length).toBeLessThanOrEqual(MAX_RENDER_TICKS * 2);
  const lines = verticalEmphasizedLines(2e12, .5, stage, parade, true, 1e12 - 10, 1e12 + 10);
  expect(lines.length).toBeLessThanOrEqual(41);
  expect(lines.every(line => line.positionMeters >= 1e12 - 10 && line.positionMeters <= 1e12 + 10)).toBe(true);
});

it.each([.1, .25, .3])("keeps every valid tick over 500 + 500m at step %s", step => {
  const expected = Array.from({ length: Math.floor(500 / step) * 2 + 1 }, (_, i) =>
    Number(((-Math.floor(500 / step) + i) * step).toFixed(9)));
  expect(boundedTicks(-500, 500, step)).toEqual(expected);
  const stage = createSampleProject().stage;
  const parade = { totalDistance: 500, backwardDistanceMeters: 500 } as Parameters<typeof verticalEmphasizedLines>[3];
  const grid = new Set(verticalEmphasizedLines(1000, step, stage, parade).map(line => line.positionMeters));
  for (const meter of expected) {
    const y = Number((500 + meter).toFixed(9));
    if (y > 0 && y < 1000) expect(grid.has(y)).toBe(true);
  }
});
it("keeps HEAD's stage defense instead of sampling stage or horizontal series", () => {
  const stage = createSampleProject().stage;
  expect(verticalEmphasizedLines(100001, .5, stage)).toEqual([]);
  expect(verticalEmphasizedLines(1000, .01, stage).length).toBeGreaterThan(MAX_RENDER_TICKS);
});
