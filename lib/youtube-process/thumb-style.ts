// 썸네일 스타일 (롱폼 애니메이션 썸네일 자동 제작 요청, 2026-11-09): the look of a format's thumbnails kept apart from the feature, so
// another format later only needs a new style. The composite, its checks and the image prompts all read these numbers.
import type { YpKind } from "./project.ts";

export type ThumbTool = "flow" | "chatgpt";
/** The frames a candidate can be set in besides the 기본형: 인물형 (2026-11-24) and 콜라주형 (2026-11-28). */
export const THUMB_FRAMES = ["person", "collage"] as const;
export type ThumbFrameKind = typeof THUMB_FRAMES[number];
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
  /** 인물형 (마이인 가이드, 대표 확정 2026-11-24): the photo fills the frame, the copy sits in a blue and a black box on its left. */
  /** 콜라주형 (썸네일 정본, 대표 2026-11-28): a text-free photo collage, film noise, the 고민 silhouette and two lines bottom-left. */
  frame?: ThumbFrameKind;
  /** The photo mirrored, so the person stands on the right of the boxes. */
  flip?: boolean;
  size?: number;
  photo?: { scale: number; x: number; y: number; brightness: number };
  extras?: ThumbExtra[];
}
export interface ThumbExtra { id: string; text: string; color: ThumbExtraColor; size: number; x: number; y: number }
export const THUMB_EXTRA_COLORS = { ink: "잉크", accent: "파랑", red: "빨강", white: "흰 글자" } as const;
export type ThumbExtraColor = keyof typeof THUMB_EXTRA_COLORS;
export const THUMB_PHOTO_LIMITS = { scale: [0.5, 1.6], x: [-640, 640], y: [-360, 360], brightness: [0.6, 1.4] } as const;
/**
 * Where the subject is in the picture (px): the box around everything that is not the white background, and the picture's size.
 * The AI measures it when it hands the picture in; the frame then puts the subject big above the title, as the local tool did.
 */
export interface ThumbSubject { box: [number, number, number, number]; size: [number, number] }
export interface ThumbBox { left: number; top: number; width: number; height: number }
/** photoBox: where the picture goes (objectFit contain inside it); clipBottom: the picture is cut there, just above the title's letters. */
export interface ThumbLayout { lines: string[]; size: number; titleTop: number; subjectBox: { top: number; height: number }; photoBox: ThumbBox; clipBottom: number; checks: ThumbCheck[];
  person?: { band: { text: string; top: number; size: number } | null; boxes: { text: string; top: number; height: number; bg: string }[] };
  collage?: { sub: { text: string; top: number; size: number } | null; main: { text: string; top: number; size: number }; silhouette: ThumbBox } }
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

/**
 * 인물형 틀 (마이인 유튜브 스타일 가이드, 대표가 1·2·3편으로 확정 2026-11-24): the situation photo over the whole frame (darker on the
 * left), the copy's lines from the bottom-left — a small band (when there are three lines), a blue box, a black box — white Pretendard.
 * Measured on the local tool: 72 px letters in boxes 34 px taller, 48 px wider, the black box ending 114 px above the bottom.
 */
export const THUMB_PERSON = { blue: "#315FFA", black: "#000000", text: "#FFFFFF", sidePx: 64, bottomPx: 114, minPx: 56, maxPx: 84, padX: 48, padY: 34, gap: 4,
  band: { size: 34, gap: 26 }, maxLines: 3, phoneMinPx: 16, maxChars: 14,
  prompt: {
    flow: "Documentary photo, natural light, candid, 35mm, full colour, the person on the right third of the frame, the left half calm and uncluttered, face turned to the side or partly away (no straight-on close-up), no text, no logos, no frame, 16:9.",
    chatgpt: "다큐 사진, 자연광, 꾸미지 않은 순간, 35mm, 전체 컬러, 사람은 화면 오른쪽 3분의 1에, 왼쪽 절반은 차분하고 비어 있게, 얼굴은 옆이나 반쯤 돌린 구도(정면 클로즈업 금지), 글자 · 로고 · 테두리 없이, 3:2.",
  } satisfies Record<ThumbTool, string>,
  rules: [
    "타겟 본인이 그 고민을 하는 실제 순간(장소 · 행동 · 표정) 한 장. 사람은 오른쪽, 왼쪽은 글자 박스 자리라 비워 둬요.",
    "실사 · 전체 컬러. 실존 인물을 AI로 만들지 않고 대표 얼굴 · 회사 로고 · 괄호 꼬리표를 넣지 않아요.",
    "그림에는 글자를 넣지 않아요 — 작은 띠 · 파랑 박스(#315FFA) · 검정 박스는 OS가 Pretendard 900 흰 글자로 얹어요.",
  ],
} as const;

