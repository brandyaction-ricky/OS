import { resolvePlacement } from "./placement.ts";

/** Fit the original vector scene inside the visible area; card borders and shadows are decorative. */
export function artworkGeometry(size, design, sourceWidth, sourceHeight) {
  const spec = resolvePlacement(size, design?.placement, design?.outputWidth);
  const { safe } = spec;
  const card = design?.card ?? "original";
  const padding = Math.round(spec.width * (card === "frame" ? .022 : card === "paper" ? .038 : 0));
  const scale = Math.min((safe.width - 2 * padding) / sourceWidth, (safe.height - 2 * padding) / sourceHeight);
  const width = scale * sourceWidth, height = scale * sourceHeight;
  const x = safe.x + (safe.width - width) / 2;
  const y = safe.y + (safe.height - height) / 2;
  return { spec, x, y, width, height, scale, padding, card };
}

/** Only our renderers supply the inner SVG; uploaded artwork is always a raster data URL. */
export function placedSvg(scene, options, background) {
  const { design, displayFontData } = options;
  const { spec, card, x, y, scale, width, height, padding } = artworkGeometry("portrait", design, 1080, 1350);
  const edge = Math.ceil(spec.width / 360);
  const board = card === "paper" ? "#DFCDB4" : background;
  let decoration = "";
  if (card === "frame") {
    decoration = `<rect x="${x-padding}" y="${y-padding}" width="${width+2*padding}" height="${height+2*padding}" fill="#FEFDFA" stroke="#202324" stroke-width="${edge}"/><rect x="${x-edge*2}" y="${y-edge*2}" width="${width+4*edge}" height="${height+4*edge}" fill="#202324"/>`;
  } else if (card === "paper") {
    decoration = `<rect x="${x-padding*.55}" y="${y-padding*.45}" width="${width+padding*1.55}" height="${height+padding*1.55}" fill="#A38E72"/><rect x="${x-padding*.8}" y="${y-padding*.8}" width="${width+padding*1.6}" height="${height+padding*1.6}" fill="#FFF9EF"/>`;
  }
  let style = "";
  const font = design?.font ?? "original";
  if (font === "sans") style = "<style>.ad-headline{font-family:MyinAd,Pretendard,sans-serif}</style>";
  if (["hand","serif","sign"].includes(font)) {
    if (typeof displayFontData !== "string" || !/^data:font\/woff2;base64,[A-Za-z0-9+/=]+$/.test(displayFontData)) throw new Error("선택한 서체 파일이 필요합니다.");
    style = `<style>@font-face{font-family:EditedFont;src:url("${displayFontData}") format("woff2");font-weight:100 900}.ad-headline{font-family:EditedFont,MyinAd,sans-serif}</style>`;
  }
  let bleed = "";
  if (spec.size === "story") {
    if (["M01","D12","M09"].includes(options.formatId)) {
      const photo = options.photo; // already validated by the source renderer
      const opacity = options.formatId === "M09" ? .45 : .25;
      bleed = `<defs><filter id="safe-ambient" x="-10%" y="-10%" width="120%" height="120%"><feGaussianBlur stdDeviation="18"/>${options.formatId === "M09" ? '<feColorMatrix type="saturate" values="0"/>' : ""}</filter></defs><image x="-3%" y="-3%" width="106%" height="106%" preserveAspectRatio="xMidYMid slice" href="${photo}" opacity="${opacity}" filter="url(#safe-ambient)"/>`;
    } else {
      const light = options.formatId === "A04" ? "#F5F0D5" : "#3B3531";
      bleed = `<svg width="${spec.width}" height="${spec.height}" viewBox="0 0 1080 1920" preserveAspectRatio="none"><g fill="none" stroke="${light}" stroke-width="5" opacity=".1"><path d="M-130 530 510 -110M-160 580 530 -110M550 2050 1200 1400M550 2100 1250 1400"/></g></svg>`;
    }
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${spec.width}" height="${spec.height}" viewBox="0 0 ${spec.width} ${spec.height}">${style}<rect width="${spec.width}" height="${spec.height}" fill="${board}"/>${bleed}${decoration}<g data-protected-art="true" transform="translate(${x} ${y}) scale(${scale})">${scene}</g></svg>`;
}
