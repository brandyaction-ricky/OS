import type { CreativeVariant } from "./model";
import { isWarehouseFormat } from "./formats";
import { renderFormatTestSvg, type FormatTestCopy, type WarehouseFormatId } from "./format-test-renderer.mjs";
import { resolvePlacement } from "./placement.ts";
import type { RenderDesign } from "./safe-artwork.mjs";
import displayFiles from "./format-test-fonts.json";

const fonts = new Map<string, Promise<string>>();
// Several variants often share one signed project photograph. Only coalesce in-flight reads.
const readingPhotos = new Map<string, Promise<string>>();

async function readDataUrl(path: string, type?: string): Promise<string> {
  const response = await fetch(path);
  if (!response.ok) throw new Error("사진이나 서체를 불러올 수 없어요. 작업을 다시 불러와 주세요.");
  const data = await response.blob();
  if (!type && !["image/jpeg", "image/png", "image/webp"].includes(data.type)) throw new Error("이 작업에 등록한 사진을 확인해 주세요.");
  const input = type ? new Blob([data], { type }) : data;
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error("제작 자료를 읽지 못했어요."));
    reader.readAsDataURL(input);
  });
}

export function readWarehousePhoto(path: string) {
  let pending = readingPhotos.get(path);
  if (!pending) {
    pending = readDataUrl(path).finally(() => readingPhotos.delete(path));
    readingPhotos.set(path, pending);
  }
  return pending;
}

function font(path: string) {
  let pending = fonts.get(path);
  if (!pending) {
    pending = readDataUrl(path, "font/woff2").catch(error => { fonts.delete(path); throw error; });
    fonts.set(path, pending);
  }
  return pending;
}

export async function warehousePng(formatId: WarehouseFormatId, copy: FormatTestCopy, photo: string, version: 1 | 2, design?: RenderDesign): Promise<Blob> {
  const base = font("/fonts/pretendard/PretendardVariable.woff2");
  const selected = design?.font ?? "original";
  const file = selected === "original" ? (version === 2 ? displayFiles[formatId] : undefined)
    : selected === "sans" ? undefined : selected + ".woff2";
  const face = file ? font("/image-format-test/fonts/" + file) : undefined;
  const [fontData, displayFontData] = await Promise.all([base, face]);
  const input = { formatId, photo, copy, fontData, displayFontData, design };
  const svg = version === 1
    ? (await import("./format-test-renderer-v1.mjs")).renderFormatTestSvg(input)
    : renderFormatTestSvg(input);
  const url = URL.createObjectURL(new Blob([svg], { type: "image/svg+xml;charset=utf-8" }));
  try {
    const image = new Image();
    image.src = url;
    await image.decode();
    const canvas = document.createElement("canvas");
    const placement = resolvePlacement("portrait", design?.placement, design?.outputWidth);
    canvas.width = placement.width;
    canvas.height = placement.height;
    const context = canvas.getContext("2d", { willReadFrequently: true });
    if (!context) throw new Error("이미지를 그릴 수 없어요.");
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    return await new Promise<Blob>((resolve, reject) => canvas.toBlob(
      blob => blob ? resolve(blob) : reject(new Error("PNG를 만들 수 없어요.")), "image/png"
    ));
  } finally { URL.revokeObjectURL(url); }
}

export function downloadBlob(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 30_000);
}

export async function downloadWarehouseSelection(
  variants: CreativeVariant[],
  getPreview: (variant: CreativeVariant) => Blob | undefined,
  getLegacyPng: (variant: CreativeVariant) => Promise<Blob>,
  name: string,
  kind: "batch" | "variant",
  manifest: { brief?: unknown; batch?: unknown } = {},
) {
  if (!variants.length || (kind === "variant" && variants.length !== 1)) throw new Error("내보낼 시안을 확인해 주세요.");
  const resolveBlob = async (variant: CreativeVariant) => {
    const blob = isWarehouseFormat(variant.formatId) ? getPreview(variant) : await getLegacyPng(variant);
    if (!blob?.size || blob.type !== "image/png") throw new Error("시안의 PNG가 준비된 뒤 다시 시도해 주세요.");
    return blob;
  };
  if (kind === "variant") {
    downloadBlob(await resolveBlob(variants[0]), name);
    return;
  }
  const { default: JSZip } = await import("jszip");
  const zip = new JSZip();
  for (const [index, variant] of variants.entries()) {
    const blob = await resolveBlob(variant);
    zip.file(`${String(index + 1).padStart(2, "0")}-${variant.id}.png`, await blob.arrayBuffer());
  }
  zip.file("variants.json", JSON.stringify({ ...manifest, variants, placements: variants.map(v => ({ variantId: v.id, ...resolvePlacement(v.size, v.design?.placement, v.design?.outputWidth) })) }, null, 2));
  downloadBlob(await zip.generateAsync({ type: "blob", compression: "STORE" }), name);
}