/**
 * 콜라주형 틀 (「회사냐 일이냐」 썸네일 정본, 대표 2026-11-28): the AI's text-free photo collage over the whole frame, the shared film
 * noise (fading to the bottom), a dark fade under the copy, the anonymous 고민 silhouette on the right cut by the bottom edge, and two
 * lines from the bottom-left — a thin white line, then a heavy white line with one yellow word, both outlined behind the letters.
 * The numbers are the canon's 실제 렌더 기준; the silhouette sits at the average of its nine test renders.
 */
export const THUMB_COLLAGE = {
  left: 43, right: 180, bottom: 40, lineHeight: 1.03, tracking: -0.052, gap: 8, stroke: "#111316",
  sub: { weight: 300, minPx: 72, maxPx: 94, color: "#F8F8F5", strokePx: 3 },
  main: { weight: 900, minPx: 104, maxPx: 132, color: "#FFFDF7", accent: "#F9FF98", strokePx: 5 },
  phoneMinPx: 26, maxLines: 2,
  shade: "linear-gradient(180deg, rgba(11,12,16,0) 44%, rgba(11,12,16,0.05) 52%, rgba(11,12,16,0.41) 62%, rgba(9,10,14,0.79) 82%, rgba(8,10,16,0.93) 100%)",
  // soft-light 94 % in the canon: the tile is that noise baked into black and white specks, so screen and PNG (no blend modes) match.
  noise: { src: "/thumb-collage/noise.png", tile: 256, mask: "linear-gradient(180deg, #000 0%, #000 62%, rgba(0,0,0,0.73) 80%, rgba(0,0,0,0.33) 100%)" },
  // ponytail: one fixed spot for every collage; add a nudge in 다듬기 if PDs find it covering the main prop.
  silhouette: { src: "/thumb-collage/silhouette.png", ratio: 1159 / 1356, anchor: 1170, height: 620, bottom: -22, shift: 0.52, brightness: 1.43 },
  /** The canon's common block: said before the scene the AI writes for this video (Korean works on Flow too). */
  prompt: "첨부된 참고 그림은 디자인 참고용이다. 인물, 사진, 로고, 모든 글자는 빼고, 그 레퍼런스에서 입체적으로 겹친 큰 피사체들, 거친 사진 콜라주, 화면 끝까지 차는 비대칭 배치, 질감 있는 사무실·건물 배경만 이 이미지의 장면에 옮긴다. 가로 16:9, 유튜브 썸네일에 들어갈 무문자 완성 배경. 전체 캔버스를 실제 사진 콜라주로 채운다. 배경은 어두운 차콜과 채도를 낮춘 유리 청회색, 입자가 섬세한 편집 사진. 면을 넓게 차지하는 밝은 문서색과 코발트 사물을 앞에 두어 대비와 영상의 색 연속성이 있도록 한다. 윗부분에 가장 알아보기 쉬운 전경 사물을 크게, 중경의 다른 단서는 비대칭으로 겹쳐 두되 서로 다른 덩어리로 보인다. 오른쪽은 브랜드 로고나 사람이 없는 사무 공간과 보조 소재. 인물, 얼굴, 손, 사람의 실루엣이나 반사, 회사 로고, 유튜브 아이콘, 글자와 숫자, 무늬가 복잡한 소품, 화살표 그래픽 없이. 화면 아래 37%에는 나중에 두 줄 큰 흰색과 노란색 한글이 올라가므로 어두운 분위기를 만들되 위와 단절된 검정 띠나 액자, 둥근 카드, 칸은 그리지 않는다. 참고 그림처럼 화면 가장자리에 닿는 사물과 자연스럽게 이어지는 사진의 깊이와 선명한 대비. 작은 썸네일에서도 핵심 장면이 완전히 읽혀야 한다.",
  rules: [
    "그림 = 글자 없는 실제 사진 콜라주 한 장. 이 영상의 고민을 한눈에 말하는 큰 사물 하나(왼쪽 위 절반 가까이) + 다른 단서 하나(오른쪽 뒤에 겹쳐), 화면 끝까지 비대칭으로 채워요.",
    "사람 · 얼굴 · 손 · 실루엣 · 로고 · 글자 · 숫자 · 화살표 없이. 사람 자리는 OS가 오른쪽에 익명 고민 실루엣으로 얹어요 — 오른쪽 3분의 1은 보조 소재만.",
    "화면 아래 37%는 어둡게 이어지게(검정 띠 · 액자 · 카드 없이). 문구 두 줄은 OS가 왼쪽 아래에 흰 글자(첫 줄 가늘게 · 둘째 줄 굵게, 노랑 한 어절)로 얹어요.",
    "어두운 차콜 · 채도 낮은 청회색 바탕에 밝은 문서색과 코발트 사물로 대비. 필름 노이즈는 OS가 얹어요.",
  ],
} as const;

