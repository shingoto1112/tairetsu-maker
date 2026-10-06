export const formatTime = (seconds: number): string => {
  const safe = Number.isFinite(seconds) ? Math.max(0, seconds) : 0;
  const minutes = Math.floor(safe / 60);
  const rest = Math.floor(safe % 60);
  return `${minutes}:${rest.toString().padStart(2, "0")}`;
};

/** m:ss.s for audio positions and scene boundaries (e.g. 210.845057 → "3:30.8"). */
export const formatTimeTenths = (seconds: number): string => {
  const safe = Number.isFinite(seconds) ? Math.max(0, seconds) : 0;
  const tenths = Math.round(safe * 10);
  const minutes = Math.floor(tenths / 600);
  const rest = (tenths % 600) / 10;
  return `${minutes}:${rest.toFixed(1).padStart(4, "0")}`;
};

/**
 * Reads "m:ss.s", "m:ss" or plain seconds ("75.5"); full-width digits, colon and
 * period are accepted. Returns null when the text is not a time.
 */
export const parseTimeInput = (text: string): number | null => {
  const normalized = text.trim()
    .replace(/[０-９]/g, (digit) => String.fromCharCode(digit.charCodeAt(0) - 0xfee0))
    .replace(/：/g, ":").replace(/．/g, ".");
  if (!normalized) return null;
  const parts = normalized.split(":");
  if (parts.length > 2 || parts.some((part) => !/^\d+(\.\d+)?$/.test(part))) return null;
  const seconds = Number(parts[parts.length - 1]);
  if (parts.length === 1) return seconds;
  const minutes = Number(parts[0]);
  if (!Number.isInteger(minutes) || seconds >= 60) return null;
  return minutes * 60 + seconds;
};
