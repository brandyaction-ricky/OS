// 카드 그림 (대표 2026-11-02, 웹툰형 캐릭터 설정): GPT draws one picture for a card's photo slot. It draws no letters — the card puts
// its words on top in Pretendard — and keeps the faces of the 캐릭터 창고 pictures it is given, so every 화 shows the same people.

/** 4:5 like the card; GPT Image takes any size whose sides are multiples of 16. */
export const CARD_DRAW_SIZE = { width: 1024, height: 1280 } as const;
export const CARD_DRAW_SCENE_MAX = 500;
export const CARD_DRAW_REFS_MAX = 4;
/** The 캐릭터 창고 holds this many pictures; one more is refused until one is taken out. */
export const CARD_CHARACTERS_MAX = 60;

export const CARD_DRAW_STYLES = {
  webtoon: { label: "웹툰", prompt: "Modern Korean webtoon art: clean confident black line art, flat cel colours with soft shading, big expressive faces (shock, shouting, sweat drops), a detailed photo-like background. Keep faces in the middle band and leave calm room at the top and bottom edges, where speech bubbles will sit." },
  simple: { label: "설명 그림", prompt: "Simple flat 2D explanatory illustration: few shapes on a plain light background, no gradients, gloss or texture, colours limited to deep blue #212CB0, gold #EED467, navy #151D2C and greys." },
} as const;
export type CardDrawStyle = keyof typeof CARD_DRAW_STYLES;
export const CARD_DRAW_QUALITY = { medium: "보통", high: "선명하게" } as const;
export type CardDrawQuality = keyof typeof CARD_DRAW_QUALITY;

export interface CardDrawInput { scene: string; style: CardDrawStyle; quality: CardDrawQuality; refs: string[] }
/** A 캐릭터 창고 picture: a drawn or uploaded card picture kept to draw the same character again. */
export interface CardCharacter { id: string; name: string; path: string; at: string; byId: string; by: string }
export type CardCharacterView = CardCharacter & { url: string };

/** What GPT is asked: the style, the reference pictures by name in the order they are sent, the PD's scene, and no letters. */
export function cardDrawPrompt(scene: string, style: CardDrawStyle, refNames: string[]) {
  return [
    CARD_DRAW_STYLES[style].prompt,
    refNames.length ? `Reference pictures, in order: ${refNames.map((name, index) => `${index + 1}) ${name}`).join(", ")}. Draw these characters exactly as they look there (face, hair, body shape, outfit, line style).` : "",
    `Scene: ${scene.trim()}`,
    "A portrait 4:5 picture for an Instagram card. Draw no letters, words, numbers, speech bubbles, captions, logos or watermarks: the text is added later.",
  ].filter(Boolean).join("\n");
}
