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
 * 「Aside에 맡기기」 (대표 2026-11-04): the same picture drawn on the PD's own GPT through Aside instead of the company API. The PD pastes
 * this into Aside; it draws with the same words the OS would send, and the PD puts the picture on the card with 「사진 넣기」.
 */
export function asideDrawInstruction(input: { scene: string; style: CardDrawStyle; refs: { name: string; url: string }[]; where: string }) {
  const { width, height } = CARD_DRAW_SIZE;
  return [
    "[카드 그림 그리기 → 브랜디 OS 카드에 넣기]",
    "0. 그림은 내 GPT로 그립니다(GPT 이미지 모델). 로그인은 담당자가 직접 합니다. 비밀번호는 묻거나 입력하지 마세요.",
    input.refs.length ? `1. 같은 얼굴로 그리도록 참고 그림 ${input.refs.length}장을 내려받습니다(주소는 1시간 동안 열려요).\n${input.refs.map((ref, index) => `   ${index + 1}) ${ref.name}: ${ref.url}`).join("\n")}` : "1. 참고 그림은 없습니다.",
    `2. GPT에 ${input.refs.length ? "참고 그림을 위 순서대로 붙이고 " : ""}아래 글을 그대로 넣어 세로 4:5(${width} × ${height}) 그림 한 장을 그립니다.`,
    "---",
    cardDrawPrompt(input.scene, input.style, input.refs.map(ref => ref.name)),
    "---",
    "3. 그림에 글자 · 말풍선 · 로고가 들어갔거나, 같은 사람이 두 번 그려졌거나, 말하지 않은 캐릭터가 끼어들었으면 같은 글로 다시 그립니다.",
    "4. 마음에 드는 그림을 PNG로 내려받습니다.",
    `5. 브랜디 OS › ${input.where}에서 「사진 넣기」로 그 그림을 올립니다.`,
    "6. 올린 카드를 담당자에게 보여 줍니다.",
  ].join("\n");
}

