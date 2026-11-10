import type { CreativeSize } from "./formats.ts";
import type { PlacementId, OutputWidth, resolvePlacement } from "./placement.ts";
export type RenderDesign = { font: "original" | "sans" | "serif" | "hand" | "sign"; card: "original" | "frame" | "paper"; placement: PlacementId; outputWidth?: OutputWidth };
export function artworkGeometry(size: CreativeSize, design: RenderDesign | undefined, sourceWidth: number, sourceHeight: number): { spec: ReturnType<typeof resolvePlacement>; x:number; y:number; width:number; height:number; scale:number; padding:number; card:RenderDesign["card"] };
export function placedSvg(scene: string, options: { design?: RenderDesign; displayFontData?: string }, background: string): string;
