/** Versioned visual direction approved for the narrated YouTube pilot. */
export const YOUTUBE_VISUAL_TEMPLATE_VERSION = "brandyaction-character-draw-v1";

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
