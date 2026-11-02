// One card of a 카드뉴스 (content centred top to bottom), drawn the same way in the browser preview and in the PNG (next/og). Satori reads only flex layouts and
// inline styles, so every box with more than one child is display:flex and nothing here uses hooks, classes or grid.
// Each text field has a fixed number of lines: past it the text is cut, and the editor marks that field (data-card-field) as 넘침.
// The look is the MYIN 카드뉴스 디자인 정본 (2026-11-02): white body cards, a blue cover and ending, Pretendard 400 · 500 · 600 at its
// sizes for 1080 × 1350, 96px text margins, photos and diagrams within 80% of the width, and the explanation right under what it explains.
import type { CSSProperties, ReactNode } from "react";
import { CARD_MARK, CARD_SIZE, plainCardText, type CardDraft, type CardPhoto, type CardSlide } from "./formats.ts";

/** 디자인 정본 §2. Blue cards carry white text and gold only for the marked phrase; gold never sits on a light card. */
export const CARD_THEME = { paper: "#FFFFFF", soft: "#EFEFF1", blue: "#212CB0", gold: "#EED467", title: "#151D2C", ink: "#1E1D1D", sub: "#43474C", white: "#FFFFFF" };
type Theme = typeof CARD_THEME;
const PAD = 96, VISUAL = 864;   // 텍스트 좌우 안전 여백 80~96px · 도식 그룹은 카드 너비의 80% 이내

/** Font size, weight, line height and lines of each field (디자인 정본 §3–4): the PNG and the preview cut at the same place. */
export const CARD_FIELD_STYLE: Record<string, { size: number; weight: number; leading: number; lines: number }> = {
  "cover.head": { size: 68, weight: 600, leading: 1.3, lines: 3 }, "cover.sub": { size: 30, weight: 400, leading: 1.5, lines: 2 },
  "item.title": { size: 52, weight: 600, leading: 1.3, lines: 2 }, "item.body": { size: 30, weight: 400, leading: 1.55, lines: 4 },
  "summary.line": { size: 52, weight: 600, leading: 1.3, lines: 3 },
  "pair.myth": { size: 36, weight: 500, leading: 1.4, lines: 2 }, "pair.fact": { size: 36, weight: 500, leading: 1.4, lines: 3 }, "pair.basis": { size: 26, weight: 400, leading: 1.5, lines: 2 },
  "line.text": { size: 52, weight: 600, leading: 1.35, lines: 4 }, "line.note": { size: 26, weight: 400, leading: 1.5, lines: 2 },
  "compare.title": { size: 52, weight: 600, leading: 1.3, lines: 2 }, "compare.leftLabel": { size: 24, weight: 500, leading: 1.3, lines: 1 }, "compare.rightLabel": { size: 24, weight: 500, leading: 1.3, lines: 1 },
  "compare.left": { size: 30, weight: 500, leading: 1.45, lines: 4 }, "compare.right": { size: 30, weight: 500, leading: 1.45, lines: 4 }, "compare.note": { size: 28, weight: 400, leading: 1.5, lines: 2 },
  "step.title": { size: 52, weight: 600, leading: 1.3, lines: 2 }, "step.body": { size: 30, weight: 400, leading: 1.55, lines: 4 },
  "map.center": { size: 40, weight: 500, leading: 1.3, lines: 2 }, "map.note": { size: 28, weight: 400, leading: 1.5, lines: 2 },
  "part.title": { size: 52, weight: 600, leading: 1.3, lines: 2 }, "part.body": { size: 30, weight: 400, leading: 1.55, lines: 4 },
  "end.line": { size: 52, weight: 600, leading: 1.3, lines: 3 }, "end.action": { size: 28, weight: 500, leading: 1.3, lines: 1 },
  "toon.episode": { size: 28, weight: 600, leading: 1.2, lines: 1 }, "toon.title": { size: 56, weight: 600, leading: 1.3, lines: 2 },
  "panel.narration": { size: 30, weight: 500, leading: 1.5, lines: 3 }, "panel.talk": { size: 32, weight: 500, leading: 1.45, lines: 3 },
  "panel.reply": { size: 32, weight: 500, leading: 1.45, lines: 3 }, "panel.think": { size: 32, weight: 500, leading: 1.45, lines: 3 },
  "panel.shout": { size: 46, weight: 600, leading: 1.25, lines: 2 },
};

