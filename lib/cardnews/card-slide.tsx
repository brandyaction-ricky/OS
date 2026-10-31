// One card of a 카드뉴스 (content centred top to bottom), drawn the same way in the browser preview and in the PNG (next/og). Satori reads only flex layouts and
// inline styles, so every box with more than one child is display:flex and nothing here uses hooks, classes or grid.
// Each text field has a fixed number of lines: past it the text is cut, and the editor marks that field (data-card-field) as 넘침.
import type { CSSProperties, ReactNode } from "react";
import { CARD_SIZE, type CardDraft, type CardSlide } from "./formats.ts";

/** ponytail: one theme until the owner picks the account (브랜디액션 / 마이인); a theme is just these values. */
export const CARD_THEME = { bg: "#F6F4EF", ink: "#16181D", sub: "#5B606B", accent: "#2F5BFF", line: "#DAD6CC", brand: "BRANDYACTION" };
type Theme = typeof CARD_THEME;

/** Font size, line height and lines of each field: the PNG and the preview cut at the same place. */
export const CARD_FIELD_STYLE: Record<string, { size: number; weight: number; leading: number; lines: number }> = {
  "cover.head": { size: 76, weight: 800, leading: 1.25, lines: 3 }, "cover.sub": { size: 40, weight: 400, leading: 1.45, lines: 2 },
  "item.title": { size: 56, weight: 700, leading: 1.3, lines: 2 }, "item.body": { size: 40, weight: 400, leading: 1.5, lines: 4 },
  "summary.line": { size: 50, weight: 800, leading: 1.35, lines: 2 },
  "pair.myth": { size: 46, weight: 600, leading: 1.35, lines: 2 }, "pair.fact": { size: 46, weight: 700, leading: 1.45, lines: 3 }, "pair.basis": { size: 30, weight: 400, leading: 1.45, lines: 2 },
  "line.text": { size: 64, weight: 700, leading: 1.4, lines: 4 }, "line.note": { size: 34, weight: 400, leading: 1.5, lines: 2 },
  "end.line": { size: 54, weight: 800, leading: 1.35, lines: 2 }, "end.action": { size: 36, weight: 700, leading: 1.3, lines: 1 },
};

function Field({ slide, name, style, theme }: { slide: CardSlide; name: string; style?: CSSProperties; theme: Theme }) {
  const value = slide.fields[name]?.trim();
  const spec = CARD_FIELD_STYLE[`${slide.type}.${name}`];
  if (!value || !spec) return null;
  return <div data-card-field={name} style={{ display: "flex", wordBreak: "keep-all", color: theme.ink, fontSize: spec.size, fontWeight: spec.weight, lineHeight: spec.leading,
    letterSpacing: spec.size >= 46 ? "-0.02em" : "0", whiteSpace: "pre-wrap", maxHeight: Math.ceil(spec.size * spec.leading * spec.lines), overflow: "hidden", ...style }}>{value}</div>;
}
const Label = ({ children, color }: { children: ReactNode; color: string }) =>
  <div style={{ display: "flex", fontSize: 28, fontWeight: 700, color, letterSpacing: "0.04em", marginBottom: 20 }}>{children}</div>;

function Body({ draft, slide, index, theme }: { draft: CardDraft; slide: CardSlide; index: number; theme: Theme }) {
  const f = (name: string, style?: CSSProperties) => <Field slide={slide} name={name} style={style} theme={theme} />;
  switch (slide.type) {
    case "cover": return <div style={{ display: "flex", flexDirection: "column", flex: 1, justifyContent: "center" }}>
      <div style={{ display: "flex", width: 96, height: 10, background: theme.accent, marginBottom: 56 }} />{f("head")}{f("sub", { color: theme.sub, marginTop: 40 })}</div>;
    case "item": {
      const number = draft.slides.slice(0, index + 1).filter(row => row.type === "item").length;
      return <div style={{ display: "flex", flexDirection: "column", flex: 1, justifyContent: "center" }}>
        <div style={{ display: "flex", fontSize: 120, fontWeight: 800, color: theme.accent, lineHeight: 1 }}>{String(number).padStart(2, "0")}</div>
        {f("title", { marginTop: 48 })}{f("body", { marginTop: 36 })}</div>;
    }
    case "pair": return <div style={{ display: "flex", flexDirection: "column", flex: 1, justifyContent: "center" }}>
      <Label color={theme.sub}>흔한 생각</Label>{f("myth", { color: theme.sub })}
      <div style={{ display: "flex", height: 2, background: theme.line, margin: "56px 0" }} />
      <Label color={theme.accent}>실제로는</Label>{f("fact")}{f("basis", { color: theme.sub, marginTop: 32 })}</div>;
    case "summary": {
      const titles = draft.slides.filter(row => row.type === "item").map(row => row.fields.title?.trim()).filter(Boolean);
      return <div style={{ display: "flex", flexDirection: "column", flex: 1, justifyContent: "center" }}>
        <Label color={theme.accent}>정리</Label>
        {titles.map((title, at) => <div key={at} style={{ display: "flex", fontSize: 36, fontWeight: 600, lineHeight: 1.4, color: theme.ink, padding: "14px 0", borderBottom: `2px solid ${theme.line}`, wordBreak: "keep-all" }}>
          {`${String(at + 1).padStart(2, "0")}  ${title}`}</div>)}
        {f("line", { marginTop: titles.length ? 64 : 0 })}</div>;
    }
    case "line": return <div style={{ display: "flex", flexDirection: "column", flex: 1, justifyContent: "center" }}>{f("text")}{f("note", { color: theme.sub, marginTop: 40 })}</div>;
    case "end": return <div style={{ display: "flex", flexDirection: "column", flex: 1, justifyContent: "center" }}>
      {f("line")}
      {slide.fields.action?.trim() ? <div style={{ display: "flex", marginTop: 56 }}>
        <div style={{ display: "flex", background: theme.accent, borderRadius: 999, padding: "20px 40px" }}>{f("action", { color: "#FFFFFF" })}</div></div> : null}</div>;
  }
}

/** Card `index` of `draft` at 1080 × 1350. */
export function CardSlideView({ draft, index, theme = CARD_THEME }: { draft: CardDraft; index: number; theme?: Theme }) {
  const slide = draft.slides[index];
  return <div style={{ display: "flex", flexDirection: "column", position: "relative", boxSizing: "border-box", width: CARD_SIZE.width, height: CARD_SIZE.height, padding: "120px 80px 140px",
    background: theme.bg, color: theme.ink, fontFamily: "Pretendard" }}>
    {slide ? <Body draft={draft} slide={slide} index={index} theme={theme} /> : null}
    <div style={{ display: "flex", position: "absolute", left: 80, right: 80, bottom: 60, justifyContent: "space-between", fontSize: 26, color: theme.sub, letterSpacing: "0.04em" }}>
      <span>{theme.brand}</span><span>{`${index + 1} / ${draft.slides.length}`}</span></div>
  </div>;
}
