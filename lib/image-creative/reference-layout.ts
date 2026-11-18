export type ReferenceBox = { x: number; y: number; w: number; h: number };
export type ReferenceTextBox = ReferenceBox & {
  fill: string; color: string; fontSize: number; align: "left" | "center" | "right";
  weight?: 400 | 600 | 900;
};
export const referenceMasterVersion = 1;
export const referenceDetailVersion = 1;
export const referencePhotoFitVersion = 1;
export const REFERENCE_MASK_LIMIT = 32;
export const REFERENCE_BRAND_SLOT_LIMIT = 4;
export const REFERENCE_DETAIL_SLOT_LIMIT = 8;
export type ReferenceSample = { x:number; y:number; flipX?:boolean };
export type ReferenceRegion = ReferenceBox & {fill:string; sample?:ReferenceSample};
export type ReferenceDetailSlot = ReferenceBox & {crop:ReferenceBox; radius?:number; fit?:"contain" | "cover"; source?:"detail" | "photo"};
export type ReferenceMaster = {
  v: typeof referenceMasterVersion;
  base?: "solid";
  background: string;
  regions: ReferenceRegion[];
  headlineWeight: 400 | 600 | 900;
  brandSlots?: ReferenceTextBox[];
  detailSlots?: ReferenceDetailSlot[];
  bodyContinuation?: ReferenceTextBox;
  keepOverPhoto?: (ReferenceBox & {radius?:number})[];
  photoAlign?: "top" | "center";
  photoFit?: "contain";
  headlineAccent?: string;
};
export type ReferenceComposition = {
  style: "stack" | "split" | "overlay";
  background: string; ink: string; accent: string;
  imageSide: "start" | "end";
  fit: "cover" | "contain";
  headlineWeight?: 600 | 900;
  buttonStyle?: "solid" | "square" | "text";
  focusX?: number;
  focusY?: number;
  imageShare?: number;
};
export type ReferenceLayout = {
  source: { path: string; w: number; h: number };
  reproduction?: "image-ai";
  master?: ReferenceMaster;
  composition?: ReferenceComposition;
  photo?: ReferenceBox;
  headline: ReferenceTextBox;
  body?: ReferenceTextBox;
  cta: ReferenceTextBox;
};

export function draftReferenceLayout(source: ReferenceLayout["source"]): ReferenceLayout {
  const text = { fill: "#ffffff", color: "#161616", align: "left" as const };
  return { source: { path: source.path, w: source.w, h: source.h },
    headline: { x: 7, y: 7, w: 86, h: 14, ...text, fontSize: 60 },
    photo: { x: 7, y: 24, w: 86, h: 43 },
    body: { x: 7, y: 70, w: 86, h: 9, ...text, fontSize: 34 },
    cta: { x: 22, y: 82, w: 56, h: 10, fill: "#161616", color: "#ffffff", align: "center", fontSize: 37 } };
}

