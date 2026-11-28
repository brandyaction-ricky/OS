// 썸네일 합성 틀: one component draws the thumbnail both on screen (the 기획안 picker, the 제작 editor) and as the final PNG (next/og on the
// server), so what the PD picks and edits is what goes up. Only styles next/og understands (flex, absolute positions, px sizes,
// filter brightness, overflow hidden — checked on its renderer 2026-11-11). The picture's place is worked out in thumbLayout.
import { cleanThumbEdit, THUMB_COLLAGE, THUMB_PERSON, thumbAccentParts, thumbLayout, type ThumbCopy, type ThumbEdit, type ThumbExtraColor, type ThumbStyle, type ThumbSubject } from "./thumb-style.ts";

const EXTRA_COLOR = (style: ThumbStyle): Record<ThumbExtraColor, { color: string; band?: string }> => ({
  ink: { color: style.title.ink }, accent: { color: style.title.accent }, red: { color: "#D92B2B" }, white: { color: "#FFFFFF", band: style.title.ink },
});

/** collageAssets: the noise tile and the silhouette — their public addresses on screen, data URLs where next/og draws the PNG. */
export function ThumbFrame({ style, image, copy, edit: raw, subject, titleFamily = "Pretendard", collageAssets }: { style: ThumbStyle; image?: string | null; copy: ThumbCopy; edit?: ThumbEdit;
  subject?: ThumbSubject | null; titleFamily?: string; collageAssets?: { noise: string; silhouette: string } }) {
  const edit = cleanThumbEdit(raw, style);
  const layout = thumbLayout(copy, style, edit, subject), t = style.title;
  const box = layout.photoBox, extraColor = EXTRA_COLOR(style);
  if (layout.collage) return <CollageFrame style={style} image={image} copy={copy} edit={edit} layout={layout} titleFamily={titleFamily} extraColor={extraColor}
    assets={collageAssets ?? { noise: THUMB_COLLAGE.noise.src, silhouette: THUMB_COLLAGE.silhouette.src }} />;
  if (layout.person) return <PersonFrame style={style} image={image} edit={edit} layout={layout} titleFamily={titleFamily} extraColor={extraColor} />;
  return (
    <div style={{ width: style.width, height: style.height, display: "flex", position: "relative", overflow: "hidden", background: style.background }}>
      {image ? (
        // The picture never runs behind the title: moved or enlarged, it is cut just above the title's letters.
        <div style={{ position: "absolute", left: 0, top: 0, width: style.width, height: layout.clipBottom, display: "flex", overflow: "hidden" }}>
          {/* eslint-disable-next-line @next/next/no-img-element -- the same element is drawn by next/og, which takes no Image component */}
          <img src={image} alt="" width={box.width} height={box.height}
            style={{ position: "absolute", left: box.left, top: box.top, width: box.width, height: box.height, objectFit: "contain",
              ...(edit.photo ? { filter: `brightness(${edit.photo.brightness})` } : {}) }} />
        </div>
      ) : null}
      <div style={{ position: "absolute", left: t.sidePx, right: t.sidePx, top: layout.titleTop, display: "flex", flexDirection: "column", alignItems: "center" }}>
        {layout.lines.map((line, i) => (
          <div key={i} style={{ display: "flex", fontFamily: titleFamily, fontWeight: t.weight, fontSize: layout.size, lineHeight: t.lineHeight,
            letterSpacing: Math.round(t.tracking * layout.size * 10) / 10, color: t.ink, whiteSpace: "pre" }}>
            {thumbAccentParts(line, copy.accent).map((part, j) => <span key={j} style={{ color: part.accent ? t.accent : t.ink }}>{part.text}</span>)}
          </div>
        ))}
      </div>
      {(edit.extras ?? []).map((extra) => (
        <div key={extra.id} style={{ position: "absolute", left: extra.x, top: extra.y, display: "flex", fontFamily: titleFamily, fontWeight: t.weight, fontSize: extra.size,
          lineHeight: t.lineHeight, letterSpacing: Math.round(t.tracking * extra.size * 10) / 10, whiteSpace: "pre", color: extraColor[extra.color].color,
          ...(extraColor[extra.color].band ? { background: extraColor[extra.color].band, padding: `0 ${Math.round(extra.size * 0.2)}px`, borderRadius: Math.round(extra.size * 0.12) } : {}) }}>
          {extra.text}
        </div>
      ))}
    </div>
  );
}

