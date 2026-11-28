import { emptyCardDraft, type CardFormatId, type CardSlide } from "./formats.ts";

// The same editorial subject makes the differences between formats visible.
const samples: Record<CardFormatId, CardSlide> = {
  list: { type: "item", layout: "spotlight", fields: { title: "회의부터 떠오른 밤", body: "걱정이 시작된 순간, 머릿속에 떠오른 회의 이름을 적어요." } },
  myth: { type: "pair", fields: { myth: "할 일을 전부 적으면 마음이 놓일 거야", fact: "목록을 다 써도 첫 행동이 비어 있을 수 있어요.", basis: "‘보고 준비’ 옆에 ‘첫 질문 적기’를 붙여 보세요." } },
  quote: { type: "line", fields: { text: "내일의 회의를 오늘 밤에 두 번 할 필요는 없어요.", note: "첫 질문만 메모하고 수첩을 덮어요." } },
  compare: { type: "compare", fields: { title: "같은 회의를 준비하는 두 방법", leftLabel: "막연한 목록", left: "주간 회의 준비하기", rightLabel: "첫 행동", right: "먼저 물어볼 질문 한 줄 적기" } },
  steps: { type: "step", fields: { title: "걱정에 이름 붙이기", body: "‘월요일이 싫다’ 대신 ‘회의 첫 보고가 걸린다’처럼 한 장면을 적어요." } },
  structure: { type: "map", fields: { center: "내일의 첫 5분", note: "장면, 선택, 행동을 하나씩 연결해요." } },
  webtoon: { type: "panel", fields: { narration: "일요일 밤 열한 시", talk: "내일 첫마디가 뭐였지?", think: "한 줄만 적고 자자." } },
};

const CARD_SAMPLE_SUB: Record<CardFormatId, string> = { list: "메모에 남길 세 가지", myth: "준비에 대한 오해", quote: "잠들기 전 읽는 한 문장", compare: "두 메모를 나란히", steps: "첫 행동까지 세 단계", structure: "준비를 이루는 세 요소", webtoon: "" };

export function formatSample(format: CardFormatId) {
  const draft = emptyCardDraft(format, "sample", "", "");
  draft.slides[0].fields = format === "webtoon" ? { episode: "1화", title: "내일 첫마디" } : { head: "회의 전날의 첫 질문", sub: CARD_SAMPLE_SUB[format] };
  draft.slides[1] = samples[format];
  draft.slides[draft.slides.length - 1].fields = { line: "내일 먼저 묻고 싶은 말은?", action: "질문 한 줄 적기" };
  if (format === "structure") {
    draft.slides[2].fields.title = "떠오른 장면";
    draft.slides[3].fields.title = "내가 고를 일";
  }
  return draft;
}
