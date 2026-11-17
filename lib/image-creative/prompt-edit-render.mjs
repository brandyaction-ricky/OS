// The server normalizes the owned source first. Both renderers then forward these exact pixels.
export const promptEditRenderVersion = 1;

export function promptEditPng(variant, dataUrl, { width, height }) {
  const image = variant.promptEdit?.image;
  if (!image || image.w !== width || image.h !== height)
    throw new Error("수정 이미지와 출력 규격이 다릅니다. 같은 크기의 수정본을 사용해 주세요.");
  const prefix = "data:image/png;base64,";
  if (typeof dataUrl !== "string" || !dataUrl.startsWith(prefix))
    throw new Error("정규화한 수정 PNG 원본을 확인해 주세요.");
  const encoded = dataUrl.slice(prefix.length);
  const padding = encoded.endsWith("==") ? 2 : encoded.endsWith("=") ? 1 : 0;
  if (!encoded.length || encoded.length % 4 || encoded.length > Math.ceil(20 * 1024 * 1024 / 3) * 4 ||
      /[^A-Za-z0-9+/]/.test(encoded.slice(0, encoded.length - padding)))
    throw new Error("수정 PNG 파일을 확인해 주세요.");
  const bytes = Buffer.from(encoded, "base64");
  if (bytes.length < 33 || bytes.length > 20 * 1024 * 1024 ||
      !bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) ||
      bytes.toString("ascii", 12, 16) !== "IHDR" || bytes.readUInt32BE(16) !== width || bytes.readUInt32BE(20) !== height)
    throw new Error("수정 PNG의 가로·세로 크기를 확인해 주세요.");
  return bytes;
}
