import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";
import { getPrintOrientation, PrintPreview } from "../../src/components/PrintPreview";
import { defaultPrintOptions } from "../../src/components/PrintStagePreview";
import { generateA4Images } from "../../src/utils/a4ImageExport";
import { elementToJpegDataUrl } from "../../src/utils/exportImage";
import { jpegDataUrlsToPdfBlob } from "../../src/utils/pdfExport";
import type { Project } from "../../src/types";
import type { ShareExportOptions } from "../../src/components/ShareExportModal";

/** Browser regression harness for the same A4 path used by App. */
export const generateA4Document = async (project: Project, format: "png" | "pdf", options: Partial<ShareExportOptions> = {}, scope: "all" | "current" = "all") => {
  const host = document.createElement("div"); document.body.append(host); const root = createRoot(host);
  try {
    flushSync(() => root.render(<PrintPreview project={project} scope={scope} selectedFrameId={project.frames[0]?.id} options={{ ...defaultPrintOptions, ...options }} />));
    const element = host.firstElementChild as HTMLElement; element.classList.add("is-exporting");
    await document.fonts.ready;
    const pages = [...element.querySelectorAll<HTMLElement>(".print-page")];
    const base = `${project.title}_隊列表_2026-10-07_12-00`;
    const assignmentPanels = element.querySelectorAll(".print-assignment-sheet").length;
    if (Boolean(assignmentPanels) !== Boolean(options.includeAssignments)) throw new Error("割当欄の有無が一致しません。");
    if (format === "png") return await generateA4Images(element, getPrintOrientation(project), base);
    const dataUrls = []; for (const page of pages) dataUrls.push(await elementToJpegDataUrl(page));
    const blob = await jpegDataUrlsToPdfBlob(dataUrls, base, getPrintOrientation(project));
    return { files: [new File([blob], `${base}.pdf`, { type: "application/pdf" })], pageCount: pages.length };
  } finally { root.unmount(); host.remove(); }
};
