import { expect, it } from "vitest";
import { jsPDF } from "jspdf";
import { PDFDocument } from "pdf-lib";
import { packObjectStreams } from "./objectStreams";
import { renderScenePages } from "./renderer";
import type { ScenePage } from "./model";

const sample = () => {
  const pdf = new jsPDF({ unit: "mm", format: "a4", compress: true });
  for (let i = 0; i < 3; i++) { if (i) pdf.addPage(); pdf.circle(50, 50, 10, "F"); pdf.rect(10, 10, 30, 20); }
  return pdf.output("arraybuffer");
};

it("packs dictionaries into object streams and keeps the page count", async () => {
  const bytes = sample(), packed = await packObjectStreams(bytes, 3);
  expect(packed).not.toBeNull();
  expect(packed!.byteLength).toBeLessThan(bytes.byteLength);
  expect(Buffer.from(packed!).toString("latin1")).toContain("/ObjStm");
  expect((await PDFDocument.load(packed!)).getPageCount()).toBe(3);
});

it("keeps the checked original when the input is unusable or the page count disagrees", async () => {
  expect(await packObjectStreams(new TextEncoder().encode("not a pdf").buffer as ArrayBuffer, 1)).toBeNull();
  expect(await packObjectStreams(sample(), 2)).toBeNull();
});

it("never swallows cancellation", async () => {
  const controller = new AbortController(); controller.abort();
  await expect(packObjectStreams(sample(), 3, controller.signal)).rejects.toMatchObject({ name: "AbortError" });
});

it("is applied by renderScenePages only when requested", async () => {
  const page = (id: string): ScenePage => ({ frameId: id, width: 120, height: 80,
    drawings: [{ kind: "shape", x: 10, y: 10, width: 40, height: 20, fill: "#38bdf8", stroke: "#94a3b8", lineWidth: .26 }] });
  const plain = await renderScenePages([page("a"), page("b")]);
  const packed = await renderScenePages([page("a"), page("b")], { objectStreams: true });
  expect(plain.metrics.objectStreams).toBe(false);
  expect(packed.metrics.objectStreams).toBe(true);
  expect(packed.blob.size).toBeLessThan(plain.blob.size);
  expect(packed.metrics.unpackedBytes).toBe(plain.blob.size);
  expect((await PDFDocument.load(await packed.blob.arrayBuffer())).getPageCount()).toBe(2);
}, 15000);
