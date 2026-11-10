import type { Ref } from "react";
import type { Project } from "../types";
import type { ShareExportOptions } from "./ShareExportModal";
import { sortFrames } from "../utils/interpolation";
import { DocumentSceneDrawing } from "./SceneDrawing";
import { PRINT_SCENE_TITLE_MM, defaultPrintOptions, getPrintMetrics, paginateFrames } from "../utils/printLayout";
export {
  defaultPrintOptions, getEffectiveSize, getPrintMetrics, getPrintRulerTopMm,
  getPrintRulerBottomMm, getPrintMemberLabelFontSizeMm, isPrintMemberVisible, getPrintOrientation,
} from "../utils/printLayout";
export type { PrintOrientation } from "../utils/printLayout";

type PrintPreviewProps = {
  project: Project;
  scope?: "all" | "current";
  selectedFrameId?: string | null;
  options?: ShareExportOptions;
  rootRef?: Ref<HTMLDivElement>;
  variant?: "document" | "stage-only";
  /** Only the stage camera button passes this (about 10% blank margin for handwritten notes). */
  stageOnlyMarginRatio?: number;
};

export const PrintPreview = ({
  project,
  scope = "all",
  selectedFrameId = null,
  options = defaultPrintOptions,
  rootRef,
  variant = "document",
  stageOnlyMarginRatio,
}: PrintPreviewProps) => {
  const sortedFrames = sortFrames(project.frames);
  const frames =
    scope === "current" && selectedFrameId
      ? sortedFrames.filter((frame) => frame.id === selectedFrameId)
      : sortedFrames;
  const resolvedOptions = { ...defaultPrintOptions, ...options };
  const metrics = getPrintMetrics(project, frames, resolvedOptions);
  const pages = paginateFrames(project, frames, metrics, resolvedOptions);
  const documentClassName = `print-document print-document--${metrics.orientation}`;

  if (variant === "stage-only") {
    const frame = frames[0] ?? sortedFrames[0];
    if (!frame) {
      return (
        <div
          className={`${documentClassName} print-document--stage-only`}
          ref={rootRef}
        />
      );
    }

    return (
      <div
        className={`${documentClassName} print-document--stage-only`}
        aria-hidden="true"
        ref={rootRef}
      >
        <DocumentSceneDrawing
          frame={frame}
          gapAfter={false}
          metrics={metrics}
          project={project}
          options={resolvedOptions}
          outerMarginRatio={stageOnlyMarginRatio}
        />
      </div>
    );
  }

  return (
    <div className={documentClassName} aria-hidden="true" ref={rootRef}>
      {pages.map((pageFrames, pageIndex) => (
        <section className="print-page" key={`print-page-${pageIndex}`}>
          {pageFrames.map((frame, frameIndex) => {
            const sceneNumber =
              sortedFrames.findIndex((item) => item.id === frame.id) + 1;
            const gapAfter = frameIndex < pageFrames.length - 1;

            return (
              <section className="print-scene-block" key={frame.id}>
                <header
                  className="print-scene-title"
                  style={{ height: `${PRINT_SCENE_TITLE_MM}mm` }}
                >
                  <h2>
                    {resolvedOptions.includeSceneName
                      ? frame.label
                      : `シーン${sceneNumber}`}
                  </h2>
                </header>

                <DocumentSceneDrawing
                  frame={frame}
                  gapAfter={gapAfter}
                  metrics={metrics}
                  project={project}
                  options={resolvedOptions}
                />
              </section>
            );
          })}
        </section>
      ))}
    </div>
  );
};