function collageLayout(copy: ThumbCopy, style: ThumbStyle, edit?: ThumbEdit): ThumbLayout {
  const C = THUMB_COLLAGE;
  const all = copy.text.replace(/\r/g, "").split(/\n|\s\/\s/).map((line) => line.trim()).filter(Boolean);
  const [subText, mainText] = all.length >= 2 ? [all[0], all[1]] : [null, all[0] ?? ""];
  const room = style.width - C.left - C.right;
  const fitMain = Math.floor(room / Math.max(1, thumbLineEm(mainText, C.tracking)));
  const size = Math.max(C.main.minPx, Math.min(C.main.maxPx, fitMain, edit?.size ?? C.main.maxPx));
  const fitSub = subText ? Math.floor(room / Math.max(1, thumbLineEm(subText, C.tracking))) : C.sub.maxPx;
  const subSize = Math.max(C.sub.minPx, Math.min(C.sub.maxPx, fitSub));
  const mainTop = Math.round(style.height - C.bottom - size * C.lineHeight);
  const sub = subText ? { text: subText, size: subSize, top: Math.round(mainTop - C.gap - subSize * C.lineHeight) } : null;
  const S = C.silhouette, width = Math.round(S.height * S.ratio);
  const silhouette = { left: Math.round(S.anchor - width * S.shift), top: style.height - S.bottom - S.height, width, height: S.height };
  const photoBox = scalePhoto({ left: 0, top: 0, width: style.width, height: style.height }, edit?.photo, null);
  const phonePx = size * style.phone.widthPx / style.width;
  const checks: ThumbCheck[] = [
    { id: "lines", ok: all.length >= 1 && all.length <= C.maxLines, text: `${all.length}줄 (콜라주형은 최대 ${C.maxLines}줄: 가는 첫 줄 · 굵은 둘째 줄)` },
    { id: "chars", ok: fitMain >= C.main.minPx && fitSub >= C.sub.minPx, text: fitMain < C.main.minPx ? "둘째 줄이 길어 화면에 다 안 들어가요 — 줄여 주세요"
      : fitSub < C.sub.minPx ? "첫 줄이 길어 화면에 다 안 들어가요 — 줄여 주세요" : `굵은 줄 ${size}px` },
    { id: "phone", ok: phonePx >= C.phoneMinPx, text: `휴대폰 피드 글자 ${Math.round(phonePx)}px (기준 ${C.phoneMinPx}px 이상)` },
    ...(edit?.extras?.length ? [extrasCheck(edit.extras, style)] : []),
  ];
  return { lines: sub ? [sub.text, mainText] : [mainText], size, titleTop: sub?.top ?? mainTop, subjectBox: { top: 0, height: style.height }, photoBox,
    clipBottom: style.height, checks, collage: { sub, main: { text: mainText, top: mainTop, size }, silhouette } };
}