// The MYIN wordmark (마이인_로고.ai, 2026-11-02) as paths, so it takes the card's colour in the browser and in next/og alike.
const LOGO: [string, string][] = [
  ["matrix(1,0,0,-1,48.7267,45.5048)", "M0 0C-2.325 0-4.26 .272-5.808 .81-7.357 1.348-8.585 2.173-9.487 3.293-10.394 4.412-11.03 5.852-11.394 7.618-11.758 9.383-11.943 11.47-11.943 13.877V38.729L-28.074 2.907H-29.367L-46.146 39.371V2.907H-48.727V45.505H-42.598L-27.107 11.943-11.943 45.505H-6.134V13.877C-6.134 9.965-5.64 6.884-4.651 4.651-3.657 2.413-2.108 1.293 0 1.293Z"],
  ["matrix(1,0,0,-1,68.1811,43.2446)", "M0 0-10.323 25.173C-10.97 26.809-11.904 28.031-13.132 28.851-14.36 29.667-15.789 30.161-17.425 30.335V31.628H-11.937C-10.003 31.628-8.4 31.172-7.128 30.27-5.862 29.368-4.879 28.096-4.194 26.461L3.162 8.585 11.296 30.982H14.524L1.94-3.548C1.293-5.314 .614-6.765-.092-7.905-.804-9.047-1.559-9.938-2.353-10.584-3.151-11.231-4.021-11.671-4.966-11.905-5.917-12.143-6.949-12.263-8.063-12.263H-10.003V-10.324C-9.057-10.324-8.15-10.231-7.292-10.035-6.433-9.84-5.645-9.497-4.933-9.003-4.227-8.508-3.569-7.819-2.966-6.938-2.363-6.053-1.804-4.923-1.288-3.548Z"],
  ["matrix(1,0,0,-1,98.1954,5.4875986)", "M0 0C0-.902-.266-1.614-.804-2.13-1.342-2.646-2.065-2.902-2.967-2.902-3.955-2.902-4.809-2.494-5.515-1.679-6.227-.859-6.58 .109-6.58 1.228-6.58 2.13-6.313 2.842-5.776 3.358-5.238 3.874-4.515 4.13-3.613 4.13-2.624 4.13-1.771 3.722-1.065 2.907-.353 2.087 0 1.119 0 0M.386-37.11H-5.422V-14.524C-5.422-12.584-5.689-11.024-6.227-9.84-6.765-8.661-8.003-8.069-9.938-8.069H-11.231V-6.775H-5.422C-4.303-6.775-3.369-6.873-2.613-7.069-1.858-7.259-1.255-7.65-.804-8.226-.353-8.808-.043-9.606 .13-10.617 .304-11.628 .386-12.932 .386-14.524Z"],
  ["matrix(1,0,0,-1,111.2301,20.0112)", "M0 0C0 1.94-.266 3.499-.804 4.684-1.342 5.863-2.581 6.455-4.515 6.455H-5.808V7.748H0C1.636 7.748 2.874 7.52 3.711 7.069 4.553 6.618 5.146 5.982 5.488 5.167H5.808C6.629 5.982 7.748 6.727 9.166 7.395 10.585 8.058 12.263 8.395 14.203 8.395 15.578 8.395 16.92 8.232 18.235 7.911 19.55 7.585 20.718 6.982 21.75 6.102 22.782 5.222 23.614 4.026 24.239 2.521 24.858 1.011 25.173-.902 25.173-3.222V-22.587H19.365V-3.222C19.365-1.636 19.158-.277 18.751 .842 18.343 1.961 17.805 2.864 17.137 3.553 16.469 4.238 15.719 4.733 14.877 5.037 14.04 5.336 13.171 5.488 12.263 5.488 10.976 5.488 9.78 5.145 8.683 4.456 7.585 3.765 6.629 2.972 5.808 2.07V-22.587H0Z"],
];
const Logo = ({ color, height }: { color: string; height: number }) => <svg width={Math.round(height * 136.403 / 55.5076)} height={height} viewBox="0 0 136.403 55.5076">
  {LOGO.map(([transform, d]) => <path key={transform} transform={transform} d={d} fill={color} />)}</svg>;

