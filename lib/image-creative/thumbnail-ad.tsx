import type { CSSProperties } from "react";
import { ThumbFrame } from "../youtube-process/thumb-frame.tsx";
import { THUMB_STYLES, thumbLines, type ThumbStyle } from "../youtube-process/thumb-style.ts";
import { resolvePlacement } from "./placement.ts";
import type { CreativeVariant } from "./model.ts";

const source = THUMB_STYLES.anim;

// Use the writer's newlines first, then the thumbnail line break. A long, unspaced
// Korean word must also fit; never discard letters to make a title look shorter.
function twoLines(text: string, capacity: number) {
  const paragraphs = text.trim().split("\n");
  if (paragraphs.length > 1 || [...text].length <= capacity) return paragraphs;
  const suggested = thumbLines(text, { ...source, title: { ...source.title, maxChars: capacity } });
  if (suggested.every(line => [...line].length <= capacity)) return suggested;
  const letters = [...text];
  const cut = Math.ceil(letters.length / 2);
  return [letters.slice(0, cut).join("").trimEnd(), letters.slice(cut).join("").trimStart()];
}

const box = (left: number, top: number, width: number, height: number): CSSProperties =>
  ({ position: "absolute", display: "flex", left, top, width, height });

export function ThumbnailAdView({ variant, assetUrl }: { variant: CreativeVariant; assetUrl?: string }) {
  const { safe, width, height, size } = resolvePlacement(variant.size, variant.design?.placement, variant.design?.outputWidth);
  if (!assetUrl) return <div data-image-missing="true" style={{ display: "flex", width, height, alignItems: "center", justifyContent: "center",
    background: "#FFE4DF", color: "#8E2D22", fontSize: Math.round(width / 36) }}>이미지를 불러오지 못했어요</div>;
  const px = (value: number) => Math.round(value * width / 1080);
  const story = size === "story";
  const card = variant.design?.card ?? "original";
  const inset = px(card === "original" ? 0 : 18);
  const side = safe.x + inset;
  const textWidth = width - 2 * side;
  const font = variant.design?.font ?? "original";
  const customFont = font !== "original" && font !== "sans";
  const bodyLines = twoLines(variant.copy.body, 22);
  const titleLines = twoLines(variant.copy.headline, 12);
  const words = titleLines.flatMap(line => line.match(/[가-힣A-Za-z0-9]+/gu) ?? []);
  const distinct = words.filter(word => titleLines.filter(line => line.includes(word)).length === 1);
  const accent = distinct.find(word => word.length > 1 && variant.appeal.meaning.includes(word)) ?? distinct.at(-1);
  const copy = { text: titleLines.join("\n"), accent };
  const bodyLine = px(49), bodyH = bodyLines.length * bodyLine;
  const ctaH = px(78), gap = px(23);
  const safeBottom = safe.y + safe.height - inset;
  const footerH = bodyH + gap + ctaH;
  const titleEnd = safeBottom - footerH - gap;
  const titleTop = safe.y + inset;
  // An upper bound for wide Latin glyphs and explicitly selected display faces.
  // The YouTube estimator uses average Latin widths; a headline of W characters still fits.
  const widest = Math.max(1, ...titleLines.map(line => [...line].length));
  const maxTitle = Math.min(px(story ? 96 : 110), Math.floor(textWidth / (widest * (customFont ? 1.12 : 1))));
  const style: ThumbStyle = {
    ...source, width, height: titleEnd - titleTop,
    title: { ...source.title, sidePx: side, bottomPx: 0, minPx: px(52), maxPx: maxTitle, ...(customFont ? { weight: 600 } : {}) },
    subject: { ...source.subject, topPx: 0 },
  };
  const bodyTop = titleEnd + gap, buttonY = bodyTop + bodyH + gap;
  const buttonW = Math.min(textWidth, Math.max(px(307), px([...variant.copy.cta].length * 36 + 105)));
  const subject = variant.asset ? { size: [variant.asset.w, variant.asset.h] as [number, number],
    box: variant.asset.subjectBox ?? [0, 0, variant.asset.w, variant.asset.h] as [number, number, number, number] } : undefined;
  const ink = source.title.ink;
  return <div data-image-format="thumbnail_subject" style={{ display: "flex", position: "relative", width, height, overflow: "hidden",
    background: source.background, color: ink, fontFamily: "Pretendard" }}>
    {story && <div aria-hidden style={{ ...box(0, safeBottom, width, height - safeBottom),
      backgroundImage: "linear-gradient(175deg, #FFFFFF 0%, #EBEBE8 60%, #DFE0DD 100%)" }} />}
    <div data-image-field="headline" style={box(0, titleTop, width, style.height)}>
      <ThumbFrame style={style} image={assetUrl} copy={copy} subject={subject}
        edit={{ photo: { scale: .96, x: 0, y: 0, brightness: 1 } }}
        titleFamily={customFont ? "Ad-" + font + ", Pretendard" : undefined} />
    </div>
    <div data-image-field="body" style={{ ...box(side, bodyTop, textWidth, bodyH), flexDirection: "column", alignItems: "center" }}>
      {bodyLines.map((line, index) => <div key={index} style={{ display: "flex", fontWeight: 500, fontSize: px(38),
        letterSpacing: -px(1), lineHeight: bodyLine / px(38), whiteSpace: "pre", color: "#424247" }}>{line}</div>)}
    </div>
    <div data-image-field="cta" style={{ ...box((width - buttonW) / 2, buttonY, buttonW, ctaH), background: ink, color: "#FFFFFF",
      alignItems: "center", justifyContent: "center", borderRadius: card === "frame" ? 0 : card === "paper" ? px(8) : ctaH / 2,
      fontSize: px(35), fontWeight: 600, whiteSpace: "pre" }}>{variant.copy.cta}</div>
    {card !== "original" && <div style={{ ...box(px(12), px(12), width - px(24), height - px(24)), border: px(card === "frame" ? 3 : 12) + "px solid " + (card === "frame" ? ink : "#E9DFC9") }} />}
  </div>;
}