function personLayout(copy: ThumbCopy, style: ThumbStyle, edit?: ThumbEdit): ThumbLayout {
  const P = THUMB_PERSON;
  // 기획안 문구 칸은 한 줄이라 「 / 」로 나눠 쓰기도 한다(서율 3편 리메이크 2026-11-25) — 인물형에서는 줄바꿈과 같게 센다.
  const all = copy.text.replace(/\r/g, "").split(/\n|\s\/\s/).map((line) => line.trim()).filter(Boolean);
  const band = all.length >= 3 ? all[0] : null, lines = (band ? all.slice(1) : all).slice(0, 2);
  const widest = Math.max(1, ...lines.map((line) => thumbLineEm(line, 0)));
  const fit = Math.floor((style.width - 2 * P.sidePx - P.padX) / widest);
  const size = Math.max(P.minPx, Math.min(P.maxPx, fit, edit?.size ?? 72));
  const height = size + P.padY;
  const top0 = style.height - P.bottomPx - lines.length * height - (lines.length - 1) * P.gap;
  const boxes = lines.map((text, i) => ({ text, top: top0 + i * (height + P.gap), height, bg: i === 0 && lines.length > 1 ? P.blue : P.black }));
  const bandRow = band ? { text: band, top: top0 - P.band.gap - P.band.size, size: P.band.size } : null;
  const full = { left: 0, top: 0, width: style.width, height: style.height };
  const photoBox = scalePhoto(full, edit?.photo, null);
  const phonePx = size * style.phone.widthPx / style.width;
  const checks: ThumbCheck[] = [
    { id: "lines", ok: lines.length >= 1 && all.length <= P.maxLines, text: `${all.length}줄 (인물형은 최대 ${P.maxLines}줄: 작은 띠 · 파랑 박스 · 검정 박스)` },
    { id: "chars", ok: fit >= P.minPx, text: fit >= P.minPx ? `박스 글자 ${size}px` : `글자가 길어 박스가 화면 밖으로 나가요 — 한 줄을 줄여 주세요` },
    { id: "phone", ok: phonePx >= P.phoneMinPx, text: `휴대폰 피드 글자 ${Math.round(phonePx)}px (기준 ${P.phoneMinPx}px 이상)` },
    ...(edit?.extras?.length ? [extrasCheck(edit.extras, style)] : []),
  ];
  return { lines, size, titleTop: bandRow?.top ?? top0, subjectBox: { top: 0, height: style.height }, photoBox, clipBottom: style.height, checks, person: { band: bandRow, boxes } };
}

