import type { CardDraft } from "./formats.ts";
export const MYIN_DESIGNS = [
  { id: "myin-character", name: "캐릭터 중심", color: "#EEF4FF", detail: "친근한 질문 · 추천" },
  { id: "myin-report", name: "보고서 중심", color: "#FFFFFF", detail: "실제 공개 견본 활용" },
  { id: "myin-question", name: "질문 중심", color: "#2F65D9", detail: "짧고 선명한 첫인상" },
] as const;
export const MYIN_TOPIC = "오래 일했는데, 내 강점은 뭘까?";
export const MYIN_ART_PROMPT = "설명용 2D 일러스트. 반복한 업무 행동을 살펴보는 장면: 메모 카드, 노트, 돋보기와 연필. 블루 #2F65D9, 연한 블루 #EEF4FF, 보라 #A786DF, 크림 #FBF7EE. 단순한 선과 여백, 투명 배경. 글자·숫자·그래프·실제 보고서를 생성하지 않는다. 캐릭터는 별도 원본으로 합성한다.";
export const MYIN_BASIS = [
  { title: "BRANDYACTION 핵심 컨텍스트", section: "해온 일에서 강점과 잘할 조건을 찾아 다음 선택으로 연결", version: "문서 v12" },
  { title: "카드뉴스 정본", section: "§1·4·5·6: 없는 사례를 만들지 않기, 한 장 한 메시지, 마지막 행동", version: "문서 v3 · v0.3 초안" },
  { title: "원고 말투 정본", section: "§2·5·6·9: 관찰부터 쓰기, 마음속 1인칭, 구체적인 행동", version: "문서 v10 · v1.8" },
  { title: "카드뉴스 디자인 정본", section: "안전 여백·Pretendard·실제 자료 사용 + 2026-11-27 MYIN 디자인 기준", version: "문서 v2 · MYIN 디자인 추가 반영" },
  { title: "마이인 캐릭터 정본", section: "원본의 머리·몸 비율과 눈·색상 유지", version: "문서 v3" },
] as const;
export function myinExample(): CardDraft {
  return {
    id: "myin-strengths-example", format: "list", formatVersion: 1, workTitle: MYIN_TOPIC,
    at: "2026-11-27", by: "정본 원문 확인 후 제작한 예시",
    production: { title: MYIN_TOPIC, format: "list", memo: "해온 일의 행동, 상대에게 준 도움, 잘할 수 있었던 조건을 기록한다. 가상 업무 장면은 설명용 예시로 표시한다. 강점이나 직업을 단정하지 않는다.", direction: "경험을 돌아보고 다음 일에서 작게 확인하기", detail: "8장 · 기록할 행동 하나", design: "myin-character" },
    slides: [
      { type: "cover", fields: { head: "오래 일했는데,\n내 강점은 뭘까?", sub: "해온 일에서 찾아볼 세 가지" } },
      { type: "item", myinVisual: "observation", fields: { title: "매일 하던 일을 꺼내요", body: "예를 들어, 회의가 끝날 때마다 흩어진 의견을 모아 다음 할 일을 정리했다면요.", before: "설명용 예시 · 회의가 끝난 뒤" } },
      { type: "item", fields: { title: "내가 한 일을 적어요", body: "‘회의에 참석했다’에서 한 번 더 들어가요. 빠진 의견을 묻고, 할 일을 나눠 적었네요.", before: "내가 반복해서 한 행동은?" } },
      { type: "item", fields: { title: "도움이 된 순간을 봐요", body: "그 정리 덕분에 누가 뭘 할지 분명해졌다면, 내 행동이 상대에게 준 도움도 보이죠.", before: "그 행동으로 뭐가 달라졌나?" } },
      { type: "item", fields: { title: "잘됐던 조건도 남겨요", body: "미리 자료를 읽을 시간이 있었는지, 의견을 편하게 물을 수 있었는지도 함께 적어요.", before: "어떤 상황에서 잘됐나?" } },
      { type: "item", myinVisual: "report", fields: { title: "욕구도 함께 살펴봐요", body: "계속 손이 가는 일은 뭔가요? 보고서의 설명과 내가 적은 경험을 함께 살펴봐요.", before: "내가 하고 싶은 일까지" } },
      { type: "summary", fields: { line: "내 경험 하나를 적어봐요", worksheet: "내가 반복한 행동은?\n누구에게 어떤 도움이 됐나?\n어떤 조건에서 잘됐나?" } },
      { type: "end", fields: { line: "다음 일에서도\n한 번 더 해봐요", action: "저장하고 한 가지 적기" } },
    ],
    caption: "경력은 쌓였는데, 내가 뭘 잘하는지 설명하려면 말이 막히죠. 해온 일 하나를 꺼내서 내가 직접 한 행동부터 적어봐요.\n\n회의에 참석했다는 말만으로는 그 안에서 무엇을 했는지 잘 보이지 않아요. 빠진 의견을 물었는지, 여러 말을 모아 다음 할 일을 정했는지까지 적어보면 구체적인 행동이 남아요. 그 행동이 누구에게 어떤 도움이 됐는지, 잘할 수 있었던 조건도 함께 살펴봐요.\n\n카드 속 회의 장면은 설명용 예시예요. 한 장면으로 강점이나 맞는 직업을 확정할 수는 없어요. 다음 일에서도 그 행동을 해보고 어떤 도움이 생기는지 확인해요.\n\n마지막 기록 양식을 저장하고, 오늘 끝낸 일 하나로 채워봐요. 보고서 이미지는 MYIN 공식 홈페이지의 공개 견본입니다.",
    hashtags: ["내강점찾기", "커리어고민", "자기이해", "마이인"],
  };
}
