import { type CardDraft, type CardSlide, type MyinCharacter } from "../formats";

function slide(type: CardSlide["type"], fields: CardSlide["fields"], character: MyinCharacter, action: string, page: number): CardSlide {
  return { type, fields, scene: { character, action, kind: type === "summary" ? "worksheet" : page === 2 ? "comparison" : "character", side: "right", size: "large" },
    photo: { path: String(page), w: 1100, h: 550 } };
}

export const receiptDraft: CardDraft = {
  id: "receipt", format: "list", at: "", by: "", caption: "다음 정산 전에 영수증 사진 한 장으로 시험해 보세요.", hashtags: ["업무기록", "영수증", "사진정리"],
  slides: [
    slide("cover", { head: "그 영수증, 어디 찍어 뒀지?", sub: "정산 직전에 사진첩부터 뒤지는 사람에게" }, "까닭이", "사진첩의 여행 사진 사이에서 종이 영수증을 찾으며 확대경을 댄다.", 1),
    slide("item", { title: "찾는 길을 하나로", before: "사진 전체를 거슬러 올라가기", body: "영수증 앨범을 열고, 결제한 날 근처부터 찾아봐요." }, "탐색이", "왼쪽은 사진 더미를 훑고 오른쪽은 영수증 앨범을 손가락으로 연다.", 2),
    slide("item", { title: "건네기 전에 확대", body: "정산 담당자가 묻기 전에, 가게 이름과 결제 날짜가 사진 한 장에 보이는지 확인해요." }, "전달이", "동료에게 휴대폰을 기울여 가게 도장과 날짜 칸을 확대해 보여준다.", 3),
    slide("item", { title: "점심 한 끼로 시험", body: "오늘 받은 영수증을 앨범에 넣어 봐요. 동료가 금액을 물으면 그 사진을 다시 꺼내 보세요." }, "만남이", "동료와 카페에서 종이 영수증을 펴고 계산대 위에서 사진을 찍는다.", 4),
    slide("summary", { line: "내가 다시 찾을 단서", worksheet: "어떤 결제였나\n사진은 어디에 뒀나\n다음에 무엇부터 찾을까" }, "성찰이", "단서 카드 세 장 중 하나를 골라 작은 노트 옆에 놓는다.", 5),
    slide("end", { line: "다음 결제에서 바로 한 번", action: "찍고 앨범에 넣기" }, "약속이", "계산대에서 방금 찍은 사진을 영수증 표시가 있는 앨범에 넣는다.", 6),
  ],
};