function object(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function inside(value: unknown, minSize = 1): value is ReferenceBox {
  if (!object(value)) return false;
  const { x,y,w,h } = value;
  return typeof x === "number" && typeof y === "number" && typeof w === "number" && typeof h === "number" &&
    x >= 0 && y >= 0 && w > 0 && h > 0 && w >= minSize && h >= minSize && x + w <= 100.000001 && y + h <= 100.000001;
}
function keysAllowed(value: object, names: string[]) {
  return Object.keys(value).every(k => names.includes(k));
}
function detailSlot(value: unknown): value is ReferenceDetailSlot {
  if (!object(value)) return false;
  const {crop, radius, fit, source} = value;
  return inside(value) && keysAllowed(value,["x","y","w","h","crop","radius","fit","source"]) &&
    inside(crop) && keysAllowed(crop,["x","y","w","h"]) &&
    (radius === undefined || (typeof radius === "number" && radius >= 0 && radius <= 50)) &&
    (source === undefined || source === "photo" || source === "detail") &&
    (fit === undefined || fit === "contain" || fit === "cover");
}
export function referenceContains(outer: ReferenceBox, inner: ReferenceBox) {
  return inner.x >= outer.x && inner.y >= outer.y && inner.x + inner.w <= outer.x + outer.w + .000001 &&
    inner.y + inner.h <= outer.y + outer.h + .000001;
}
const isSolid = (color: unknown): color is string => typeof color === "string" && /^#[\da-f]{6}$/i.test(color);

function masterRegion(value:unknown): value is ReferenceRegion {
  if (!object(value) || !keysAllowed(value,["x","y","w","h","fill","sample"]) || !isSolid(value.fill)) return false;
  const sample = value.sample;
  if (!inside(value,0)) return false;
  if (sample === undefined) return true;
  return object(sample) && keysAllowed(sample,["x","y","flipX"]) &&
    (sample.flipX === undefined || typeof sample.flipX === "boolean") &&
    inside({x:sample.x,y:sample.y,w:value.w,h:value.h},0);
}

function textBox(value: unknown, photo?: ReferenceBox, master = false): value is ReferenceTextBox {
  if (!object(value)) return false;
  const { fill,color,fontSize,align,weight } = value;
  return inside(value) && keysAllowed(value,["x","y","w","h","fill","color","fontSize","align","weight"]) &&
    (weight === undefined || (master && (weight === 400 || weight === 600 || weight === 900))) &&
    (isSolid(fill) || (fill === "transparent" && (master || !!photo && referenceContains(photo,value)))) && isSolid(color) &&
    typeof fontSize === "number" && Number.isFinite(fontSize) && fontSize >= 12 && fontSize <= 200 &&
    (align === "left" || align === "center" || align === "right");
}
export function isReferenceLayout(value: unknown): value is ReferenceLayout {
  if (!object(value) || !keysAllowed(value,["source","reproduction","composition","master","photo","headline","body","cta"]) || !object(value.source) ||
      (value.reproduction !== undefined && value.reproduction !== "image-ai")) return false;
  const {path,w,h} = value.source;
  const master = value.master;
  if (master !== undefined) {
    if (value.composition !== undefined || !object(master) || !keysAllowed(master,["v","base","background","regions","headlineWeight","bodyContinuation","keepOverPhoto","photoAlign","photoFit","headlineAccent","brandSlots","detailSlots"]) ||
        master.v !== referenceMasterVersion || !isSolid(master.background) ||
        (master.base !== undefined && master.base !== "solid") ||
        !(master.headlineWeight === 400 || master.headlineWeight === 600 || master.headlineWeight === 900) ||
        (master.detailSlots !== undefined && (!Array.isArray(master.detailSlots) || master.detailSlots.length > REFERENCE_DETAIL_SLOT_LIMIT ||
          !master.detailSlots.every(slot => detailSlot(slot) && (slot.source !== "photo" || !!value.photo)))) ||
        (master.brandSlots !== undefined && (!Array.isArray(master.brandSlots) || master.brandSlots.length > REFERENCE_BRAND_SLOT_LIMIT ||
          !master.brandSlots.every(box => textBox(box,undefined,true)))) ||
        (master.bodyContinuation !== undefined && (value.body === undefined || !textBox(master.bodyContinuation,undefined,true))) ||
        !(master.photoAlign === undefined || master.photoAlign === "top" || master.photoAlign === "center") ||
        (master.photoFit !== undefined && (master.photoFit !== "contain" || !value.photo)) ||
        (master.headlineAccent !== undefined && !isSolid(master.headlineAccent)) ||
        (master.keepOverPhoto !== undefined && (!Array.isArray(master.keepOverPhoto) || master.keepOverPhoto.length > REFERENCE_MASK_LIMIT ||
          !master.keepOverPhoto.every(box => object(box) && keysAllowed(box,["x","y","w","h","radius"]) &&
            (box.radius === undefined || (typeof box.radius === "number" && box.radius>=0 && box.radius<=50)) && inside(box,0)))) ||
        !Array.isArray(master.regions) || master.regions.length > REFERENCE_MASK_LIMIT ||
        !master.regions.every(masterRegion)) return false;
  }
  if (value.composition !== undefined) {
    const style = value.composition;
    if (!object(style) || !keysAllowed(style,["style","background","ink","accent","imageSide","fit","headlineWeight","buttonStyle","focusX","focusY","imageShare"]) ||
        !(style.style === "stack" || style.style === "split" || style.style === "overlay") ||
        !(style.imageSide === "start" || style.imageSide === "end") || !(style.fit === "cover" || style.fit === "contain") ||
        !(style.headlineWeight === undefined || style.headlineWeight === 600 || style.headlineWeight === 900) ||
        !(style.buttonStyle === undefined || style.buttonStyle === "solid" || style.buttonStyle === "square" || style.buttonStyle === "text") ||
        ![style.focusX,style.focusY].every(v => v === undefined || (typeof v === "number" && Number.isFinite(v) && v>=0 && v<=100)) ||
        !(style.imageShare === undefined || (typeof style.imageShare === "number" && style.imageShare>=.32 && style.imageShare<=.65)) ||
        ![style.background,style.ink,style.accent].every(color => typeof color === "string" && /^#[\da-f]{6}$/i.test(color))) return false;
  }
  if (value.photo !== undefined && (!inside(value.photo) || !keysAllowed(value.photo,["x","y","w","h"]))) return false;
  const photo = value.photo;
  return keysAllowed(value.source,["path","w","h"]) && typeof path === "string" && path.length > 0 && path.length <= 200 &&
    typeof w === "number" && Number.isInteger(w) && w > 0 && w <= 8192 &&
    typeof h === "number" && Number.isInteger(h) && h > 0 && h <= 8192 && w*h <= 20_000_000 &&
    textBox(value.headline,photo,!!master) && textBox(value.cta,photo,!!master) && (value.body === undefined || textBox(value.body,photo,!!master));
}

export const referenceTextKeys = ["headline","body","cta"] as const;

export function usesReferenceDetailAsset(layout?: ReferenceLayout): boolean {
  return Boolean(layout?.master?.detailSlots?.some(slot => slot.source !== "photo"));
}

function masterTextWeights(layout: ReferenceLayout) {
  return [layout.headline,layout.body,layout.cta,layout.master?.bodyContinuation,...(layout.master?.brandSlots ?? [])].map(box=>box?.weight);
}

export function usesReferenceDetailRendering(layout?: ReferenceLayout): boolean {
  return Boolean(layout?.master && (layout.master.detailSlots?.length || masterTextWeights(layout).some(weight=>weight !== undefined)));
}

export function usesReferencePhotoStyling(layout?: ReferenceLayout): boolean {
  return Boolean(layout?.master?.base || layout?.master?.photoFit || layout?.master?.headlineAccent);
}

export function referenceUsesBlackWeight(layout?: ReferenceLayout): boolean {
  return Boolean(layout?.composition || layout?.master && (layout.master.headlineWeight === 900 || masterTextWeights(layout).includes(900)));
}

/** Fit one intact source sheet while keeping every editable text slot in the placement's safe area. */
export function referenceMasterFrame(layout: ReferenceLayout, placement: {
  width:number; height:number; safe:{x:number; y:number; width:number; height:number};
}, pad = 0) {
  const {width,height,safe} = placement;
  const sourceW = 1080, sourceH = sourceW * layout.source.h / layout.source.w;
  const slots = referenceTextKeys.map(key => layout[key]).filter((box): box is ReferenceTextBox => !!box);
  if (layout.master?.bodyContinuation) slots.push(layout.master.bodyContinuation);
  if (layout.master?.brandSlots) slots.push(...layout.master.brandSlots);
  const left = Math.min(...slots.map(b=>b.x)) * sourceW / 100, right = Math.max(...slots.map(b=>b.x+b.w)) * sourceW / 100;
  const top = Math.min(...slots.map(b=>b.y)) * sourceH / 100, bottom = Math.max(...slots.map(b=>b.y+b.h)) * sourceH / 100;
  const scale = Math.min((width-2*pad)/sourceW, (height-2*pad)/sourceH, safe.width/(right-left), safe.height/(bottom-top),
    (width-safe.x-pad)/(sourceW-left), (safe.x+safe.width-pad)/right, (height-safe.y-pad)/(sourceH-top), (safe.y+safe.height-pad)/bottom);
  const w = sourceW * scale, h = sourceH * scale;
  const clamp = (n: number, min: number, max: number) => Math.min(max,Math.max(min,n));
  const x = clamp((width-w)/2,Math.max(pad,safe.x-left*scale),Math.min(width-w-pad,safe.x+safe.width-right*scale));
  const y = clamp((height-h)/2,Math.max(pad,safe.y-top*scale),Math.min(height-h-pad,safe.y+safe.height-bottom*scale));
  return {x,y,w,h,scale};
}

type ReferenceRole = (typeof referenceTextKeys)[number];
type ReferenceCopy = Record<ReferenceRole, string>;

export const referenceLineHeight = (role: ReferenceRole) => role === "headline" ? 1.1 : role === "body" ? 1.35 : 1.2;

// Conservative em widths keep line breaks identical in the browser and the Mac renderer.
const glyphEm = (character: string) => character === " " ? .35 : /[A-Za-z0-9]/.test(character) && !/[MWmw]/.test(character) ? .74 : 1;

/** Flow one approved body into two fixed labels, leaving the copy itself intact. */
export function referenceBodyParts(layout: ReferenceLayout, value: string): string[] {
  const second = layout.master?.bodyContinuation;
  if (!second || !layout.body) return [value];
  const newline = value.indexOf("\n");
  if (newline >= 0) return [value.slice(0,newline), value.slice(newline+1)];
  const capacity = (box:ReferenceTextBox) => 10.8*box.w*.96/box.fontSize;
  const firstWidth = capacity(layout.body), secondWidth = capacity(second);
  const chars = Array.from(value);
  const total = chars.reduce((sum,char)=>sum+glyphEm(char),0);
  let left = 0, best = Infinity, at = -1;
  for (let i=1; i<chars.length; i++) {
    left += glyphEm(chars[i-1]);
    if (chars[i-1] === " ") continue;
    const space = chars[i] === " ";
    const right = total-left-(space ? .35 : 0);
    // Prefer candidates that fit and split at an existing word boundary, then balance occupied widths.
    const overflow = Math.max(0,left/firstWidth-1,right/secondWidth-1);
    const score = (overflow > 0 ? 10+overflow : 0) + (space ? 0 : 2) + Math.abs(left/firstWidth-right/secondWidth);
    if (score < best) { best=score; at=i; }
  }
  if (at < 0 || (total <= firstWidth && !value.includes(" "))) return [value,""];
  return [chars.slice(0,at).join(""),chars.slice(chars[at]===" " ? at+1 : at).join("")];
}

function wrapWords(paragraph: string, available: number, balance: boolean): string[] {
  const words = Array.from(paragraph.matchAll(/( *)([^ ]+)/g), ([, gap, word]) => ({
    gap, word, width: Array.from(word).reduce((total, character) => total + glyphEm(character), 0),
  }));
  function wrap(limit: number) {
    const lines: string[] = [];
    let line = "", width = 0;
    for (const { gap, word, width: wordWidth } of words) {
      if (line && width + gap.length * .35 + wordWidth > limit) {
        lines.push(line); line = ""; width = 0;
      }
      if (line) { line += gap; width += gap.length * .35; }
      if (wordWidth <= limit) {
        line += word; width += wordWidth;
      } else {
        // A single unspaced word can exceed the entire text column.
        for (const character of word) {
          const advance = glyphEm(character);
          if (line && width + advance > limit) { lines.push(line); line = ""; width = 0; }
          line += character; width += advance;
        }
      }
    }
    return [...lines, line];
  }
  let lines = wrap(available);
  if (!balance || lines.length < 2) return lines;
  // Find the narrowest measure with the same number of lines, without breaking a word to balance it.
  let min = Math.max(...words.map(word => word.width)), max = available;
  while (max - min > .05) {
    const mid = (min + max) / 2;
    const candidate = wrap(mid);
    if (candidate.length === lines.length) { lines = candidate; max = mid; }
    else min = mid;
  }
  return lines;
}

export function referenceTextLines(box: ReferenceTextBox, value: string, role?: ReferenceRole): string[] {
  const available = (1080 * box.w / 100) * .96;
  if (role) return value.split("\n").flatMap(paragraph => wrapWords(paragraph, available / box.fontSize, role === "headline"));
  const lines: string[] = [];
  for (const paragraph of value.split("\n")) {
    let line = "", width = 0;
    for (const character of paragraph) {
      const em = glyphEm(character);
      if (line && width + em * box.fontSize > available) {
        lines.push(line.trimEnd()); line = ""; width = 0;
      }
      if (character === " " && !line) continue;
      line += character; width += em * box.fontSize;
    }
    lines.push(line.trimEnd());
  }
  return lines;
}
/** The same canonical name must fit on one line in every repeated brand label. */
export function referenceBrandProblem(layout: ReferenceLayout, brand?: string): string | undefined {
  if (layout.reproduction === "image-ai") return;
  const slots = layout.master?.brandSlots;
  if (!slots?.length) return;
  if (!brand?.trim()) return "브랜드 칸에는 선택한 상품의 브랜드명이 필요해요.";
  const height = 1080 * layout.source.h / layout.source.w;
  if (slots.some(box => box.fontSize > 10.8*box.w*.96 || box.fontSize*1.2 > height*box.h/100 ||
      referenceTextLines(box,brand,"cta").length !== 1))
    return "상품 브랜드명이 한 줄로 들어가도록 브랜드 영역이나 글자 크기를 조정해 주세요.";
}
export function referenceCopyProblems(layout: ReferenceLayout, copy: ReferenceCopy, brand?:string): string[] {
  if (!isReferenceLayout(layout)) return ["레퍼런스 원본과 교체할 영역을 확인해 주세요."];
  if (layout.reproduction === "image-ai") return [];
  const labels = { headline: "제목", body: "본문", cta: "버튼 문구" };
  const height = 1080 * layout.source.h / layout.source.w;
  const problems = referenceTextKeys.flatMap(key => {
    const box = layout[key], value = copy[key];
    if (!value) return [];
    if (!box) return [`${labels[key]} 영역을 지정하거나 문구를 비워 주세요.`];
    // Recomposed designs fit the approved copy in their destination placement.
    if (layout.composition) return [];
    const continuation = key === "body" ? layout.master?.bodyContinuation : undefined;
    const parts = continuation ? referenceBodyParts(layout,value) : [value];
    const overflows = parts.some((part,index) => {
      if (!part) return false;
      const target = index === 1 ? continuation! : box;
      const lines = referenceTextLines(target, part, layout.master ? key : undefined);
      return (continuation && lines.length > 1) || lines.length * target.fontSize * 1.2 > height * target.h / 100 ||
        target.fontSize > 1080 * target.w / 100 * .96;
    });
    if (overflows)
      return [`레퍼런스의 ${labels[key]} 영역에 문구가 들어가지 않아요. 문구를 줄이거나 영역·글자 크기를 조정해 주세요.`];
    return [];
  });
  const brandIssue = referenceBrandProblem(layout,brand);
  if (brandIssue) problems.push(brandIssue);
  return problems;
}