/** The words of one line, each split where the `*marked*` phrase starts or stops. */
function markedWords(line: string) {
  const words: { text: string; em: boolean }[][] = [[]];
  line.split(CARD_MARK).forEach((piece, at) => {
    for (const char of piece) {
      const word = words[words.length - 1];
      if (char === " ") { if (word.length) words.push([]); continue; }
      const last = word[word.length - 1];
      if (last?.em === (at % 2 === 1)) last.text += char; else word.push({ text: char, em: at % 2 === 1 });
    }
  });
  return words.filter(word => word.length);
}

type Tone = { color: string; accent: string };
function Field({ slide, name, tone, style }: { slide: CardSlide; name: string; tone: Tone; style?: CSSProperties }) {
  const value = slide.fields[name]?.trim();
  const spec = CARD_FIELD_STYLE[`${slide.type}.${name}`];
  if (!value || !spec) return null;
  const box: CSSProperties = { display: "flex", color: tone.color, fontSize: spec.size, fontWeight: spec.weight, lineHeight: spec.leading,
    maxHeight: Math.ceil(spec.size * spec.leading * spec.lines), overflow: "hidden", ...style };
  const centred = style?.textAlign === "center";
  if (!CARD_MARK.test(value) && !(centred && value.includes("\n"))) return <div data-card-field={name} style={{ ...box, wordBreak: "keep-all", whiteSpace: "pre-wrap" }}>{value}</div>;
  // Satori lays spans out as boxes, not inline text, so a field with a marked phrase is drawn word by word and still breaks between words;
  // centred text with its own line breaks goes the same way (Satori turns those breaks into spaces when the text is centred).
  return <div data-card-field={name} style={{ ...box, flexDirection: "column", ...(centred ? { alignItems: "center" } : {}) }}>{value.split("\n").map((line, at) =>
    <div key={at} style={{ display: "flex", flexWrap: "wrap", columnGap: Math.round(spec.size * 0.25), minHeight: Math.round(spec.size * spec.leading), ...(centred ? { justifyContent: "center" } : {}) }}>
      {markedWords(line).map((word, n) => <div key={n} style={{ display: "flex" }}>{word.map((part, k) => <span key={k} style={part.em ? { color: tone.accent } : undefined}>{part.text}</span>)}</div>)}</div>)}</div>;
}
const Label = ({ children, color }: { children: ReactNode; color: string }) =>
  <div style={{ display: "flex", fontSize: 24, fontWeight: 500, color, marginBottom: 16 }}>{children}</div>;
const Arrow = ({ color, size = 48 }: { color: string; size?: number }) => <div style={{ display: "flex", justifyContent: "center", padding: "16px 0" }}>
  <svg width={size * 0.75} height={size} viewBox="0 0 36 48"><path d="M18 4v38M6 30l12 12 12-12" fill="none" stroke={color} strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" /></svg></div>;
const Count = ({ n, color }: { n: number; color: string }) => <div style={{ display: "flex", fontSize: 36, fontWeight: 500, color, lineHeight: 1 }}>{String(n).padStart(2, "0")}</div>;

