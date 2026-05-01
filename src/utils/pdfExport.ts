type JpegPage = {
  dataUrl: string;
  height: number;
  width: number;
};

const A4_LANDSCAPE_WIDTH_PT = 841.89;
const A4_LANDSCAPE_HEIGHT_PT = 595.28;
const PDF_MARGIN_PT = 20;

const getImageSize = (dataUrl: string): Promise<{ width: number; height: number }> =>
  new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () =>
      resolve({
        height: image.naturalHeight || image.height,
        width: image.naturalWidth || image.width,
      });
    image.onerror = () => reject(new Error("PDF用画像の読み込みに失敗しました。"));
    image.src = dataUrl;
  });

const textEncoder = new TextEncoder();

const dataUrlToBytes = (dataUrl: string): Uint8Array => {
  const [, base64 = ""] = dataUrl.split(",");
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
};

const escapePdfText = (value: string): string =>
  value.replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");

const makePdf = (pages: JpegPage[], title = "隊列メーカー 印刷用"): Blob => {
  const chunks: Uint8Array[] = [];
  const offsets: number[] = [];
  let byteLength = 0;

  const writeString = (chunk: string) => {
    const bytes = textEncoder.encode(chunk);
    chunks.push(bytes);
    byteLength += bytes.byteLength;
  };

  const writeBytes = (bytes: Uint8Array) => {
    chunks.push(bytes);
    byteLength += bytes.byteLength;
  };

  const objectCount = 3 + pages.length * 3;
  const addObject = (objectNumber: number, body: string) => {
    offsets[objectNumber] = byteLength;
    writeString(`${objectNumber} 0 obj\n${body}\nendobj\n`);
  };

  writeString("%PDF-1.4\n%âãÏÓ\n");
  addObject(1, "<< /Type /Catalog /Pages 2 0 R >>");

  const pageObjectNumbers = pages.map((_, index) => 4 + index * 3);
  addObject(
    2,
    `<< /Type /Pages /Count ${pages.length} /Kids ${pageObjectNumbers
      .map((objectNumber) => `${objectNumber} 0 R`)
      .join(" ")} >>`,
  );
  addObject(
    3,
    `<< /Title (${escapePdfText(title)}) /Producer (隊列メーカー) >>`,
  );

  pages.forEach((page, index) => {
    const pageObjectNumber = 4 + index * 3;
    const imageObjectNumber = pageObjectNumber + 1;
    const contentObjectNumber = pageObjectNumber + 2;
    const maxWidth = A4_LANDSCAPE_WIDTH_PT - PDF_MARGIN_PT * 2;
    const maxHeight = A4_LANDSCAPE_HEIGHT_PT - PDF_MARGIN_PT * 2;
    const scale = Math.min(maxWidth / page.width, maxHeight / page.height);
    const drawWidth = page.width * scale;
    const drawHeight = page.height * scale;
    const drawX = (A4_LANDSCAPE_WIDTH_PT - drawWidth) / 2;
    const drawY = (A4_LANDSCAPE_HEIGHT_PT - drawHeight) / 2;
    const imageBytes = dataUrlToBytes(page.dataUrl);
    const content = `q\n${drawWidth.toFixed(3)} 0 0 ${drawHeight.toFixed(
      3,
    )} ${drawX.toFixed(3)} ${drawY.toFixed(3)} cm\n/Im${index + 1} Do\nQ`;

    addObject(
      pageObjectNumber,
      [
        "<< /Type /Page",
        "/Parent 2 0 R",
        `/MediaBox [0 0 ${A4_LANDSCAPE_WIDTH_PT} ${A4_LANDSCAPE_HEIGHT_PT}]`,
        `/Resources << /XObject << /Im${index + 1} ${imageObjectNumber} 0 R >> >>`,
        `/Contents ${contentObjectNumber} 0 R`,
        ">>",
      ].join(" "),
    );

    offsets[imageObjectNumber] = byteLength;
    writeString(
      [
        `${imageObjectNumber} 0 obj`,
        "<< /Type /XObject /Subtype /Image",
        `/Width ${page.width}`,
        `/Height ${page.height}`,
        "/ColorSpace /DeviceRGB",
        "/BitsPerComponent 8",
        "/Filter /DCTDecode",
        `/Length ${imageBytes.byteLength}`,
        ">>",
        "stream",
        "",
      ].join("\n"),
    );
    writeBytes(imageBytes);
    writeString("\nendstream\nendobj\n");

    addObject(
      contentObjectNumber,
      `<< /Length ${content.length} >>\nstream\n${content}\nendstream`,
    );
  });

  const xrefOffset = byteLength;
  writeString(`xref\n0 ${objectCount + 1}\n`);
  writeString("0000000000 65535 f \n");
  for (let index = 1; index <= objectCount; index += 1) {
    writeString(`${String(offsets[index] ?? 0).padStart(10, "0")} 00000 n \n`);
  }
  writeString(
    `trailer\n<< /Size ${objectCount + 1} /Root 1 0 R /Info 3 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`,
  );

  return new Blob(chunks as unknown as BlobPart[], { type: "application/pdf" });
};

export const jpegDataUrlsToPdfBlob = async (
  dataUrls: string[],
  title?: string,
): Promise<Blob> => {
  const pages = await Promise.all(
    dataUrls.map(async (dataUrl) => ({
      dataUrl,
      ...(await getImageSize(dataUrl)),
    })),
  );
  return makePdf(pages, title);
};
