export const sanitizeExportFileName = (value: string): string =>
  (value.trim() || "隊列メーカー").replace(/[\\/:*?"<>|]/g, "_").replace(/\s+/g, "_");

export const formatExportTimestamp = (date = new Date()): string => {
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}_${pad(date.getHours())}-${pad(date.getMinutes())}`;
};

export const withFileExtension = (fileName: string, extension: string): string => {
  const safeName = sanitizeExportFileName(fileName);
  return safeName.toLowerCase().endsWith(`.${extension}`) ? safeName : `${safeName}.${extension}`;
};