/** The PD's photo at its own ratio inside the 864px visual width; until its address is known (or in a list thumbnail) a grey box of the same size. */
function Photo({ photo, src, maxHeight, theme, style }: { photo?: CardPhoto; src?: string; maxHeight: number; theme: Theme; style?: CSSProperties }) {
  if (!photo) return null;
  const scale = Math.min(VISUAL / photo.w, maxHeight / photo.h), width = Math.round(photo.w * scale), height = Math.round(photo.h * scale);
  const box: CSSProperties = { display: "flex", alignSelf: "center", width, height, borderRadius: 16, ...style };
  // eslint-disable-next-line @next/next/no-img-element -- next/og draws plain <img>; next/image does not exist there.
  return src ? <img src={src} alt="" width={width} height={height} style={{ ...box, objectFit: "cover" }} /> : <div style={{ ...box, background: theme.soft }} />;
}

/** The titles of the body cards, in order: 정리 lists them and the 구조도 draws them as its branches. */
const bodyTitles = (draft: CardDraft, types: CardSlide["type"][]) =>
  draft.slides.filter(row => types.includes(row.type)).map(row => plainCardText(row.fields.title ?? "").trim()).filter(Boolean);
const countOf = (draft: CardDraft, index: number) => draft.slides.slice(0, index + 1).filter(row => row.type === draft.slides[index].type).length;

