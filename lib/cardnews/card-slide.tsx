// One card of a 카드뉴스 (content centred top to bottom), drawn the same way in the browser preview and in the PNG (next/og). Satori reads only flex layouts and
// inline styles, so every box with more than one child is display:flex and nothing here uses hooks, classes or grid.
// Each text field has a fixed number of lines: past it the text is cut, and the editor marks that field (data-card-field) as 넘침.
// The look is the MYIN 카드뉴스 디자인 정본 (2026-11-02): white body cards, a blue cover and ending, Pretendard 400 · 500 · 600 at its
// sizes for 1080 × 1350, 96px text margins, diagrams within 80% of the width, and the explanation right under what it explains.
import type { CSSProperties, ReactNode } from "react";
import { CARD_MARK, CARD_SIZE, plainCardText, type CardDraft, type CardSlide } from "./formats.ts";

/** 디자인 정본 §2. Blue cards carry white text and gold only for the marked phrase; gold never sits on a light card. */
export const CARD_THEME = { paper: "#FFFFFF", soft: "#EFEFF1", blue: "#212CB0", gold: "#EED467", title: "#151D2C", ink: "#1E1D1D", sub: "#43474C", white: "#FFFFFF", brand: "MYIN" };
type Theme = typeof CARD_THEME;
const PAD = 96, VISUAL = 864;   // 텍스트 좌우 안전 여백 80~96px · 도식 그룹은 카드 너비의 80% 이내

/** Font size, weight, line height and lines of each field (디자인 정본 §3–4): the PNG and the preview cut at the same place. */
export const CARD_FIELD_STYLE: Record<string, { size: number; weight: number; leading: number; lines: number }> = {
  "cover.head": { size: 68, weight: 600, leading: 1.3, lines: 3 }, "cover.sub": { size: 30, weight: 400, leading: 1.5, lines: 2 },
  "item.title": { size: 52, weight: 600, leading: 1.3, lines: 2 }, "item.body": { size: 30, weight: 400, leading: 1.55, lines: 4 },
  "summary.line": { size: 52, weight: 600, leading: 1.3, lines: 3 },
  "pair.myth": { size: 36, weight: 500, leading: 1.4, lines: 2 }, "pair.fact": { size: 36, weight: 500, leading: 1.4, lines: 3 }, "pair.basis": { size: 26, weight: 400, leading: 1.5, lines: 2 },
  "line.text": { size: 52, weight: 600, leading: 1.35, lines: 4 }, "line.note": { size: 26, weight: 400, leading: 1.5, lines: 2 },
  "end.line": { size: 52, weight: 600, leading: 1.3, lines: 3 }, "end.action": { size: 28, weight: 500, leading: 1.3, lines: 1 },
};

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
  if (!CARD_MARK.test(value)) return <div data-card-field={name} style={{ ...box, wordBreak: "keep-all", whiteSpace: "pre-wrap" }}>{value}</div>;
  // Satori lays spans out as boxes, not inline text, so a field with a marked phrase is drawn word by word and still breaks between words.
  return <div data-card-field={name} style={{ ...box, flexDirection: "column" }}>{value.split("\n").map((line, at) =>
    <div key={at} style={{ display: "flex", flexWrap: "wrap", columnGap: Math.round(spec.size * 0.25), minHeight: Math.round(spec.size * spec.leading) }}>
      {markedWords(line).map((word, n) => <div key={n} style={{ display: "flex" }}>{word.map((part, k) => <span key={k} style={part.em ? { color: tone.accent } : undefined}>{part.text}</span>)}</div>)}</div>)}</div>;
}
const Label = ({ children, color }: { children: ReactNode; color: string }) =>
  <div style={{ display: "flex", fontSize: 24, fontWeight: 500, color, marginBottom: 16 }}>{children}</div>;
const Arrow = ({ color }: { color: string }) => <div style={{ display: "flex", justifyContent: "center", padding: "20px 0" }}>
  <svg width="36" height="48" viewBox="0 0 36 48"><path d="M18 4v38M6 30l12 12 12-12" fill="none" stroke={color} strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" /></svg></div>;

