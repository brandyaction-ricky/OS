import { CARD_FORMATS, type CardFormatId, type CardSlide } from "./formats.ts";

export function planningOutline(formats: CardFormatId[]) {
  return formats.map(id => {
    const format = CARD_FORMATS[id];
    const sequence = format.slides.flatMap(spec => Array.from({ length: spec.min }, (_, index) =>
      spec.min > 1 ? `${spec.label} ${index + 1}` : spec.label));
    return `${format.name} · ${sequence.join(" → ")}`;
  }).join("\n");
}

// An editorial fixture for the seeded Monday project. It never impersonates a paid generation.
const mondayCopy = [
  ["일요일 밤, 월요일이 벌써 무겁다면", "잠들기 전 종이에 세 줄만 써 보세요"],
  ["떠오른 장면 적기", "‘출근이 싫다’에서 멈추지 말고 머릿속에 먼저 뜬 회의나 대화 하나를 적어요."],
  ["내가 고를 일 찾기", "회의 시간은 못 바꿔도 첫 질문은 고를 수 있어요. 내가 정할 부분에 밑줄을 그어요."],
  ["첫 행동 예약하기", "달력에 ‘9시, 회의 첫 질문 적기’를 넣어요. 월요일 아침에 시작할 곳이 생겨요."],
  ["장면 하나, 선택 하나, 행동 하나"],
  ["내일 첫 5분을 어디에 쓸까요?", "달력에 적기"],
];
const mondayAlternative = [
  ["월요일 걱정이 먼저 출근한 밤", "걱정 하나를 내일의 작은 선택으로 옮겨요"],
  ["걱정에 이름 붙이기", "‘내일이 싫다’ 대신 ‘회의 첫 보고가 걸린다’처럼 한 장면을 골라요."],
  ["바꿀 부분에 표시", "회의 순서 옆에 내가 준비할 첫 문장을 적어요."],
  ["시작 시간 정하기", "출근 직후 달력에 다섯 분을 잡고 그 문장을 소리 내 읽어요."],
  ["걱정을 내일의 첫 행동으로 옮겨요"],
  ["달력을 열고 첫 행동을 적어요", "첫 5분 정하기"],
];
export function mondayFields(slide: CardSlide, index: number, alternate = false) {
  const words = (alternate ? mondayAlternative : mondayCopy)[index];
  const keys = CARD_FORMATS.steps.slides.find(spec => spec.type === slide.type)?.fields;
  if (!words || !keys || keys.length !== words.length) return null;
  return Object.fromEntries(keys.map((field, i) => [field.key, words[i]]));
}
