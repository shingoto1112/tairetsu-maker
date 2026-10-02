import { PNG } from "pngjs";
import { jsPDF } from "jspdf";

// Synthetic opaque diagram, not an application fixture or a claim about its final size.
const width = 1480, height = 2000;
const png = new PNG({ width, height });
for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
  const i = (y * width + x) * 4;
  const line = x % 120 < 2 || y % 100 < 2;
  const label = y % 100 > 30 && y % 100 < 55 && x % 120 > 30 && x % 120 < 85 && (x + y) % 7 < 4;
  png.data[i] = label ? 40 : line ? 210 : 255;
  png.data[i + 1] = label ? 70 : line ? 220 : 255;
  png.data[i + 2] = label ? 70 : line ? 230 : 255;
  png.data[i + 3] = 255;
}
const dataUrl = `data:image/png;base64,${PNG.sync.write(png).toString("base64")}`;
const results = [];
for (const compression of ["FAST", "MEDIUM", "SLOW"]) {
  const times = []; let bytes = 0;
  for (let sample = 0; sample < 3; sample++) {
    const started = performance.now();
    const pdf = new jsPDF({ compress: true, format: "a4", unit: "pt", orientation: "portrait" });
    pdf.addImage(dataUrl, "PNG", 20, 20, 555.28, 750.38, undefined, compression);
    bytes = pdf.output("arraybuffer").byteLength; times.push(performance.now() - started);
  }
  results.push({ compression, bytes, medianMs: Math.round(times.sort((a, b) => a - b)[1]) });
}
console.log(JSON.stringify({ fixture: "synthetic opaque grid 1480x2000; not app fixture", results }, null, 2));