const ON_BLUE = new Set(["cover", "end"]);
function Body({ draft, slide, index, theme, src }: { draft: CardDraft; slide: CardSlide; index: number; theme: Theme; src?: string }) {
  const title = { color: theme.title, accent: theme.blue }, ink = { color: theme.ink, accent: theme.blue }, sub = { color: theme.sub, accent: theme.blue }, blue = { color: theme.white, accent: theme.gold };
  const f = (name: string, tone: Tone, style?: CSSProperties) => <Field slide={slide} name={name} tone={tone} style={style} />;
  const photo = (maxHeight: number) => <Photo photo={slide.photo} src={src} maxHeight={maxHeight} theme={theme} style={{ marginTop: 40 }} />;
  const after = slide.photo ? 48 : 40;   // 이미지 · 도식 → 약 40~64px → 설명
  const column: CSSProperties = { display: "flex", flexDirection: "column", flex: 1, justifyContent: "center" };
  const visual: CSSProperties = { display: "flex", flexDirection: "column", alignSelf: "center", width: VISUAL };
  const box = (background: string): CSSProperties => ({ display: "flex", flexDirection: "column", background, borderRadius: 24, padding: "36px 40px" });
  switch (slide.type) {
    case "cover": return <div style={column}>{f("head", blue)}{f("sub", blue, { marginTop: 40 })}{slide.photo ? <Photo photo={slide.photo} src={src} maxHeight={520} theme={theme} style={{ marginTop: 64 }} /> : null}</div>;
    case "item": return <div style={column}>
      <Count n={countOf(draft, index)} color={theme.blue} />{f("title", title, { marginTop: 32 })}{photo(480)}{f("body", ink, { marginTop: after })}</div>;
    // 전후 변화 도식: the common thought, then what is actually so, with the basis right under it.
    case "pair": return <div style={column}><div style={visual}>
      <div style={box(theme.soft)}><Label color={theme.sub}>흔한 생각</Label>{f("myth", sub)}</div>
      <Arrow color={theme.blue} />
      <div style={box(theme.blue)}><Label color={theme.white}>실제로는</Label>{f("fact", blue)}</div>
      {f("basis", sub, { marginTop: 48 })}</div></div>;
    // 병렬 항목: the one line first, then the body titles side by side in weight; only 단계 are joined by arrows (they are an order).
    case "summary": {
      const titles = bodyTitles(draft, ["item", "compare", "step"]), steps = draft.format === "steps";
      return <div style={column}>
        <Label color={theme.blue}>{draft.format === "webtoon" ? "오늘의 한 줄" : "정리"}</Label>{f("line", title)}
        {titles.length ? <div style={{ ...visual, marginTop: 56 }}>{titles.map((text, at) => <div key={at} style={{ display: "flex", flexDirection: "column" }}>
          {at && steps ? <Arrow color={theme.blue} size={28} /> : null}
          <div style={{ display: "flex", alignItems: "center", background: theme.paper, borderRadius: 20, padding: "24px 36px", marginTop: at && !steps ? 16 : 0 }}>
            <div style={{ display: "flex", width: 64, fontSize: 28, fontWeight: 500, color: theme.blue }}>{String(at + 1).padStart(2, "0")}</div>
            <div style={{ display: "flex", flex: 1, fontSize: 36, fontWeight: 500, lineHeight: 1.4, color: theme.title, wordBreak: "keep-all" }}>{text}</div></div></div>)}</div> : null}</div>;
    }
    case "line": return <div style={column}>{f("text", title)}{photo(520)}{f("note", sub, { marginTop: after })}</div>;
    // 차이 도식: one 기준, the two sides the same size side by side, the explanation under them.
    case "compare": return <div style={column}>{f("title", title)}
      <div style={{ ...visual, marginTop: 40 }}>
        <div style={{ display: "flex", gap: 24 }}>
          <div style={{ ...box(theme.soft), flex: 1, padding: "32px 32px" }}>{f("leftLabel", sub, { marginBottom: 16 })}{f("left", title)}</div>
          <div style={{ ...box(theme.blue), flex: 1, padding: "32px 32px" }}>{f("rightLabel", blue, { marginBottom: 16 })}{f("right", blue)}</div></div>
        {f("note", sub, { marginTop: 48 })}</div></div>;
    // 과정 도식: where this step sits in the whole, then the step, its photo and what to do.
    case "step": {
      const total = draft.slides.filter(row => row.type === "step").length, n = countOf(draft, index);
      return <div style={column}>
        <div style={{ display: "flex", alignItems: "center" }}>{Array.from({ length: total }, (_, at) => <div key={at} style={{ display: "flex", alignItems: "center" }}>
          {at ? <div style={{ display: "flex", width: 32, height: 4, background: theme.soft }} /> : null}
          <div style={{ display: "flex", width: 56, height: 56, borderRadius: 28, alignItems: "center", justifyContent: "center", fontSize: 24, fontWeight: 500,
            background: at + 1 === n ? theme.blue : theme.soft, color: at + 1 === n ? theme.white : theme.sub }}>{at + 1}</div></div>)}</div>
        {f("title", title, { marginTop: 48 })}{photo(440)}{f("body", ink, { marginTop: after })}</div>;
    }
    // 구성 요소 도식: the concept, and a branch to each 요소 card's name (the names come from those cards, so they always match).
    case "map": {
      const parts = bodyTitles(draft, ["part"]), line = `4px solid ${theme.blue}`;
      return <div style={column}><div style={visual}>
        <div style={{ ...box(theme.blue), alignSelf: "flex-start", padding: "28px 40px" }}>{f("center", blue)}</div>
        {parts.map((text, at) => <div key={at} style={{ display: "flex" }}>
          <div style={{ display: "flex", flexDirection: "column", width: 64, marginLeft: 40 }}>
            <div style={{ display: "flex", flex: 1, borderLeft: line, borderBottom: line }} /><div style={{ display: "flex", flex: 1, borderLeft: at < parts.length - 1 ? line : "none" }} /></div>
          <div style={{ display: "flex", flex: 1, alignItems: "center", background: theme.soft, borderRadius: 20, padding: "22px 32px", margin: "10px 0" }}>
            <div style={{ display: "flex", width: 60, fontSize: 28, fontWeight: 500, color: theme.blue }}>{String(at + 1).padStart(2, "0")}</div>
            <div style={{ display: "flex", flex: 1, fontSize: 36, fontWeight: 500, lineHeight: 1.4, color: theme.title, wordBreak: "keep-all" }}>{text}</div></div></div>)}
        {f("note", sub, { marginTop: 48 })}</div></div>;
    }
    case "part": {
      const center = plainCardText(draft.slides.find(row => row.type === "map")?.fields.center ?? "").trim();
      return <div style={column}>
        <div style={{ display: "flex", alignItems: "center", gap: 16 }}><Count n={countOf(draft, index)} color={theme.blue} />
          {center ? <div style={{ display: "flex", fontSize: 26, color: theme.sub }}>{center}</div> : null}</div>
        {f("title", title, { marginTop: 32 })}{photo(480)}{f("body", ink, { marginTop: after })}</div>;
    }
    case "end": return <div style={column}>
      {f("line", blue)}
      {slide.fields.action?.trim() ? <div style={{ display: "flex", marginTop: 56 }}>
        <div style={{ display: "flex", background: theme.white, borderRadius: 999, padding: "18px 36px" }}>{f("action", { color: theme.blue, accent: theme.blue })}</div></div> : null}</div>;
  }
}

