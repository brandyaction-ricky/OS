// 썸네일 합성 틀: one component draws the thumbnail both on screen (the 기획안 picker) and as the final PNG (next/og on the server), so
// what the PD picks is what goes up. Only styles next/og understands (flex, absolute positions, px sizes).
import { thumbAccentParts, thumbLayout, type ThumbCopy, type ThumbStyle } from "./thumb-style.ts";

export function ThumbFrame({ style, image, copy }: { style: ThumbStyle; image?: string | null; copy: ThumbCopy }) {
  const layout = thumbLayout(copy, style), t = style.title;
  return (
    <div style={{ width: style.width, height: style.height, display: "flex", position: "relative", overflow: "hidden", background: style.background }}>
      {image ? (
        // eslint-disable-next-line @next/next/no-img-element -- the same element is drawn by next/og, which takes no Image component
        <img src={image} alt="" width={style.width} height={layout.subjectBox.height}
          style={{ position: "absolute", left: 0, top: layout.subjectBox.top, width: style.width, height: layout.subjectBox.height, objectFit: "contain" }} />
      ) : null}
      <div style={{ position: "absolute", left: t.sidePx, right: t.sidePx, top: layout.titleTop, display: "flex", flexDirection: "column", alignItems: "center" }}>
        {layout.lines.map((line, i) => (
          <div key={i} style={{ display: "flex", fontFamily: "Pretendard", fontWeight: t.weight, fontSize: layout.size, lineHeight: t.lineHeight,
            letterSpacing: Math.round(t.tracking * layout.size * 10) / 10, color: t.ink, whiteSpace: "pre" }}>
            {thumbAccentParts(line, copy.accent).map((part, j) => <span key={j} style={{ color: part.accent ? t.accent : t.ink }}>{part.text}</span>)}
          </div>
        ))}
      </div>
    </div>
  );
}
