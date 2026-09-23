/** Versioned visual direction approved for the narrated YouTube pilot. */
export const YOUTUBE_VISUAL_TEMPLATE_VERSION = "brandyaction-character-draw-v3";

// Stable identifiers; private storage resolves these to owned artwork.
export const youtubeCharacterAssetRoles = [
  "trace_search",
  "energy_low",
  "neutral_draw",
  "pattern_map",
  "focus_work",
  "habit_tracker",
  "direction_compass",
] as const;
export type YoutubeCharacterAssetRole = (typeof youtubeCharacterAssetRoles)[number];

export const youtubeCharacterAssetRoleLabels: Record<YoutubeCharacterAssetRole, string> = {
  trace_search: "흔적 찾기",
  energy_low: "에너지 관리",
  neutral_draw: "그리기",
  pattern_map: "패턴 지도",
  focus_work: "몰입",
  habit_tracker: "습관 기록",
  direction_compass: "방향 찾기",
};

export const youtubeLayoutTemplates = [
  "question_character",
  "situation_character",
  "comparison_cards",
  "relationship_diagram",
  "one_line_action",
] as const;

export const youtubeVisualTypes = [
  "character_asset",
  "motion_graphic",
  "diagram",
  "generated_still",
  "source_asset",
] as const;