/** 인물형: photo over the whole frame (mirrored when flip), darker on the left, then the band and the boxes from the bottom-left. */
function PersonFrame({ style, image, edit, layout, titleFamily, extraColor }: { style: ThumbStyle; image?: string | null; edit: ThumbEdit; layout: ReturnType<typeof thumbLayout>;
  titleFamily: string; extraColor: ReturnType<typeof EXTRA_COLOR> }) {
  const P = THUMB_PERSON, box = layout.photoBox, person = layout.person!;
  return (
    <div style={{ width: style.width, height: style.height, display: "flex", position: "relative", overflow: "hidden", background: "#111111" }}>
      {/* eslint-disable-next-line @next/next/no-img-element -- the same element is drawn by next/og, which takes no Image component */}
      {image ? <img src={image} alt="" width={box.width} height={box.height}
        style={{ position: "absolute", left: box.left, top: box.top, width: box.width, height: box.height, objectFit: "cover",
          ...(edit.flip ? { transform: "scaleX(-1)" } : {}), ...(edit.photo ? { filter: `brightness(${edit.photo.brightness})` } : {}) }} /> : null}
      <div style={{ position: "absolute", left: 0, top: 0, width: style.width, height: style.height, display: "flex",
        backgroundImage: "linear-gradient(90deg, rgba(0,0,0,0.67) 0%, rgba(0,0,0,0) 70%)" }} />
      {person.band ? <div style={{ position: "absolute", left: P.sidePx, top: person.band.top, display: "flex", fontFamily: titleFamily, fontWeight: 900,
        fontSize: person.band.size, lineHeight: 1, color: P.text, whiteSpace: "pre", textShadow: "0 0 4px rgba(0,0,0,0.9)" }}>{person.band.text}</div> : null}
      {person.boxes.map((row, i) => (
        <div key={i} style={{ position: "absolute", left: P.sidePx, top: row.top, height: row.height, display: "flex", alignItems: "center", padding: `0 ${P.padX / 2}px`,
          background: row.bg, borderRadius: 12, fontFamily: titleFamily, fontWeight: 900, fontSize: layout.size, lineHeight: 1, color: P.text, whiteSpace: "pre" }}>{row.text}</div>
      ))}
      {(edit.extras ?? []).map((extra) => (
        <div key={extra.id} style={{ position: "absolute", left: extra.x, top: extra.y, display: "flex", fontFamily: titleFamily, fontWeight: 900, fontSize: extra.size,
          lineHeight: style.title.lineHeight, whiteSpace: "pre", color: extraColor[extra.color].color,
          ...(extraColor[extra.color].band ? { background: extraColor[extra.color].band, padding: `0 ${Math.round(extra.size * 0.2)}px`, borderRadius: Math.round(extra.size * 0.12) } : {}) }}>
          {extra.text}
        </div>
      ))}
    </div>
  );
}

/**
 * 콜라주형: the collage over the whole frame → film noise (fading to the bottom) → dark fade → 고민 silhouette → the two lines, each outlined
 * behind its letters (paint-order stroke — next/og does it for any stroked text, the browser by paintOrder).
 */
function CollageFrame({ style, image, copy, edit, layout, titleFamily, extraColor, assets }: { style: ThumbStyle; image?: string | null; copy: ThumbCopy; edit: ThumbEdit;
  layout: ReturnType<typeof thumbLayout>; titleFamily: string; extraColor: ReturnType<typeof EXTRA_COLOR>; assets: { noise: string; silhouette: string } }) {
  const C = THUMB_COLLAGE, box = layout.photoBox, { sub, main, silhouette: s } = layout.collage!;
  const line = (size: number) => ({ display: "flex", fontFamily: titleFamily, fontSize: size, lineHeight: C.lineHeight, letterSpacing: Math.round(C.tracking * size * 10) / 10,
    whiteSpace: "pre" as const, WebkitTextStrokeColor: C.stroke, paintOrder: "stroke" as const });
  return (
    <div style={{ width: style.width, height: style.height, display: "flex", position: "relative", overflow: "hidden", background: "#15171C" }}>
      {/* eslint-disable-next-line @next/next/no-img-element -- the same element is drawn by next/og, which takes no Image component */}
      {image ? <img src={image} alt="" width={box.width} height={box.height}
        style={{ position: "absolute", left: box.left, top: box.top, width: box.width, height: box.height, objectFit: "cover",
          ...(edit.photo ? { filter: `brightness(${edit.photo.brightness})` } : {}) }} /> : null}
      <div style={{ position: "absolute", left: 0, top: 0, width: style.width, height: style.height, display: "flex", backgroundImage: `url(${assets.noise})`,
        backgroundSize: `${C.noise.tile}px ${C.noise.tile}px`, backgroundRepeat: "repeat", maskImage: C.noise.mask }} />
      <div style={{ position: "absolute", left: 0, top: 0, width: style.width, height: style.height, display: "flex", backgroundImage: C.shade }} />
      {/* eslint-disable-next-line @next/next/no-img-element -- the same element is drawn by next/og */}
      <img src={assets.silhouette} alt="" width={s.width} height={s.height}
        style={{ position: "absolute", left: s.left, top: s.top, width: s.width, height: s.height, filter: `brightness(${C.silhouette.brightness})` }} />
      <div style={{ position: "absolute", left: C.left, right: C.right, bottom: C.bottom, display: "flex", flexDirection: "column", alignItems: "flex-start" }}>
        {sub ? <div style={{ ...line(sub.size), fontWeight: C.sub.weight, color: C.sub.color, WebkitTextStrokeWidth: C.sub.strokePx, marginBottom: C.gap }}>{sub.text}</div> : null}
        <div style={{ ...line(main.size), fontWeight: C.main.weight, color: C.main.color, WebkitTextStrokeWidth: C.main.strokePx }}>
          {thumbAccentParts(main.text, copy.accent).map((part, j) => <span key={j} style={{ color: part.accent ? C.main.accent : C.main.color }}>{part.text}</span>)}
        </div>
      </div>
      {(edit.extras ?? []).map((extra) => (
        <div key={extra.id} style={{ position: "absolute", left: extra.x, top: extra.y, display: "flex", fontFamily: titleFamily, fontWeight: 900, fontSize: extra.size,
          lineHeight: style.title.lineHeight, whiteSpace: "pre", color: extraColor[extra.color].color,
          ...(extraColor[extra.color].band ? { background: extraColor[extra.color].band, padding: `0 ${Math.round(extra.size * 0.2)}px`, borderRadius: Math.round(extra.size * 0.12) } : {}) }}>
          {extra.text}
        </div>
      ))}
    </div>
  );
}
