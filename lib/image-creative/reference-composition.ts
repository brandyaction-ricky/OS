import { resolvePlacement } from "./placement.ts";
import type { CopyField, CreativeVariant } from "./model.ts";
import { referenceLineHeight, referenceTextLines, type ReferenceLayout } from "./reference-layout.ts";

export type CompositionInput = Pick<CreativeVariant, "size" | "design" | "copy" | "asset"> & {referenceLayout: ReferenceLayout};
type Rect = { x: number; y: number; w: number; h: number };

// Work at the delivery size. The image frame, headline size and button anchor stay fixed across an appeal test.
export function composeReference({ referenceLayout: layout, size, design, copy }: CompositionInput) {
  const direction = layout.composition!;
  const spec = resolvePlacement(size, design?.placement, design?.outputWidth);
  const { width, height, safe } = spec;
  const unit = width / 1080;
  const framed = design?.card === "paper" || design?.card === "frame";
  const edge = framed ? 23 * unit : 0;
  const inset = (framed ? 44 : 28) * unit;
  const area: Rect = { x:safe.x + inset, y:safe.y + inset, w:safe.width - 2*inset, h:safe.height - 2*inset };
  const gap = 24 * unit;
  const style = layout.photo ? direction.style : "type";
  const start = direction.imageSide === "start";
  const overlay = style === "overlay";
  const column = {...area};
  let photo: Rect | undefined;
  const align = overlay || style === "split" ? "left" : layout.headline.align;
  if (overlay) {
    photo = { x:edge, y:edge, w:width-2*edge, h:height-2*edge };
    column.w *= .74;
  } else if (style === "split") {
    const imageW = Math.round(area.w * (direction.imageShare ?? .46));
    photo = { x:start ? area.x : area.x + area.w - imageW, y:area.y, w:imageW, h:area.h };
    column.w -= imageW + gap;
    if (start) column.x += imageW + gap;
  } else if (style === "stack") {
    const imageH = Math.round(area.h * (direction.imageShare ?? .51));
    photo = { x:area.x, y:start ? area.y : area.y+area.h-imageH, w:area.w, h:imageH };
    column.h -= imageH + gap;
    if (start) column.y += imageH + gap;
  }
  // Photography can bleed under story controls. A screenshot fitted in full keeps its contents inside the safe area.
  if (spec.size === "story" && photo && direction.fit === "cover" && !overlay) {
    if (style === "split" || start) { photo.h += photo.y - edge; photo.y = edge; }
    if (style === "split" || !start) photo.h = height - edge - photo.y;
  }
  // A tall source can leave too little copy space in square/feed-safe story layouts.
  // Pick one type scale for the geometry, independent of the individual test headline.
  const interGroup = gap * 1.3;
  const buttonHeight = 78 * unit;
  const bodySize = (style === "split" || column.h < 480*unit ? 32 : 37) * unit;
  const titleLines = overlay ? 4 : style === "stack" ? 2 : 3;
  const availableForTitle = column.h - 2*bodySize*referenceLineHeight("body") - gap*.80 - buttonHeight - interGroup;
  const titleCeiling = (style === "split" ? 66 : style === "type" ? 118 : overlay ? 98 : 85) * unit;
  const titleSize = Math.max(48*unit, Math.min(titleCeiling, Math.floor(availableForTitle / (titleLines*referenceLineHeight("headline")))));
  const buttonSize = 33 * unit;
  const buttonWidth = Math.min(column.w, Math.max(272 * unit, (Array.from(copy.cta).length + 2.4) * buttonSize));
  const buttonX = align === "center" ? column.x + (column.w-buttonWidth)/2 : align === "right" ? column.x+column.w-buttonWidth : column.x;
  function text(role:CopyField, fontSize:number, w:number) {
    const lines = copy[role] ? referenceTextLines({...layout.headline, w:w/1080*100, fontSize}, copy[role], role) : [];
    const lineHeight = referenceLineHeight(role);
    return {lines, fontSize, lineHeight, height:lines.length * fontSize * lineHeight};
  }
  const headline = text("headline",titleSize,column.w);
  const body = text("body",bodySize,column.w);
  const cta = text("cta",buttonSize,buttonWidth - 34*unit);
  const issues: string[] = [];
  // Reserve the same block across the batch. Headlines grow upward; a short headline keeps the body and button in place.
  const reserve = Math.min(column.h, titleLines*titleSize*referenceLineHeight("headline") + 2*bodySize*referenceLineHeight("body") + gap*.80 + interGroup + buttonHeight);
  const blockEnd = column.y + (overlay ? (start ? column.h : reserve) : (column.h + reserve)/2);
  const buttonY = blockEnd - buttonHeight;
  const bodyY = buttonY - interGroup - body.height;
  const y = bodyY - (body.height ? gap*.80 : 0) - headline.height;
  if (y < column.y-.001 || cta.lines.length !== 1) issues.push("제목이나 본문을 줄이거나 다른 구도를 선택해 주세요.");
  return { width,height,edge,photo,style,align,issues,
    headline:{...headline,box:{x:column.x,y,w:column.w,h:headline.height}},
    body:{...body,box:{x:column.x,y:bodyY,w:column.w,h:body.height}},
    cta:{...cta,box:{x:buttonX,y:buttonY,w:buttonWidth,h:buttonHeight}} };
}
