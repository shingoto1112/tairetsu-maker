export const blobToBase64 = (blob: Blob): Promise<string> =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error ?? new Error("ファイルを変換できませんでした。"));
    reader.onload = () => {
      if (typeof reader.result !== "string") {
        reject(new Error("ファイルを変換できませんでした。"));
        return;
      }
      const commaIndex = reader.result.indexOf(",");
      resolve(commaIndex >= 0 ? reader.result.slice(commaIndex + 1) : reader.result);
    };
    reader.readAsDataURL(blob);
  });

export const base64ToBlob = (data: string, type = "application/octet-stream"): Blob => {
  const binary = window.atob(data);
  const chunkSize = 32_768;
  const chunks: Uint8Array[] = [];
  for (let offset = 0; offset < binary.length; offset += chunkSize) {
    const source = binary.slice(offset, offset + chunkSize);
    const bytes = new Uint8Array(source.length);
    for (let index = 0; index < source.length; index += 1) {
      bytes[index] = source.charCodeAt(index);
    }
    chunks.push(bytes);
  }
  return new Blob(chunks, { type });
};
