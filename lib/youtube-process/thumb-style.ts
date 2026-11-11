// 썸네일 스타일 (롱폼 애니메이션 썸네일 자동 제작 요청, 2026-11-09): the look of a format's thumbnails kept apart from the feature, so
// another format later only needs a new style. The composite, its checks and the image prompts all read these numbers.
import type { YpKind } from "./project.ts";

export type ThumbTool = "flow" | "chatgpt";
export interface ThumbStyle {
  id: string; name: string; kinds: readonly YpKind[];
  width: number; height: number; background: string;
  /** The title block from the bottom: Pretendard at this weight and tracking, ink with one accent, ≤ maxChars a line, ≤ maxLines. */
  title: { weight: number; tracking: number; lineHeight: number; ink: string; accent: string; maxChars: number; maxLines: number;
    minPx: number; maxPx: number; sidePx: number; bottomPx: number };
  /** The subject sits centred above the title, filling this share of that height. */
  subject: { minShare: number; maxShare: number; topPx: number };
  /** A phone feed shows the thumbnail this wide (CSS px); the title must read at least minTextPx there. */
  phone: { widthPx: number; minTextPx: number };
  /** Said to the AI that makes the picture (no text in it — the OS sets the title). */
  prompt: Record<ThumbTool, string>;
  rules: string[];
}

export const THUMB_STYLES: Record<string, ThumbStyle> = {
  anim: {
    id: "anim", name: "롱폼 애니메이션", kinds: ["anim"],
    width: 1280, height: 720, background: "#FFFFFF",
    title: { weight: 900, tracking: -0.065, lineHeight: 1.08, ink: "#1E1D1D", accent: "#212CB0", maxChars: 12, maxLines: 2, minPx: 120, maxPx: 170, sidePx: 64, bottomPx: 50 },
    subject: { minShare: 0.55, maxShare: 1, topPx: 24 },
    phone: { widthPx: 320, minTextPx: 30 },
    prompt: {
      flow: "Photorealistic, shot on a Samsung Galaxy phone, one Korean subject centred on a pure white background, soft even light, full colour, no text, no logos, no frame, no sparkle marks, 16:9.",
      chatgpt: "실사 사진, 갤럭시로 찍은 느낌, 한국인 피사체 하나를 순백 바탕 가운데에, 고르고 부드러운 빛, 전체 컬러(흑백·부분 흑백 금지), 글자·로고·테두리·반짝이(✦) 없이, 3:2.",
    },
    rules: [
      "바탕 순백, 위에 피사체 하나(가운데), 아래에 제목. 사람이 나오면 타겟 본인, 킬포인트 소품 1~2개.",
      "실사 · 전체 컬러(흑백 · 부분 흑백 금지). 실존 인물을 AI로 만들지 않고 회사 로고를 넣지 않아요.",
      "그림에는 글자를 넣지 않아요 — 제목은 OS가 Pretendard 900으로 얹어요.",
      "파랑 장치는 하나까지, 강조 박스 · 외곽선 · 기울임 없음.",
    ],
  },
};

export const thumbStyleFor = (kind?: YpKind | null) => Object.values(THUMB_STYLES).find((style) => kind && style.kinds.includes(kind)) ?? null;

export interface ThumbCopy { text: string; accent?: string }
/**
 * 제작 「최종 썸네일」 상세 수정 (요청 P2): what the PD changed on a picked thumbnail. The frame draws it the same on screen and in the PNG.
 * size: the title size within the style's range (the blue accent stays a 글자색 only — 형광펜 · 밑줄 dropped by the owner 2026-11-11).
 * photo: the picture moved (px on the 1280×720 frame), scaled and brightened. extras: lines added anywhere on the frame.
 */
export interface ThumbEdit {
  size?: number;
  photo?: { scale: number; x: number; y: number; brightness: number };
  extras?: ThumbExtra[];
}
export interface ThumbExtra { id: string; text: string; color: ThumbExtraColor; size: number; x: number; y: number }
export const THUMB_EXTRA_COLORS = { ink: "잉크", accent: "파랑", red: "빨강", white: "흰 글자" } as const;
export type ThumbExtraColor = keyof typeof THUMB_EXTRA_COLORS;
export const THUMB_PHOTO_LIMITS = { scale: [0.5, 1.6], x: [-640, 640], y: [-360, 360], brightness: [0.6, 1.4] } as const;
export interface ThumbLayout { lines: string[]; size: number; titleTop: number; subjectBox: { top: number; height: number }; checks: ThumbCheck[] }
export interface ThumbCheck { id: "bottom" | "phone" | "lines" | "chars" | "extras"; ok: boolean; text: string }

/** Glyph width in em (Pretendard Black): Hangul and wide symbols ≈ 1, Latin and digits narrower, spaces a third. */
const glyph = (ch: string) => /\s/.test(ch) ? 0.3 : /[가-힣ㄱ-ㅎㅏ-ㅣ一-龥]/.test(ch) ? 1 : /[A-Z0-9%?!]/.test(ch) ? 0.66 : 0.56;
export const thumbLineEm = (line: string, tracking: number) => [...line].reduce((sum, ch) => sum + glyph(ch) + tracking, 0);

