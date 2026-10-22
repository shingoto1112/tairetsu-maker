import type { Project } from "../types";
import type { ShareExportOptions } from "../components/ShareExportModal";
import { getEffectiveSize, getFramePrintVerticalRange, getObjectState, getPrintMetrics } from "./printLayout";

/** A safety failure is terminal: rasterizing the whole document costs more, not less. */
export class UnsafeParadeA4Export extends Error {}
export const PARADE_A4_DRAWING_BUDGET = 100_000;
// Retained document models/PDF streams need a separate bound: 30 maximum-size
// scenes, >12x either acceptance workload, and room for 300 members x 500 scenes.
// This is a conservative workload policy, not a browser heap-size guarantee.
export const PARADE_A4_DOCUMENT_DRAWING_BUDGET = 3_000_000;
export const PARADE_A4_SCENE_CHARACTER_BUDGET = 100_000;
export const PARADE_A4_DOCUMENT_CHARACTER_BUDGET = 1_000_000;
const MAX_COORDINATE = 10_000_000;

/** Export-only checks; never clamp, migrate or write saved data. Values over 500m
 * remain supported when their cropped drawing workload is safe. */
export function validateParadeA4Export(project: Project, frameIds: string[], options: ShareExportOptions) {
  if (project.mode !== "parade") return;
  const fail = (reason: string): never => { throw new UnsafeParadeA4Export(`パレードを書き出せません。${reason}`); };
  let context = "パレード設定";
  const finite = (...values: number[]) => {
    if (values.some(v => !Number.isFinite(v) || Math.abs(v) >= MAX_COORDINATE))
      fail(`${context}の距離・座標・寸法に不正な値があります。有限かつ絶対値が${MAX_COORDINATE}未満の値に直してください。`);
  };
  const total = project.paradeSettings?.totalDistance ?? project.stage.depthMeters;
  const backward = project.paradeSettings?.backwardDistanceMeters ?? 0;
  const width = project.paradeSettings?.width ?? project.stage.widthMeters;
  const cell = project.paradeSettings?.cellSizeMeters ?? project.stage.gridSizeMeters ?? 1;
  finite(total, backward, width, cell, project.stage.memberDiameterMeters ?? .5, options.sceneGapRows ?? 5);
  if (total <= 0 || backward < 0 || width <= 0 || cell <= 0) fail("全長・幅・格子間隔は正の値、後方距離は0以上にしてください。");
  finite(total + backward);
  if (cell < .01) fail("パレード設定の格子間隔が細かすぎます。0.01m以上にしてください。");
  const ids = new Set(frameIds), frames = project.frames.filter(f => ids.has(f.id));
  if (frames.length > 500) fail("一度に書き出すシーンは500以下にしてください。");
  const metrics = getPrintMetrics(project, frames, options), m = metrics.mmPerMeter;
  let documentDrawings = 0, documentCharacters = 0, maxSceneDrawings = 0;
  const memberCharacters = project.members.reduce((n, member) => n + member.name.length, 0);
  const names = new Map(project.members.map(member => [member.id, member.name]));
  for (const [index, frame] of frames.entries()) {
    context = `対象シーン${index + 1}「${frame.label.slice(0, 80) || "無題"}」`;
    let drawings = 0, characters = frame.label.length + memberCharacters;
    const checkScene = (cause: string) => {
      if (drawings > PARADE_A4_DRAWING_BUDGET)
        fail(`${context}の${cause}が多すぎて、1シーンの描画量の安全上限（${PARADE_A4_DRAWING_BUDGET}）を超えています。該当シーンの${cause}を減らしてください。`);
    };
    for (const position of Object.values(frame.positions)) finite(position.x, position.y, position.x * m, position.y * m);
    for (const line of Object.values(frame.annotationLines ?? {})) {
      finite(line.x1, line.y1, line.x2, line.y2);
      if (line.dash === "dashed") drawings += Math.ceil(Math.hypot(line.x2 - line.x1, line.y2 - line.y1) * m / (14 * 25.4 / 96));
      checkScene("破線の注釈の長さ・本数");
    }
    const range = getFramePrintVerticalRange(project, frame, getEffectiveSize(project, frame), metrics);
    finite(range.topMeters, range.bottomMeters, range.depthMeters * m);
    // Upper bounds include both grid families, both rulers, names and assignments.
    drawings += 32 + 2 * (Math.ceil(width / Math.min(1, metrics.gridSizeMeters)) + 2)
      + 2 * (Math.ceil(range.depthMeters / Math.min(1, metrics.gridSizeMeters)) + 2)
      + (options.includeMeterRulers ? 2 * (Math.ceil(range.depthMeters) + 2) : 0);
    checkScene("格子・目盛り（幅・表示範囲・格子間隔）");
    drawings += project.members.length * 12 + Object.keys(frame.annotationLines ?? {}).length;
    checkScene("メンバー・注釈の数");
    for (const object of project.stageObjects) {
      const state = getObjectState(frame, object);
      finite(state.x, state.y, state.widthMeters, state.heightMeters, state.rotation, state.zIndex,
        state.widthMeters * m, state.heightMeters * m);
      if (state.widthMeters <= 0 || state.heightMeters <= 0) fail("道具の幅と高さは正の値にしてください。");
      drawings += 12 + Math.ceil(state.widthMeters * m / (16 * 25.4 / 96));
      checkScene("道具の数・幅（幕の縞）");
      characters += object.name.length;
    }
    const assignments = options.includeAssignments ? Object.values(frame.objectAssignments ?? {}) : [];
    drawings += assignments.reduce((n, members) => n + members.length * 12, 0);
    checkScene("道具割当の数");
    characters += assignments.reduce((n, members) => n + members.reduce((sum, id) => sum + (names.get(id)?.length ?? 0), 0), 0);
    if (characters > PARADE_A4_SCENE_CHARACTER_BUDGET)
      fail(`${context}のシーン名・メンバー名・道具名・割当の文字数が安全上限（${PARADE_A4_SCENE_CHARACTER_BUDGET}）を超えています。名前を短くするか割当を減らしてください。`);
    documentDrawings += drawings; documentCharacters += characters;
    maxSceneDrawings = Math.max(maxSceneDrawings, drawings);
    if (documentDrawings > PARADE_A4_DOCUMENT_DRAWING_BUDGET)
      fail(`${context}までの文書全体の描画量が安全上限（${PARADE_A4_DOCUMENT_DRAWING_BUDGET}）を超えています。対象シーンを分けて書き出してください。`);
    if (documentCharacters > PARADE_A4_DOCUMENT_CHARACTER_BUDGET)
      fail(`${context}までの文書全体の文字数が安全上限（${PARADE_A4_DOCUMENT_CHARACTER_BUDGET}）を超えています。対象シーンを分けるか名前を短くしてください。`);
  }
  return { documentDrawings, documentCharacters, maxSceneDrawings };
}
