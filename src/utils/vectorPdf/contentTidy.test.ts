import { describe, expect, it } from "vitest";
import { jsPDF } from "jspdf";
import { tidyContentLine, tidyPdfContent } from "./contentTidy";

describe("per-operator content precision", () => {
  it("keeps matrices precise and trims jsPDF artefacts", () => {
    expect(tidyContentLine("0.70711 0.70711 -0.70711 0.70711 164.8141 132.1237 cm")).toBe("0.70711 0.70711 -0.70711 0.70711 164.8141 132.1237 cm");
    expect(tidyContentLine("1. 0. 0. 1. 228.29312 52.45371 cm")).toBe("1 0 0 1 228.29312 52.45371 cm");
    expect(tidyContentLine("0.123456 0. 0. 0.123456 1.5 2.5 cm")).toBe("0.12346 0 0 0.12346 1.5 2.5 cm");
  });
  it("rounds path geometry to 0.001mm and text positions to 0.01mm", () => {
    expect(tidyContentLine("0. -11.43271 m")).toBe("0 -11.433 m");
    expect(tidyContentLine("6.31411 -11.43271 11.43271 -6.31411 11.43271 0. c")).toBe("6.314 -11.433 11.433 -6.314 11.433 0 c");
    expect(tidyContentLine("12.12345 0.0004 3.5 0.26458 re")).toBe("12.123 0 3.5 0.265 re");
    expect(tidyContentLine("1. 0. 0. -1. -2.76555 2.64583 Tm")).toBe("1 0 0 -1 -2.77 2.65 Tm");
    expect(tidyContentLine("[0.79375 0.79375] 0. d")).toBe("[0.79 0.79] 0 d");
  });
  it("keeps line widths and font sizes to 0.001 and drops single-line leading", () => {
    expect(tidyContentLine("0.26458 w")).toBe("0.265 w");
    expect(tidyContentLine("/F15 4.049999999999999 Tf")).toBe("/F15 4.05 Tf");
    expect(tidyContentLine("4.6575 TL")).toBeNull();
  });
  it("never rewrites text strings, colours, names or other operators", () => {
    for (const line of ["<001d001a0003> Tj", "(1.5 2.5) Tj", "0.059 0.09 0.165 rg", "0.15 0.39 0.92 RG", "/GS1 gs", "/I0 Do", "q", "Q", "h", "f", "W", "n", "BT", "ET"])
      expect(tidyContentLine(line)).toBe(line);
    expect(tidyContentLine("-0.0001 0. m")).toBe("0 0 m");
  });
  it("rewrites jsPDF page arrays in place, including multi-line entries", () => {
    const pages: unknown[] = [undefined, ["q", "BT\n/F1 3.6399999999999992 Tf\n4.186 TL\n1. 0. 0. -1. 1.23456 2.34567 Tm\n<0003> Tj\nET", "1.234567 0. m"]];
    const ref = pages[1];
    tidyPdfContent(pages);
    expect(pages[1]).toBe(ref);
    expect(pages[1]).toEqual(["q", "BT\n/F1 3.64 Tf\n1 0 0 -1 1.23 2.35 Tm\n<0003> Tj\nET", "1.235 0 m"]);
  });
  it("produces a valid jsPDF document after tidying", () => {
    const pdf = new jsPDF({ unit: "mm", format: "a4", compress: false, floatPrecision: 5 });
    pdf.circle(10.123456, 20.654321, 3.333333, "F"); pdf.setLineWidth(0.26458); pdf.line(1.11111, 2.22222, 3.33333, 4.44444);
    tidyPdfContent((pdf.internal as unknown as { pages: unknown[] }).pages);
    const raw = pdf.output();
    expect(raw).toMatch(/%%EOF\s*$/);
    expect(raw).not.toMatch(/\d\.\d{4,} [mlc]\n/);
    expect(raw).toContain(" w\n");
  });
});
