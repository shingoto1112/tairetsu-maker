import { expect, it } from "vitest";
import { nextSceneLabel } from "./nextSceneLabel";

it.each([
  [[], "シーン1"],
  [["シーン1", "シーン3"], "シーン4"],
  [["シーン1", "シーン5"], "シーン3"],
  [["Scene 1", "Scene 3", "シーン 4"], "シーン5"],
  [["シーン4", "シーン4", "Scene4"], "シーン5"],
  [["Scene  3", "シーン 4"], "シーン5"],
  [["オープニング", "Scene 1"], "シーン3"],
])("assigns a free number after the scene count: %j", (labels, expected) => {
  const frames = labels.map(label => ({ label }));
  const before = structuredClone(frames);
  expect(nextSceneLabel(frames)).toBe(expected);
  expect(frames).toEqual(before);
});
