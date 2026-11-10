/** Image inputs only: immutable paths, real dimensions and an owner checked before any privileged read. */
export const IMAGE_CREATIVE_KIND = "image_creative_v1";
export const IMAGE_FILE_MAX = 5 * 1024 * 1024;
export function protectedImageCreativeChange(...values: (Record<string, unknown> | null | undefined)[]) {
  return values.some(value => value?.kind === IMAGE_CREATIVE_KIND || (value?.kind === "youtube_staff_ai_v1" && value?.task === "image-creative"));
}
export function imageFileInfo(bytes: Uint8Array): { w: number; h: number; mime: "image/png" | "image/jpeg"; ext: "png" | "jpg" } {
  const bad = () => { throw new Error("5MB 이하의 정상 PNG 또는 JPEG 이미지를 넣어 주세요."); };
  if (!bytes.length || bytes.length > IMAGE_FILE_MAX) return bad();
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let w = 0, h = 0, png = false;
  if (bytes.length >= 33 && [137,80,78,71,13,10,26,10].every((v, i) => bytes[i] === v) && view.getUint32(8) === 13 && view.getUint32(12) === 0x49484452) {
    png = true; w = view.getUint32(16); h = view.getUint32(20);
  } else if (bytes.length > 4 && bytes[0] === 255 && bytes[1] === 216 && bytes.at(-2) === 255 && bytes.at(-1) === 217) {
    for (let i = 2; i + 8 < bytes.length;) {
      if (bytes[i++] !== 255) return bad();
      while (bytes[i] === 255) i++;
      const marker = bytes[i++];
      if (marker === 0xda || marker === 0xd9) break;
      if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd8)) continue;
      if (i + 2 > bytes.length) return bad();
      const length = view.getUint16(i);
      if (length < 2 || i + length > bytes.length) return bad();
      if ([0xc0,0xc1,0xc2].includes(marker) && length >= 8) { h = view.getUint16(i + 3); w = view.getUint16(i + 5); break; }
      i += length;
    }
  }
  if (!w || !h || w > 8192 || h > 8192 || w * h > 20_000_000) return bad();
  return { w, h, mime: png ? "image/png" : "image/jpeg", ext: png ? "png" : "jpg" };
}
export function ownsImageAsset(projectId: string, path: string) {
  return new RegExp(`^image-creatives/${projectId}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\\.(png|jpg)$`).test(path);
}
