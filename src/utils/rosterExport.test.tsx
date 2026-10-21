/* @vitest-environment jsdom */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { elementToPngBlob } from "./exportImage";
import { elementToPngPage } from "./exportRaster";

import { generateRosterExport } from "./rosterExport";
import { createRosterExportSnapshot } from "./rosterExportLayout";

vi.mock("./exportImage", () => ({ elementToPngBlob: vi.fn() }));
vi.mock("./exportRaster", () => ({ elementToPngPage: vi.fn(), waitForExportFonts: vi.fn().mockResolvedValue(undefined) }));

const data = (count = 1) => createRosterExportSnapshot("演目", "members",
  Array.from({ length: count }, (_, index) => ({ id: `${index}`, name: `名前${index + 1}` })), [],
  new Date("2026-10-01T00:00:00Z"),
);
const hosts = () => document.querySelectorAll("[data-roster-export-host]");

describe("rosterExport DOM lifecycle", () => {
  beforeEach(() => {
    vi.mocked(elementToPngBlob).mockResolvedValue(new Blob(["png"], { type: "image/png" }));
    vi.mocked(elementToPngPage).mockResolvedValue({ dataUrl: "data:image/png;base64,mock", width: 1480, height: 2000, format: "PNG" });
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
      const height = this.hasAttribute("data-roster-export-heading") ? 80
        : this.hasAttribute("data-roster-export-columns") ? 36
          : this.hasAttribute("data-roster-export-row") ? 32 : 0;
      return { height, width: 740, x: 0, y: 0, top: 0, left: 0, right: 740, bottom: height, toJSON: () => ({}) };
    });
    vi.spyOn(HTMLElement.prototype, "scrollWidth", "get").mockImplementation(function (this: HTMLElement) {
      return Number.parseFloat(this.style.width) || 740;
    });
    vi.spyOn(HTMLElement.prototype, "scrollHeight", "get").mockImplementation(function (this: HTMLElement) {
      return Number.parseFloat(this.style.height) || 200 + this.querySelectorAll("[data-roster-export-row]").length * 32;
    });
  });
  afterEach(() => { vi.restoreAllMocks(); vi.clearAllMocks(); });

  it("captures a static white sheet with all names, totals and no editable controls/add rows", async () => {
    vi.mocked(elementToPngBlob).mockImplementation(async (element, options) => {
      expect(hosts()).toHaveLength(1);
      expect(element.style.background).toBe("rgb(255, 255, 255)");
      expect(element.textContent).toContain("メンバー名簿");
      expect(element.textContent).toContain("総数: 2人");
      expect(element.textContent).toContain("未所属（2人）");
      expect(element.textContent).toContain("名前2");
      expect(element.querySelectorAll("input, button")).toHaveLength(0);
      expect(element.querySelectorAll("tbody tr")).toHaveLength(2);
      expect(options?.pixelRatio).toBe(2);
      return new Blob(["png"]);
    });
    const result = await generateRosterExport(data(2), "png");
    expect(result.reducedResolution).toBe(false);
    expect(hosts()).toHaveLength(0);
  });

  it("captures A4 PNG pages sequentially with repeated headings, page numbers and continuation No.", async () => {
    const pageTexts: string[] = [];
    const numbers: string[] = [];
    vi.mocked(elementToPngPage).mockImplementation(async (element) => {
      expect(hosts()).toHaveLength(1);
      expect(element.textContent).toContain("演目");
      expect(element.textContent).toContain("メンバー名簿");
      expect(element.textContent).toContain("未所属（40人）");
      numbers.push(element.querySelector("tbody th")?.textContent ?? "");
      pageTexts.push(element.querySelector("[data-roster-export-footer]")?.textContent ?? "");
      return { dataUrl: "data:image/png;base64,mock", width: 1480, height: 2000, format: "PNG" };
    });
    await generateRosterExport(data(40), "png", { signal: new AbortController().signal, onProgress: () => {}, paginatedImages: true });
    expect(pageTexts).toEqual(["1 / 2", "2 / 2"]);
    expect(numbers[0]).toBe("1");
    expect(Number(numbers[1])).toBeGreaterThan(1);
    expect(hosts()).toHaveLength(0);
  });

  it("exports an empty roster without artificial member rows", async () => {
    vi.mocked(elementToPngPage).mockImplementation(async (element) => {
      expect(element.querySelectorAll("tbody tr")).toHaveLength(0);
      expect(element.textContent).toContain("名簿は空です。");
      expect(element.textContent).toContain("1 / 1");
      return { dataUrl: "data:image/png;base64,mock", width: 1480, height: 2000, format: "PNG" };
    });
    await generateRosterExport(data(0), "png", { signal: new AbortController().signal, onProgress: () => {}, paginatedImages: true });
    expect(elementToPngPage).toHaveBeenCalledTimes(1);
    expect(hosts()).toHaveLength(0);
  });

  it.each(["png"] as const)("removes the temporary DOM after %s capture fails", async (kind) => {
    vi.mocked(elementToPngBlob).mockRejectedValue(new Error("capture failed"));
    vi.mocked(elementToPngPage).mockRejectedValue(new Error("capture failed"));
    const snapshot = data();
    const before = structuredClone(snapshot);
    await expect(generateRosterExport(snapshot, kind)).rejects.toThrow("capture failed");
    expect(hosts()).toHaveLength(0);
    expect(snapshot).toEqual(before);
  });

  it("refuses an oversized PNG before capture and removes the host", async () => {
    vi.spyOn(HTMLElement.prototype, "scrollHeight", "get").mockReturnValue(30_000);
    await expect(generateRosterExport(data(), "png")).rejects.toThrow("PDFで書き出してください");
    expect(elementToPngBlob).not.toHaveBeenCalled();
    expect(hosts()).toHaveLength(0);
  });


});
