// 썸네일 합성 틀: one component draws the thumbnail both on screen (the 기획안 picker, the 제작 editor) and as the final PNG (next/og on the
// server), so what the PD picks and edits is what goes up. Only styles next/og understands (flex, absolute positions, px sizes,
// transform, filter brightness, overflow hidden — checked on its renderer 2026-11-11).
import { cleanThumbEdit, thumbAccentParts, thumbLayout, type ThumbCopy, type ThumbEdit, type ThumbExtraColor, type ThumbStyle } from "./thumb-style.ts";

const EXTRA_COLOR = (style: ThumbStyle): Record<ThumbExtraColor, { color: string; band?: string }> => ({
  ink: { color: style.title.ink }, accent: { color: style.title.accent }, red: { color: "#D92B2B" }, white: { color: "#FFFFFF", band: style.title.ink },
});

export function ThumbFrame({ style, image, copy, edit: raw }: { style: ThumbStyle; image?: string | null; copy: ThumbCopy; edit?: ThumbEdit }) {
  const edit = cleanThumbEdit(raw, style);
  const layout = thumbLayout(copy, style, edit), t = style.title;
  const photo = edit.photo, extraColor = EXTRA_COLOR(style);
  return (
    <div style={{ width: style.width, height: style.height, display: "flex", position: "relative", overflow: "hidden", background: style.background }}>
      {image ? (
        // The picture never runs behind the title: moved or enlarged, it is cut at the title's top line.
        <div style={{ position: "absolute", left: 0, top: 0, width: style.width, height: layout.titleTop, display: "flex", overflow: "hidden" }}>
          {/* eslint-disable-next-line @next/next/no-img-element -- the same element is drawn by next/og, which takes no Image component */}
          <img src={image} alt="" width={style.width} height={layout.subjectBox.height}
            style={{ position: "absolute", left: 0, top: layout.subjectBox.top, width: style.width, height: layout.subjectBox.height, objectFit: "contain",
              ...(photo ? { transform: `translate(${photo.x}px, ${photo.y}px) scale(${photo.scale})`, filter: `brightness(${photo.brightness})` } : {}) }} />
        </div>
      ) : null}
      <div style={{ position: "absolute", left: t.sidePx, right: t.sidePx, top: layout.titleTop, display: "flex", flexDirection: "column", alignItems: "center" }}>
        {layout.lines.map((line, i) => (
          <div key={i} style={{ display: "flex", fontFamily: "Pretendard", fontWeight: t.weight, fontSize: layout.size, lineHeight: t.lineHeight,
            letterSpacing: Math.round(t.tracking * layout.size * 10) / 10, color: t.ink, whiteSpace: "pre" }}>
            {thumbAccentParts(line, copy.accent).map((part, j) => <span key={j} style={{ color: part.accent ? t.accent : t.ink }}>{part.text}</span>)}
          </div>
        ))}
      </div>
      {(edit.extras ?? []).map((extra) => (
        <div key={extra.id} style={{ position: "absolute", left: extra.x, top: extra.y, display: "flex", fontFamily: "Pretendard", fontWeight: t.weight, fontSize: extra.size,
          lineHeight: t.lineHeight, letterSpacing: Math.round(t.tracking * extra.size * 10) / 10, whiteSpace: "pre", color: extraColor[extra.color].color,
          ...(extraColor[extra.color].band ? { background: extraColor[extra.color].band, padding: `0 ${Math.round(extra.size * 0.2)}px`, borderRadius: Math.round(extra.size * 0.12) } : {}) }}>
          {extra.text}
        </div>
      ))}
    </div>
  );
}