/** Where everything goes on the 1280×720 frame, and the checks that follow from it (the 50 px bottom, the phone text size, the line rules). */
export function thumbLayout(copy: ThumbCopy, style: ThumbStyle, edit?: ThumbEdit, subject?: ThumbSubject | null): ThumbLayout {
  if (edit?.frame === "person") return personLayout(copy, style, edit);
  if (edit?.frame === "collage") return collageLayout(copy, style, edit);
  const t = style.title, lines = thumbLines(copy.text, style);
  const widest = Math.max(1, ...lines.map((line) => thumbLineEm(line, t.tracking)));
  const fit = Math.floor((style.width - 2 * t.sidePx) / widest);
  // A size the PD set stays within the style's range and never wider than the frame.
  const size = Math.max(t.minPx, Math.min(t.maxPx, fit, edit?.size ?? fit));
  const block = lines.length * size * t.lineHeight;
  const titleTop = Math.round(style.height - t.bottomPx - block);
  const room = titleTop - style.subject.topPx;
  const subjectBox = { top: style.subject.topPx, height: Math.round(room * style.subject.maxShare) };
  // The letters start about a tenth of the size below the line's top, so the subject may come down to there (it then sits on the title).
  const clipBottom = titleTop + Math.round(size * 0.1);
  const photoBox = scalePhoto(placeSubject(style, subject, clipBottom) ?? { left: 0, top: subjectBox.top, width: style.width, height: subjectBox.height }, edit?.photo, subject);
  const phonePx = size * style.phone.widthPx / style.width;
  const longest = Math.max(0, ...lines.map((line) => [...line.replace(/\s/g, "")].length));
  const checks: ThumbCheck[] = [
    { id: "bottom", ok: style.height - (titleTop + block) >= t.bottomPx - 0.5, text: `하단 공백 ${Math.round(style.height - (titleTop + block))}px (기준 ${t.bottomPx}px 이상)` },
    { id: "phone", ok: phonePx >= style.phone.minTextPx, text: `휴대폰 피드 글자 ${Math.round(phonePx)}px (기준 ${style.phone.minTextPx}px 이상)` },
    { id: "lines", ok: lines.length >= 1 && lines.length <= t.maxLines && thumbLines(copy.text, { ...style, title: { ...t, maxLines: 9 } }).length <= t.maxLines, text: `${lines.length}줄 (최대 ${t.maxLines}줄)` },
    { id: "chars", ok: longest <= t.maxChars && fit >= t.minPx, text: fit >= t.minPx ? `한 줄 ${longest}자 (최대 ${t.maxChars}자)` : `글자가 길어 ${t.minPx}px로 한 줄에 다 안 들어가요` },
    ...(edit?.extras?.length ? [extrasCheck(edit.extras, style)] : []),
  ];
  return { lines, size, titleTop, subjectBox, photoBox, clipBottom, checks };
}

/**
 * The subject as big as the room above the title allows (the style's 100 %), centred, sitting on the title; a subject the picture cuts
 * at its top edge stays on the frame's top edge. No subject box (older candidates, the PD's own photo): the whole picture fits the room.
 */
function placeSubject(style: ThumbStyle, subject: ThumbSubject | null | undefined, bottom: number): ThumbBox | null {
  if (!subject) return null;
  const [x0, y0, x1, y1] = subject.box, [w, h] = subject.size;
  const top = y0 <= 2 ? 0 : style.subject.topPx;
  const k = Math.min((bottom - top) / (y1 - y0), (style.width - 2 * style.title.sidePx) / (x1 - x0));
  return { left: Math.round(style.width / 2 - (x0 + x1) / 2 * k), top: Math.round(bottom - y1 * k), width: Math.round(w * k), height: Math.round(h * k) };
}
/** The PD's 사진 edit: scaled around the subject (or the picture's middle), then moved. */
function scalePhoto(box: ThumbBox, photo: ThumbEdit["photo"], subject?: ThumbSubject | null): ThumbBox {
  if (!photo) return box;
  const k = box.width / (subject?.size[0] ?? box.width);
  const cx = subject ? box.left + (subject.box[0] + subject.box[2]) / 2 * k : box.left + box.width / 2;
  const cy = subject ? box.top + (subject.box[1] + subject.box[3]) / 2 * k : box.top + box.height / 2;
  return { left: Math.round(cx + (box.left - cx) * photo.scale + photo.x), top: Math.round(cy + (box.top - cy) * photo.scale + photo.y),
    width: Math.round(box.width * photo.scale), height: Math.round(box.height * photo.scale) };
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
  const person = edit.frame === "person", collage = edit.frame === "collage";
  const sizes: readonly [number, number] = person ? [THUMB_PERSON.minPx, THUMB_PERSON.maxPx] : collage ? [THUMB_COLLAGE.main.minPx, THUMB_COLLAGE.main.maxPx] : [style.title.minPx, style.title.maxPx];
  return {
    ...(person || collage ? { frame: edit.frame } : {}), ...(person && edit.flip ? { flip: true } : {}),
    ...(edit.size ? { size: clamp(Math.round(edit.size), sizes) } : {}),
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