// 웹툰형 (「웹툰형 캐릭터 설정」 2026-11-02; lettering from the owner's 말풍선 · 멘트 · 효과음 references, 2026-11-02): the picture fills
// the card and the words sit on it the way webtoons letter them — not their shapes, the genre's habits. 해설 sits in a double-ruled
// hexagon, 대사 in thin-lined ovals with a tail toward the speaker, 속마음 in an oval ringed with spikes, 외침 in a ragged burst, and
// 효과음 is big tilted letters stepping up and down. Bubble letters keep the 디자인 정본 (Pretendard on white); only the 효과음 carries a
// white edge, like the picture it is part of.
const W = CARD_SIZE.width, H = CARD_SIZE.height, LINE = 3;
// ponytail: fixed shapes sized for the letter limits (외침 14, 속마음 30); shapes that follow the text if those limits grow.
const ring = (count: number, cx: number, cy: number, rx: number, ry: number, radius: (at: number) => number) => Array.from({ length: count }, (_, at) => {
  const angle = (at / count) * Math.PI * 2, r = radius(at);
  return [Math.round(cx + Math.cos(angle) * rx * r), Math.round(cy + Math.sin(angle) * ry * r)] as const;
});
// A ragged burst: uneven points, so it reads as drawn rather than as a star.
const BURST = ring(22, 270, 150, 258, 140, at => at % 2 ? 0.74 + (at * 37 % 11) / 100 : 1 - (at * 53 % 7) / 100).map(point => point.join(",")).join(" ");
// Spikes round an oval: short strokes pointing out from its edge.
// A double-ruled hexagon round the 해설, as tall as the lines its text takes (Satori cannot size a picture to the text).
function Hexagon({ slide, width, theme, children }: { slide: CardSlide; width: number; theme: Theme; children: ReactNode }) {
  const spec = CARD_FIELD_STYLE["panel.narration"], perLine = Math.floor((width - 150) / (spec.size * 0.95));
  const lines = Math.min(spec.lines, plainCardText(slide.fields.narration ?? "").trim().split("\n").reduce((sum, line) => sum + Math.max(1, Math.ceil([...line].length / perLine)), 0));
  const height = Math.round(lines * spec.size * spec.leading) + 60, cut = Math.min(44, height / 2);
  const points = (inset: number) => [[cut + inset, inset], [width - cut - inset, inset], [width - inset, height / 2], [width - cut - inset, height - inset], [cut + inset, height - inset], [inset, height / 2]].map(point => point.join(",")).join(" ");
  return <div style={{ display: "flex", position: "absolute", left: 56, top: 56, width, height, alignItems: "center", justifyContent: "center", padding: "0 72px" }}>
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} style={{ position: "absolute", left: 0, top: 0 }}>
      <polygon points={points(2)} fill={theme.white} stroke={theme.title} strokeWidth={LINE} strokeLinejoin="round" />
      <polygon points={points(10)} fill="none" stroke={theme.title} strokeWidth={2} strokeLinejoin="round" /></svg>
    {children}</div>;
}
const SPIKES = ring(84, 270, 165, 222, 128, () => 1).map(([x, y], at) => {
  const dx = x - 270, dy = y - 165, length = Math.hypot(dx, dy), reach = at % 3 ? 16 : 30;
  return `M${x} ${y}L${Math.round(x + dx / length * reach)} ${Math.round(y + dy / length * reach)}`;
}).join("");
// The 효과음's white edge: eight hard shadows round each letter (no blur, so it is an edge, not a glow).
const EDGE = [[5, 0], [-5, 0], [0, 5], [0, -5], [4, 4], [-4, 4], [4, -4], [-4, -4]].map(([x, y]) => `${x}px ${y}px 0 #FFFFFF`).join(", ");
function ToonSlide({ draft, slide, index, theme, src }: { draft: CardDraft; slide: CardSlide; index: number; theme: Theme; src?: string }) {
  const ink = { color: theme.title, accent: theme.blue };
  const f = (name: string, style?: CSSProperties) => <Field slide={slide} name={name} tone={ink} style={style} />;
  const has = (name: string) => slide.type === "panel" && Boolean(slide.fields[name]?.trim());
  const full: CSSProperties = { position: "absolute", left: 0, top: 0, width: W, height: H };
  // Satori places an absolute box by its left edge and an explicit width only, so everything on the right sits in a row of the
  // card's width pushed to its end.
  const row = (edge: { top: number } | { bottom: number }, end = false): CSSProperties => ({ display: "flex", position: "absolute", left: 56, width: W - 112, ...edge, justifyContent: end ? "flex-end" : "flex-start" });
  const centred: CSSProperties = { textAlign: "center", justifyContent: "center" };
  // An oval with a tail toward whoever speaks (left: the one in front, right: the one answering).
  const bubble = (name: string, side: "left" | "right") => <div style={{ display: "flex", flexDirection: "column", alignItems: side === "left" ? "flex-start" : "flex-end" }}>
    <div style={{ display: "flex", maxWidth: 620, background: theme.white, border: `${LINE}px solid ${theme.title}`, borderRadius: "50%", padding: "40px 70px", ...centred }}>{f(name, centred)}</div>
    <svg width={46} height={48} viewBox="0 0 46 48" style={{ marginTop: -LINE - 2, ...(side === "left" ? { marginLeft: 120 } : { marginRight: 120 }) }}>
      <path d={side === "left" ? "M6 0 L4 46 L40 0" : "M40 0 L42 46 L6 0"} fill={theme.white} stroke={theme.title} strokeWidth={LINE} strokeLinejoin="round" /></svg></div>;
  const think = has("think"), shoutTop = think ? 430 : 300;
  return <>
    {/* eslint-disable-next-line @next/next/no-img-element -- next/og draws plain <img>; next/image does not exist there. */}
    {src ? <img src={src} alt="" width={W} height={H} style={{ ...full, objectFit: "cover" }} />
      : <div style={{ ...full, display: "flex", alignItems: "center", justifyContent: "center", padding: PAD, background: theme.soft, color: theme.sub, fontSize: 28, lineHeight: 1.5, textAlign: "center" }}>
        {slide.photo ? "" : `그림 자리 · ${plainCardText(slide.fields.scene ?? "").trim().slice(0, 90) || "장면을 쓰고 「AI로 그리기」로 그려요"}`}</div>}
    {slide.type === "toon" ? <div style={{ display: "flex", flexDirection: "column", position: "absolute", left: 64, bottom: 128, maxWidth: 800, background: theme.white, borderRadius: 24, padding: "32px 44px" }}>
      {f("episode", { color: theme.blue, marginBottom: 12 })}{f("title")}</div> : null}
    {has("narration") ? <Hexagon slide={slide} width={think ? 440 : 760} theme={theme}>{f("narration", centred)}</Hexagon> : null}
    {think ? <div style={row({ top: 40 }, true)}><div style={{ display: "flex", position: "relative", width: 540, height: 330, alignItems: "center", justifyContent: "center" }}>
      <svg width={540} height={330} viewBox="0 0 540 330" style={{ position: "absolute", left: 0, top: 0 }}>
        <path d={SPIKES} stroke={theme.white} strokeWidth={10} strokeLinecap="round" /><path d={SPIKES} stroke={theme.title} strokeWidth={4} strokeLinecap="round" />
        <ellipse cx={270} cy={165} rx={224} ry={130} fill={theme.white} /></svg>
      {f("think", { ...centred, maxWidth: 330 })}</div></div> : null}
    {has("shout") ? <div style={row({ top: shoutTop }, true)}><div style={{ display: "flex", position: "relative", width: 540, height: 300, alignItems: "center", justifyContent: "center" }}>
      <svg width={540} height={300} viewBox="0 0 540 300" style={{ position: "absolute", left: 0, top: 0 }}><polygon points={BURST} fill={theme.white} stroke={theme.title} strokeWidth={LINE} strokeLinejoin="round" /></svg>
      {f("shout", { ...centred, maxWidth: 320, transform: "skewX(-8deg)" })}</div></div> : null}
    {has("sfx") ? <div data-card-field="sfx" style={{ display: "flex", position: "absolute", left: 72, top: 600, transform: "rotate(-10deg)", alignItems: "flex-start" }}>
      {[...plainCardText(slide.fields.sfx ?? "").trim()].slice(0, 8).map((letter, at) => <span key={at} style={{ display: "flex", fontSize: 112, fontWeight: 600, lineHeight: 1, color: theme.title,
        textShadow: EDGE, marginTop: at % 2 ? 46 : 0, marginLeft: at ? -6 : 0, transform: `skewX(-10deg) rotate(${at % 2 ? 6 : -4}deg)` }}>{letter}</span>)}</div> : null}
    {has("reply") ? <div style={row({ bottom: has("talk") ? 400 : 130 }, true)}>{bubble("reply", "right")}</div> : null}
    {has("talk") ? <div style={row({ bottom: 130 })}>{bubble("talk", "left")}</div> : null}
    <div style={row({ bottom: 40 }, true)}><div style={{ display: "flex", alignItems: "center", gap: 14, background: theme.white, borderRadius: 999, padding: "10px 22px", fontSize: 16, color: theme.sub }}>
      <Logo color={theme.title} height={20} /><span>{`${index + 1} / ${draft.slides.length}`}</span></div></div>
  </>;
}