/** The copy in at most maxLines lines: the writer's own line break, else the space nearest the middle when it is longer than maxChars. */
export function thumbLines(text: string, style: ThumbStyle) {
  const clean = text.replace(/\r/g, "").trim();
  const given = clean.split("\n").map((line) => line.trim()).filter(Boolean);
  if (given.length > 1 || [...clean].length <= style.title.maxChars) return given.slice(0, style.title.maxLines);
  const spaces = [...clean.matchAll(/\s+/g)].map((m) => m.index!);
  if (!spaces.length) return [clean];
  const middle = clean.length / 2, cut = spaces.reduce((best, at) => Math.abs(at - middle) < Math.abs(best - middle) ? at : best, spaces[0]);
  return [clean.slice(0, cut).trim(), clean.slice(cut).trim()].filter(Boolean);
}

/** Where everything goes on the 1280×720 frame, and the checks that follow from it (the 50 px bottom, the phone text size, the line rules). */
export function thumbLayout(copy: ThumbCopy, style: ThumbStyle, edit?: ThumbEdit): ThumbLayout {
  const t = style.title, lines = thumbLines(copy.text, style);
  const widest = Math.max(1, ...lines.map((line) => thumbLineEm(line, t.tracking)));
  const fit = Math.floor((style.width - 2 * t.sidePx) / widest);
  // A size the PD set stays within the style's range and never wider than the frame.
  const size = Math.max(t.minPx, Math.min(t.maxPx, fit, edit?.size ?? fit));
  const block = lines.length * size * t.lineHeight;
  const titleTop = Math.round(style.height - t.bottomPx - block);
  const room = titleTop - style.subject.topPx;
  const subjectBox = { top: style.subject.topPx, height: Math.round(room * style.subject.maxShare) };
  const phonePx = size * style.phone.widthPx / style.width;
  const longest = Math.max(0, ...lines.map((line) => [...line.replace(/\s/g, "")].length));
  const checks: ThumbCheck[] = [
    { id: "bottom", ok: style.height - (titleTop + block) >= t.bottomPx - 0.5, text: `하단 공백 ${Math.round(style.height - (titleTop + block))}px (기준 ${t.bottomPx}px 이상)` },
    { id: "phone", ok: phonePx >= style.phone.minTextPx, text: `휴대폰 피드 글자 ${Math.round(phonePx)}px (기준 ${style.phone.minTextPx}px 이상)` },
    { id: "lines", ok: lines.length >= 1 && lines.length <= t.maxLines && thumbLines(copy.text, { ...style, title: { ...t, maxLines: 9 } }).length <= t.maxLines, text: `${lines.length}줄 (최대 ${t.maxLines}줄)` },
    { id: "chars", ok: longest <= t.maxChars && fit >= t.minPx, text: fit >= t.minPx ? `한 줄 ${longest}자 (최대 ${t.maxChars}자)` : `글자가 길어 ${t.minPx}px로 한 줄에 다 안 들어가요` },
    ...(edit?.extras?.length ? [extrasCheck(edit.extras, style)] : []),
  ];
  return { lines, size, titleTop, subjectBox, checks };
}

/** Added lines stay inside the frame and above the 50 px bottom (their width is read like the title's). */
function extrasCheck(extras: ThumbExtra[], style: ThumbStyle): ThumbCheck {
  const out = extras.filter((x) => x.x < 0 || x.y < 0 || x.x + thumbLineEm(x.text, style.title.tracking) * x.size > style.width || x.y + x.size * style.title.lineHeight > style.height - style.title.bottomPx);
  return { id: "extras", ok: !out.length, text: out.length ? `더한 문구 ${out.map((x) => `「${x.text}」`).join(" ")}가 화면 밖이나 하단 공백에 걸려요` : `더한 문구 ${extras.length}개 화면 안` };
}
const clamp = (value: number, [low, high]: readonly [number, number]) => Math.min(high, Math.max(low, value));
/** An edit as the frame may use it: numbers inside their ranges, at most 4 added lines. */
export function cleanThumbEdit(edit: ThumbEdit | undefined, style: ThumbStyle): ThumbEdit {
  if (!edit) return {};
  const L = THUMB_PHOTO_LIMITS;
  return {
    ...(edit.size ? { size: clamp(Math.round(edit.size), [style.title.minPx, style.title.maxPx]) } : {}),
    ...(edit.photo ? { photo: { scale: clamp(edit.photo.scale, L.scale), x: Math.round(clamp(edit.photo.x, L.x)), y: Math.round(clamp(edit.photo.y, L.y)), brightness: clamp(edit.photo.brightness, L.brightness) } } : {}),
    ...(edit.extras?.length ? { extras: edit.extras.slice(0, 4).map((x) => ({ ...x, size: clamp(Math.round(x.size), [36, 140]), x: Math.round(x.x), y: Math.round(x.y) })) } : {}),
  };
}

/** The accent's place in a line, so the composite can colour that part. */
export function thumbAccentParts(line: string, accent?: string) {
  const at = accent ? line.indexOf(accent) : -1;
  return at < 0 || !accent ? [{ text: line, accent: false }] : [
    ...(at ? [{ text: line.slice(0, at), accent: false }] : []), { text: accent, accent: true },
    ...(at + accent.length < line.length ? [{ text: line.slice(at + accent.length), accent: false }] : [])];
}
