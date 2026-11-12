import type { CSSProperties, ReactNode } from "react";
import { CREATIVE_SIZES, isWarehouseFormat, usesBackgroundPhoto } from "./formats.ts";
import { artworkGeometry } from "./safe-artwork.mjs";
import { ThumbnailAdView } from "./thumbnail-ad.tsx";
import type { CreativeVariant } from "./model.ts";

/** One deterministic composition for both the editor and next/og. No generated lettering, responsive reflow, or auto font shrinking. */
const C = { ink: "#132A2B", paper: "#F5F1E8", muted: "#4F625E", lime: "#DBEE83", blue: "#D6E7FF", coral: "#EF775F", white: "#FFFFFF" };
// Opaque cards carry all the text in note and conversation. Reframe has muted type directly on the paper.
const backgroundPhotoOpacity: Partial<Record<CreativeVariant["formatId"],number>> = {note:.8, conversation:.8, reframe:.14};
const flex: CSSProperties = { display: "flex", boxSizing: "border-box" };
function Words({ field, text, size, lines, color = C.ink, weight = 600, style = {} }: {
  field: string; text: string; size: number; lines: number; color?: string; weight?: number; style?: CSSProperties;
}) {
  return <div data-image-field={field} style={{ ...flex, flexDirection: "column", whiteSpace: "pre-wrap", wordBreak: "break-all", fontSize: size, fontWeight: weight,
    lineHeight: 1.25, maxHeight: Math.ceil(size * 1.25 * lines), overflow: "hidden", color, ...style }}>
    {text.split("\n").map((line, index) => <div key={index} data-image-line={index} style={{ ...flex, flexShrink: 0, ...(line ? {} : { minHeight: size * 1.25 }), ...(style.textAlign === "center" ? { justifyContent: "center" } : {}) }}>{line || " "}</div>)}
  </div>;
}
function Picture({ variant, url, style, contain = false }: { variant: CreativeVariant; url?: string; style: CSSProperties; contain?: boolean }) {
  if (!variant.asset) return null;
  // The exporter refuses missing files. The editor shows a real failure instead of passing a placeholder off as a completed image.
  if (!url) return <div data-image-missing="true" style={{ ...flex, alignItems: "center", justifyContent: "center", background: "#FFE4DF", color: "#8E2D22", fontSize: 30, ...style }}>이미지를 불러오지 못했어요</div>;
  // eslint-disable-next-line @next/next/no-img-element -- same plain image in the browser and next/og.
  return <img src={url} alt="" width={variant.asset.w} height={variant.asset.h} style={{ ...style, objectFit: contain ? "contain" : "cover", objectPosition: "center" }} />;
}
const Arrow = ({ color = C.ink, width = 90 }: { color?: string; width?: number }) => <svg width={width} height={50} viewBox="0 0 90 50">
  <path d="M4 25H78M57 7L79 25 57 43" stroke={color} strokeWidth="5" fill="none" strokeLinecap="round" strokeLinejoin="round" /></svg>;

