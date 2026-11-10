import type { CreativeSize } from "./formats.ts";

export const PLACEMENT_IDS = ["feed-square", "feed-portrait", "story", "reel"] as const;
export type PlacementId = (typeof PLACEMENT_IDS)[number];
export type OutputWidth = 1080 | 1440;
export const SAFE_ZONE_VERSION = "meta-static-2026-11-10.1";

const placements = {
  "feed-square": { label: "피드 정사각형 (1:1)", size: "square", aspect: 1 },
  "feed-portrait": { label: "피드 세로 (4:5)", size: "portrait", aspect: 4 / 5 },
  story: { label: "스토리 (9:16)", size: "story", aspect: 9 / 16 },
  reel: { label: "릴스 (9:16)", size: "story", aspect: 9 / 16 },
} as const;

export function defaultPlacement(size: CreativeSize): PlacementId {
  return { square: "feed-square", portrait: "feed-portrait", story: "story" }[size] as PlacementId;
}

/** Source and review notes: docs/image-ad-safe-zones.md. Round inwards to protect boundary pixels. */
export function resolvePlacement(size: CreativeSize, placement: PlacementId = defaultPlacement(size), outputWidth: OutputWidth = 1080) {
  if (!Object.hasOwn(placements, placement) || (outputWidth !== 1080 && outputWidth !== 1440)) {
    throw new Error("지원하는 광고 게재 위치와 해상도를 선택해 주세요.");
  }
  const spec = placements[placement];
  const width = outputWidth;
  const height = Math.round(width / spec.aspect);
  const fullscreen = spec.size === "story";
  // Fullscreen uses a conservative rectangle above the lower-right UI. Feed margins are an OS design choice.
  const x = Math.ceil(width * (fullscreen ? 6 : 5) / 100);
  const y = Math.ceil(height * (fullscreen ? 14 : 5) / 100);
  const bottom = Math.ceil(height * (fullscreen ? 40 : 5) / 100);
  return { id: placement, label: spec.label, size: spec.size, width, height,
    safe: { x, y, width: width - 2 * x, height: height - y - bottom }, policyVersion: SAFE_ZONE_VERSION };
}
