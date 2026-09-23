/** Versioned visual direction approved for the narrated YouTube pilot. */
export const YOUTUBE_VISUAL_TEMPLATE_VERSION = "brandyaction-content-only-grid-v5";

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

// A paragraph can contain several distinct graphic ideas. Each visual beat
// belongs to a spoken anchor and carries its own action and short typography.
export const youtubeVisualActions = [
  "draw_character",
  "draw_diagram",
  "draw_connector",
  "transform_diagram",
  "clear_and_draw",
] as const;

// Fixed composition choices keep each beat's typography and graphics aligned.
export const youtubeBeatCompositions = [
  "centered_object",
  "equal_two_columns",
  "equal_three_columns",
  "centered_flow",
  "character_left_graphic_right",
] as const;