/** Card `index` of `draft` at 1080 × 1350; `photos` maps a photo's path to an address the drawing can load (a signed URL, or a data URL in the PNG). */
export function CardSlideView({ draft, index, photos, theme = CARD_THEME }: { draft: CardDraft; index: number; photos?: Record<string, string>; theme?: Theme }) {
  const slide = draft.slides[index];
  const onBlue = ON_BLUE.has(slide?.type ?? "");
  if (slide?.type === "toon" || slide?.type === "panel") return <div style={{ display: "flex", position: "relative", overflow: "hidden", width: W, height: H, background: theme.soft, fontFamily: "Pretendard" }}>
    <ToonSlide draft={draft} slide={slide} index={index} theme={theme} src={slide.photo ? photos?.[slide.photo.path] : undefined} /></div>;
  return <div style={{ display: "flex", flexDirection: "column", position: "relative", boxSizing: "border-box", width: CARD_SIZE.width, height: CARD_SIZE.height, padding: `128px ${PAD}px 160px`,
    background: onBlue ? theme.blue : slide?.type === "summary" ? theme.soft : theme.paper, color: theme.ink, fontFamily: "Pretendard" }}>
    {slide ? <Body draft={draft} slide={slide} index={index} theme={theme} src={slide.photo ? photos?.[slide.photo.path] : undefined} /> : null}
    <div style={{ display: "flex", position: "absolute", left: PAD, right: PAD, bottom: 64, justifyContent: "space-between", alignItems: "center", fontSize: 16, color: onBlue ? theme.white : theme.sub }}>
      <Logo color={onBlue ? theme.white : theme.title} height={28} /><span>{`${index + 1} / ${draft.slides.length}`}</span></div>
  </div>;
}
