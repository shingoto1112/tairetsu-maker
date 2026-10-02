import type { Ref } from "react";
import type { Project } from "../types";
import type { ShareExportOptions } from "./ShareExportModal";
import { sortFrames } from "../utils/interpolation";
import { defaultPrintOptions, getEffectiveSize, getPrintMetrics, getFramePrintVerticalRange, paginateFrames, PrintStagePreview, PRINT_SCENE_TITLE_MM } from "./PrintStagePreview";
export { getPrintOrientation } from "./PrintStagePreview";

type PrintPreviewProps = {
  project: Project;
  scope?: "all" | "current";
  selectedFrameId?: string | null;
  options?: ShareExportOptions;
  rootRef?: Ref<HTMLDivElement>;
  variant?: "document" | "stage-only";
};

export const PrintPreview = ({
  project,
  scope = "all",
  selectedFrameId = null,
  options = defaultPrintOptions,
  rootRef,
  variant = "document",
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
    const verticalRange = getFramePrintVerticalRange(
      project,
      frame,
      getEffectiveSize(project, frame),
      metrics,
    );

    return (
      <div
        className={`${documentClassName} print-document--stage-only`}
        aria-hidden="true"
        ref={rootRef}
      >
        <PrintStagePreview
          commonWidthMeters={metrics.commonWidthMeters}
          frame={frame}
          gapAfter={false}
          metrics={metrics}
          project={project}
          verticalRange={verticalRange}
          options={resolvedOptions}
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
            const verticalRange = getFramePrintVerticalRange(
              project,
              frame,
              getEffectiveSize(project, frame),
              metrics,
            );
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

                <PrintStagePreview
                  commonWidthMeters={metrics.commonWidthMeters}
                  frame={frame}
                  gapAfter={gapAfter}
                  metrics={metrics}
                  project={project}
                  verticalRange={verticalRange}
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