export function ImageCreativeView({ variant, assetUrl }: { variant: CreativeVariant; assetUrl?: string }) {
  if (variant.formatVersion !== 1 || isWarehouseFormat(variant.formatId)) throw new Error("이 시안은 해당 버전의 창고 디자인 렌더러로 열어 주세요.");
  if (variant.formatId === "thumbnail_subject") return <ThumbnailAdView variant={variant} assetUrl={assetUrl} />;
  // A tall placement has more interface covering it, so use the compact square composition inside its safe area.
  const { width: W, height: H } = CREATIVE_SIZES[variant.size === "story" ? "square" : variant.size];
  const geometry = artworkGeometry(variant.size, variant.design, W, H);
  const { spec, card, scale, x, y, padding } = geometry;
  const font = variant.design?.font || "original";
  const family = font === "original" || font === "sans" ? "Pretendard" : "Ad-" + font + ", Pretendard";
  const pad = 72, top = 72, ctaY = H - 72 - 84, h = ctaY - top - 40, w = W - pad * 2;
  const { headline, body, cta } = variant.copy;
  const items = body.split("\n").filter(line => line.trim());
  const rect = (x: number, y: number, width: number, height: number): CSSProperties => ({ position: "absolute", left: x, top: y, width, height });
  const title = (style: CSSProperties = {}, color = C.ink, size = 72, lines = 3) => <Words field="headline" text={headline} size={size} lines={lines} color={color} style={{ ...style, fontFamily: family }} />;
  const detail = (style: CSSProperties = {}, color = C.muted, size = 38, lines = 3) => body ? <Words field="body" text={body} size={size} lines={lines} color={color} weight={400} style={style} /> : null;
  const pic = (style: CSSProperties, contain = false) => <Picture variant={variant} url={assetUrl} style={style} contain={contain} />;
  let background = C.paper, ctaBackground = C.ink, ctaColor = C.white;
  let content: ReactNode;
  switch (variant.formatId) {
    case "photo_headline": {
      background = C.ink;
      const photoH = Math.max(300, h - 300);
      content = <>{pic({ ...rect(0, 0, w, photoH), borderRadius: 32 })}
        {title({ ...rect(0, photoH + 32, w, 180) }, C.white, 64, 2)}
        {detail({ ...rect(0, photoH + 205, w, 95) }, "#D6E0DA", 34, 2)}</>;
      ctaBackground = C.lime; ctaColor = C.ink;
      break;
    }
    case "split_compare": {
      background = "#E8EBE5";
      const boxY = 225, boxH = h - boxY, colW = (w - 24) / 2;
      content = <>{title({ ...rect(0, 0, w, 190) }, C.ink, 66, 2)}
        {items.map((line, i) => <div key={i} style={{ ...flex, ...rect(i * (colW + 24), boxY, colW, boxH), background: i ? C.ink : C.white, borderRadius: 30, padding: 36, flexDirection: "column", justifyContent: "center", gap: 52 }}>
          <div style={{ ...flex, width: 94, height: 94, borderRadius: i ? 24 : 47, background: i ? C.lime : "#D6DDD6", alignItems: "center", justifyContent: "center" }}>
            <svg width="56" height="56" viewBox="0 0 56 56"><path d={i ? "M10 29l12 12 24-27" : "M14 14l28 28M42 14L14 42"} fill="none" stroke={C.ink} strokeWidth="5" strokeLinecap="round" /></svg></div>
          <Words field="body" text={line} size={44} lines={5} color={i ? C.white : C.ink} /></div>)}</>;
      break;
    }
    case "note": {
      background = "#D7E1D3";
      content = <div style={{ ...flex, ...rect(20, 24, w - 40, h - 48), background: "#FFF9DA", borderRadius: 8, boxShadow: "12px 18px 0 #BBC6B4", padding: 58, flexDirection: "column", justifyContent: "space-between" }}>
        <div style={{ ...flex, position: "absolute", top: -12, left: 320, width: 160, height: 38, background: "#E3C37E" }} />
        {title({}, C.ink, 72, 3)}
        <div style={{ ...flex, height: 3, background: "#DCCF9A", width: "100%", margin: "30px 0" }} />
        {detail({}, C.ink, 44, 4)}
      </div>;
      break;
    }
    case "annotated": {
      background = "#EAF0F7";
      const photoY = 220, photoH = h - 350;
      content = <>{title({ ...rect(0, 0, w, 180) }, C.ink, 66, 2)}
        {pic({ ...rect(0, photoY, w - 130, photoH), borderRadius: 24 })}
        <div style={{ ...flex, ...rect(w - 210, photoY + 24, 210, 210) }}><svg width="210" height="210" viewBox="0 0 210 210"><path d="M184 12C64 14 190 140 36 157M53 120L30 160l44 10" fill="none" stroke={C.coral} strokeWidth="10" strokeLinecap="round" strokeLinejoin="round" /></svg></div>
        {detail({ ...rect(0, h - 98, w, 98) }, C.ink, 38, 2)}</>;
      break;
    }
    case "object_spotlight": {
      background = C.lime;
      const photoY = 212, photoH = h - 330;
      content = <>{title({ ...rect(0, 0, w, 185), textAlign: "center", justifyContent: "center" }, C.ink, 64, 2)}
        <div style={{ ...flex, ...rect((w - Math.min(w, photoH)) / 2, photoY, Math.min(w, photoH), photoH), borderRadius: 400, background: "#EDF5C8" }} />
        {pic({ ...rect(65, photoY + 20, w - 130, photoH - 40) }, true)}
        {detail({ ...rect(0, h - 100, w, 100), textAlign: "center", justifyContent: "center" }, C.ink, 36, 2)}</>;
      break;
    }
    case "checklist": {
      background = "#F1EEE7";
      const listY = 218, gap = 22, rowH = (h - listY - 2 * gap) / 3;
      content = <>{title({ ...rect(0, 0, w, 180) }, C.ink, 66, 2)}
        {items.map((line, i) => <div key={i} style={{ ...flex, ...rect(0, listY + i * (rowH + gap), w, rowH), background: C.white, border: "2px solid #D8DED5", borderRadius: 24, padding: 28, gap: 30, alignItems: "center" }}>
          <div style={{ ...flex, width: 58, height: 58, borderRadius: 16, background: C.ink, flexShrink: 0, alignItems: "center", justifyContent: "center" }}><svg width="36" height="36" viewBox="0 0 36 36"><path d="M5 17l9 9L31 8" fill="none" stroke={C.lime} strokeWidth="4" strokeLinecap="round" /></svg></div>
          <Words field="body" text={line} size={40} lines={3} /></div>)}</>;
      break;
    }
    case "question": {
      background = "#D9E4FA";
      content = <><div style={{ ...flex, ...rect(0, 0, 156, 156), background: C.ink, color: C.lime, borderRadius: 80, alignItems: "center", justifyContent: "center", fontSize: 116, fontWeight: 600 }}>?</div>
        {title({ ...rect(0, 198, w, 275) }, C.ink, 70, 3)}
        {variant.asset ? pic({ ...rect(w * .48, h - 295, w * .52, 270), borderRadius: 24 }) : <div style={{ ...flex, ...rect(w - 260, h - 230, 190, 190), border: `24px solid ${C.coral}`, borderRadius: 100 }} />}
        {detail({ ...rect(0, h - 196, variant.asset ? w * .43 : w - 260, 196) }, C.ink, 34, 4)}</>;
      break;
    }
    case "typography": {
      background = C.ink; ctaBackground = C.lime; ctaColor = C.ink;
      content = <><div style={{ ...flex, ...rect(0, 0, 120, 10), background: C.lime }} />
        {title({ ...rect(0, 80, w, h - 245) }, C.lime, 112, 4)}
        {detail({ ...rect(0, h - 150, w, 150) }, C.white, 42, 2)}</>;
      break;
    }
    case "steps": {
      background = "#EEEAF8";
      const listY = 225, gap = 26, rowH = (h - listY - gap * 2) / 3;
      content = <>{title({ ...rect(0, 0, w, 180) }, C.ink, 66, 2)}
        <div style={{ ...flex, ...rect(48, listY + rowH / 2, 4, 2 * (rowH + gap)), background: "#B2A5CF" }} />
        {items.map((line, i) => <div key={i} style={{ ...flex, ...rect(0, listY + i * (rowH + gap), w, rowH), alignItems: "center", gap: 36 }}>
          <div style={{ ...flex, width: 100, height: 100, borderRadius: 50, background: C.ink, color: C.white, flexShrink: 0, alignItems: "center", justifyContent: "center", fontSize: 44 }}>{i + 1}</div>
          <div style={{ ...flex, width: w - 136, padding: "26px 32px", borderRadius: 24, background: C.white }}><Words field="body" text={line} size={40} lines={3} /></div></div>)}</>;
      break;
    }
    case "conversation": {
      background = "#E5E9DE";
      content = <><div style={{ ...flex, ...rect(0, 30, w - 90, Math.min(330, h * .4)), background: C.white, borderRadius: "40px 40px 40px 4px", padding: 48, alignItems: "center" }}>{title({}, C.ink, 60, 3)}</div>
        <div style={{ ...flex, ...rect(90, h * .5, w - 90, h * .5 - 30), background: C.ink, borderRadius: "40px 40px 4px 40px", padding: 48, alignItems: "center" }}>{detail({}, C.white, 42, 4)}</div></>;
      break;
    }
    case "reframe": {
      background = "#FFE7DC";
      content = <>{title({ ...rect(0, 0, w, 180) }, C.ink, 64, 2)}
        <div style={{ ...flex, ...rect(0, 230, w, 180), alignItems: "center" }}><Words field="body" text={items[0] ?? ""} size={56} lines={2} color="#796D64" style={{ textDecoration: "line-through" }} /></div>
        <div style={{ ...flex, ...rect(0, 430, 90, 50) }}><Arrow color={C.coral} /></div>
        <div style={{ ...flex, ...rect(0, 520, w, Math.max(180, h - 520)), background: C.ink, borderRadius: 24, padding: 34, alignItems: "center" }}><Words field="body" text={items[1] ?? ""} size={54} lines={3} color={C.white} /></div></>;
      break;
    }
    case "report_crop": {
      background = "#E4E9E3";
      const photoY = 208, photoH = h - 326;
      content = <>{title({ ...rect(0, 0, w, 178) }, C.ink, 64, 2)}
        <div style={{ ...flex, ...rect(0, photoY, w, photoH), background: C.white, border: "2px solid #BCC9BE", borderRadius: 16, padding: 16 }}>
          {pic({ width: w - 36, height: photoH - 36 }, true)}</div>
        {detail({ ...rect(0, h - 96, w, 96) }, C.ink, 36, 2)}</>;
      break;
    }
  }
  const backdrop = usesBackgroundPhoto(variant);
  const photoOpacity = backgroundPhotoOpacity[variant.formatId] ?? .3;
  return <div data-image-format={variant.formatId} style={{ ...flex, position: "relative", width: spec.width, height: spec.height,
    overflow: "hidden", background: card === "paper" ? "#DFCDB4" : background, color: C.ink, fontFamily: "Pretendard" }}>
    {backdrop && card === "original" && pic({...rect(0,0,spec.width,spec.height), opacity:photoOpacity})}
    {card === "frame" && <div style={{ ...flex, ...rect(x-padding,y-padding,geometry.width+2*padding,geometry.height+2*padding),
      border: "3px solid #202324", background: "#FEFDFA" }} />}
    {card === "paper" && <div style={{ ...flex, ...rect(x-padding*.8,y-padding*.8,geometry.width+padding*1.6,geometry.height+padding*1.6),
      background: "#FFF9EF", boxShadow: "8px 11px 0 #A38E72" }} />}
    <div data-protected-art="true" style={{ ...flex, ...rect(x,y,W,H), overflow: "hidden", background:backdrop && card === "original" ? "transparent" : background,
      transform: `scale(${scale})`, transformOrigin: "top left" }}>
      {backdrop && card !== "original" && pic({...rect(0,0,W,H), opacity:photoOpacity})}
      <div style={{ ...flex, ...rect(pad, top, w, h) }}>{content}</div>
      <div style={{ ...flex, ...rect(pad, ctaY, w, 84), borderRadius: card === "original" ? 42 : card === "frame" ? 0 : 8,
        background: card === "frame" ? C.white : ctaBackground, ...(card === "frame" ? { border: "4px solid #132A2B" } : {}),
        alignItems: "center", justifyContent: "space-between", padding: "0 36px" }}>
        {/* next/og drops overflow-hidden text inside this rounded button, so the CTA was blank on every PNG. Validation keeps it to one line of 18 characters, which fits. */}
        <Words field="cta" text={cta} size={36} lines={1} color={card === "frame" ? C.ink : ctaColor} style={{ overflow: "visible" }} /><Arrow color={card === "frame" ? C.ink : ctaColor} width={66} />
      </div>
    </div>
  </div>;
}
