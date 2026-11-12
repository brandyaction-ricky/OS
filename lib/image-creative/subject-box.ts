export type SubjectBox = [number, number, number, number];

/** Tight bounds of visible non-white pixels, in display orientation. The YouTube
 * thumbnail recipe uses a luminance difference of more than 12 from white. */
export function photoSubjectBox(rgba: Uint8Array | Uint8ClampedArray, width: number, height: number): SubjectBox | undefined {
  if (rgba.length !== width * height * 4) throw new Error("사진 픽셀 크기를 확인해 주세요.");
  let left = width, top = height, right = 0, bottom = 0;
  for (let y = 0, i = 0; y < height; y++) {
    for (let x = 0; x < width; x++, i += 4) {
      const luminance = Math.round((299 * rgba[i] + 587 * rgba[i + 1] + 114 * rgba[i + 2]) / 1000);
      if ((255 - luminance) * rgba[i + 3] <= 12 * 255) continue;
      if (x < left) left = x;
      if (x >= right) right = x + 1;
      if (y < top) top = y;
      bottom = y + 1;
    }
  }
  return right > left ? [left, top, right, bottom] : undefined;
}