const ON_BLUE = new Set(["cover", "end"]);
function Body({ draft, slide, index, theme }: { draft: CardDraft; slide: CardSlide; index: number; theme: Theme }) {
  const title = { color: theme.title, accent: theme.blue }, ink = { color: theme.ink, accent: theme.blue }, sub = { color: theme.sub, accent: theme.blue }, blue = { color: theme.white, accent: theme.gold };
  const f = (name: string, tone: Tone, style?: CSSProperties) => <Field slide={slide} name={name} tone={tone} style={style} />;
  const column: CSSProperties = { display: "flex", flexDirection: "column", flex: 1, justifyContent: "center" };
  const visual: CSSProperties = { display: "flex", flexDirection: "column", alignSelf: "center", width: VISUAL };
  switch (slide.type) {
    case "cover": return <div style={column}>{f("head", blue)}{f("sub", blue, { marginTop: 40 })}</div>;
    case "item": {
      const number = draft.slides.slice(0, index + 1).filter(row => row.type === "item").length;
      return <div style={column}>
        <div style={{ display: "flex", fontSize: 36, fontWeight: 500, color: theme.blue, lineHeight: 1 }}>{String(number).padStart(2, "0")}</div>
        {f("title", title, { marginTop: 32 })}{f("body", ink, { marginTop: 40 })}</div>;
    }
    // 전후 변화 도식: the common thought, then what is actually so, with the basis right under it.
    case "pair": return <div style={column}><div style={visual}>
      <div style={{ display: "flex", flexDirection: "column", background: theme.soft, borderRadius: 24, padding: "36px 40px" }}><Label color={theme.sub}>흔한 생각</Label>{f("myth", sub)}</div>
      <Arrow color={theme.blue} />
      <div style={{ display: "flex", flexDirection: "column", background: theme.blue, borderRadius: 24, padding: "36px 40px" }}><Label color={theme.white}>실제로는</Label>{f("fact", blue)}</div>
      {f("basis", sub, { marginTop: 48 })}</div></div>;
    // 병렬 항목: the one line first, then the item titles side by side in weight (no arrows: they are not steps).
    case "summary": {
      const titles = draft.slides.filter(row => row.type === "item").map(row => plainCardText(row.fields.title ?? "").trim()).filter(Boolean);
      return <div style={column}>
        <Label color={theme.blue}>정리</Label>{f("line", title)}
        {titles.length ? <div style={{ ...visual, marginTop: 56 }}>{titles.map((text, at) => <div key={at} style={{ display: "flex", alignItems: "center", background: theme.paper, borderRadius: 20, padding: "24px 36px", marginTop: at ? 16 : 0 }}>
          <div style={{ display: "flex", width: 64, fontSize: 28, fontWeight: 500, color: theme.blue }}>{String(at + 1).padStart(2, "0")}</div>
          <div style={{ display: "flex", flex: 1, fontSize: 36, fontWeight: 500, lineHeight: 1.4, color: theme.title, wordBreak: "keep-all" }}>{text}</div></div>)}</div> : null}</div>;
    }
    case "line": return <div style={column}>{f("text", title)}{f("note", sub, { marginTop: 40 })}</div>;
    case "end": return <div style={column}>
      {f("line", blue)}
      {slide.fields.action?.trim() ? <div style={{ display: "flex", marginTop: 56 }}>
        <div style={{ display: "flex", background: theme.white, borderRadius: 999, padding: "18px 36px" }}>{f("action", { color: theme.blue, accent: theme.blue })}</div></div> : null}</div>;
  }
}

/** Card `index` of `draft` at 1080 × 1350. */
export function CardSlideView({ draft, index, theme = CARD_THEME }: { draft: CardDraft; index: number; theme?: Theme }) {
  const slide = draft.slides[index];
  const onBlue = ON_BLUE.has(slide?.type ?? "");
  return <div style={{ display: "flex", flexDirection: "column", position: "relative", boxSizing: "border-box", width: CARD_SIZE.width, height: CARD_SIZE.height, padding: `128px ${PAD}px 160px`,
    background: onBlue ? theme.blue : slide?.type === "summary" ? theme.soft : theme.paper, color: theme.ink, fontFamily: "Pretendard" }}>
    {slide ? <Body draft={draft} slide={slide} index={index} theme={theme} /> : null}
    <div style={{ display: "flex", position: "absolute", left: PAD, right: PAD, bottom: 64, justifyContent: "space-between", alignItems: "center", fontSize: 16, color: onBlue ? theme.white : theme.sub }}>
      <span style={{ fontSize: 20, fontWeight: 600, color: onBlue ? theme.white : theme.blue }}>{theme.brand}</span><span>{`${index + 1} / ${draft.slides.length}`}</span></div>
  </div>;
}
