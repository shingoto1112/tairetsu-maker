// Portable closed contract shared by storage and Edge.
export const MAX_SCENE_LINES = 100;
export const MAX_PROJECT_LINES = 5000;
export const MAX_LINE_COORDINATE = 100000; // Independent of current stage size.
const plain = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && Object.getPrototypeOf(v) === Object.prototype;
export const validLineId = (v: string): boolean => {
  if (!v || new TextEncoder().encode(v).length > 255 || /[\\/:\u0000-\u001f\u007f-\u009f]/.test(v) || v.includes("..") || ["__proto__", "constructor", "prototype"].includes(v)) return false;
  for (let i = 0; i < v.length; i++) {
    const code = v.charCodeAt(i);
    if (code >= 0xd800 && code <= 0xdbff) { const next = v.charCodeAt(++i); if (!(next >= 0xdc00 && next <= 0xdfff)) return false; }
    else if (code >= 0xdc00 && code <= 0xdfff) return false;
  }
  return true;
};
export const validAnnotationLine = (v: unknown): boolean => plain(v) &&
  Object.keys(v).sort().join() === "color,dash,x1,x2,y1,y2" &&
  ["x1", "y1", "x2", "y2"].every(k => typeof v[k] === "number" && Number.isFinite(v[k]) && Math.abs(v[k] as number) <= MAX_LINE_COORDINATE) &&
  ["black", "red", "blue", "green"].includes(v.color as string) && ["solid", "dashed"].includes(v.dash as string) &&
  (v.x1 !== v.x2 || v.y1 !== v.y2);
export const validAnnotationLines = (v: unknown): boolean => v === undefined || plain(v) &&
  Object.keys(v).length <= MAX_SCENE_LINES && Object.entries(v).every(([id, line]) => validLineId(id) && validAnnotationLine(line));
export const validProjectLineCount = (frames: unknown): boolean => !Array.isArray(frames) ||
  frames.reduce((n, frame) => n + (plain(frame) && plain(frame.annotationLines) ? Object.keys(frame.annotationLines).length : 0), 0) <= MAX_PROJECT_LINES;
