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

/**
 * 「내 GPT로 그리기」 (대표 2026-11-04): the same picture drawn in the PD's own ChatGPT instead of the company API. The picked 창고
 * pictures go in as one image, side by side in the order they were picked, so the scene's 「참고 그림 1 · 2」 still point at them.
 */
export function myGptDrawPrompt(scene: string, style: CardDrawStyle, refNames: string[]) {
  const { width, height } = CARD_DRAW_SIZE;
  return [
    CARD_DRAW_STYLES[style].prompt,
    refNames.length ? `The attached image shows these characters side by side, left to right: ${refNames.map((name, index) => `${index + 1}) ${name}`).join(", ")}. Draw them exactly as they look there (face, hair, body shape, outfit, line style).` : "",
    `Scene: ${scene.trim()}`,
    `Draw one portrait 4:5 picture (${width} × ${height}) for an Instagram card. Draw no letters, words, numbers, speech bubbles, captions, logos or watermarks: the text is added later.`,
  ].filter(Boolean).join("\n");
}

/** The 캐릭터 창고 pictures for a card's 나오는 사람 (「서윤 · 낙서」 ticks 「서윤 · 주인공 A」 and the 낙서 sheet), in 창고 order. */
export function castCharacters<T extends { name: string }>(characters: T[], cast: string) {
  const names = cast.trim().split(/[\s,·]+/).filter(Boolean);
  return names.length ? characters.filter(row => names.some(name => row.name.includes(name))).slice(0, CARD_DRAW_REFS_MAX) : [];
}

/**
 * 「그림 한꺼번에 › 내 GPT」 (대표 2026-11-04): several cards in one ChatGPT conversation. One side-by-side sheet holds every character the
 * cards need; each picture says what its own 「참고 그림 1 · 2」 are, and ChatGPT draws one per reply so the PD can paste them back in order.
 */
export function myGptBatchPrompt(style: CardDrawStyle, sheetNames: string[], items: { card: string; scene: string; refNames: string[] }[]) {
  const { width, height } = CARD_DRAW_SIZE;
  return [
    CARD_DRAW_STYLES[style].prompt,
    sheetNames.length ? `The attached image shows these characters side by side, left to right: ${sheetNames.map((name, index) => `${index + 1}) ${name}`).join(", ")}. Draw them exactly as they look there (face, hair, body shape, outfit, line style) in every picture.` : "",
    `Draw the ${items.length} pictures below in this order, one picture per reply: each a portrait 4:5 picture (${width} × ${height}) for an Instagram card. Under each picture write only its label (like 「${items[0]?.card ?? "1장"}」), then wait until I write 다음. Draw no letters, words, numbers, speech bubbles, captions, logos or watermarks in any picture: the text is added later.`,
    ...items.map((item, index) => `Picture ${index + 1} — 「${item.card}」${item.refNames.length ? ` (in this scene ${item.refNames.map((name, at) => `참고 그림 ${at + 1} = ${name}`).join(", ")})` : ""}: ${item.scene.trim()}`),
  ].filter(Boolean).join("\n\n");
}

