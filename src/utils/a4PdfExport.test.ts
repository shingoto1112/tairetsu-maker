// @vitest-environment jsdom
import { expect, it, vi } from "vitest";
import { generateA4Pdf } from "./a4PdfExport";
import { vectorParadeFixture } from "./vectorPdf/paradeFixture";
import { defaultPrintOptions } from "./printLayout";
import { UnsafeParadeA4Export } from "./paradeA4Limits";
import { createA4VectorPdf } from "./vectorPdf/a4Document";
import { elementToJpegDataUrl } from "./exportImage";

vi.mock("./vectorPdf/a4Document", () => ({ createA4VectorPdf: vi.fn() }));
vi.mock("./exportImage", async original => ({ ...await original<typeof import("./exportImage")>(), elementToJpegDataUrl: vi.fn() }));

it("rejects unsafe image-PDF input before inspecting the DOM or attempting vector/raster output", async () => {
  vi.clearAllMocks();
  const project = vectorParadeFixture({ total: 100000, long: true });
  const element = document.createElement("div"), query = vi.spyOn(element, "querySelectorAll");
  await expect(generateA4Pdf({ project, element, frameIds: project.frames.map(f => f.id), options: defaultPrintOptions, title: "過大" }))
    .rejects.toBeInstanceOf(UnsafeParadeA4Export);
  expect(query).not.toHaveBeenCalled(); expect(createA4VectorPdf).not.toHaveBeenCalled(); expect(elementToJpegDataUrl).not.toHaveBeenCalled();
});

it("checks the raster fallback itself before generating any SVG/image", async () => {
  vi.clearAllMocks();
  const project = vectorParadeFixture();
  const element = document.createElement("div"); element.innerHTML = '<section class="print-page"></section>';
  Object.defineProperties(element.firstElementChild!, { scrollWidth: { value: 800 }, scrollHeight: { value: 1000 } });
  vi.mocked(createA4VectorPdf).mockImplementationOnce(async request => {
    // An intervening change cannot let the fallback bypass the same safety policy.
    project.paradeSettings!.width = 1000000;
    return request.fallback();
  });
  await expect(generateA4Pdf({ project, element, frameIds: project.frames.map(f => f.id), options: defaultPrintOptions, title: "代替" }))
    .rejects.toBeInstanceOf(UnsafeParadeA4Export);
  expect(createA4VectorPdf).toHaveBeenCalledOnce(); expect(elementToJpegDataUrl).not.toHaveBeenCalled();
});
