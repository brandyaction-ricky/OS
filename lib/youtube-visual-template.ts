/** Versioned visual direction for the narrated YouTube pilot: Logan's mind-map video (2026-10-15). */
export const YOUTUBE_VISUAL_TEMPLATE_VERSION = "brandyaction-mindmap-v1";

/**
 * The decks Logan's renderer draws, one per paragraph. `min`/`max` are the item counts his deck code
 * accepts (checked by drawing every deck), `items` is the item format from his manual. `chars` caps the
 * letters (spaces not counted) of each item, or of each side of a "|" item, so text stays inside its box;
 * the default follows his 2–8 rule, the others his own n6 items and what overflowed in the first C01 render.
 */
export const MINDMAP_ITEM_CHARS = 8;
export const MINDMAP_DECKS = {
  "01": { name: "행대비", use: "둘을 비교·대비", items: "[왼쪽, 오른쪽]", min: 2, max: 2, chars: 11 },
  "02": { name: "세로대비", use: "둘을 비교·대비(위→아래, 아래가 강조)", items: "[위, 아래]", min: 2, max: 2, chars: 11 },
  "03": { name: "2칸카드", use: "둘을 비교·대비", items: "[왼쪽, 오른쪽]", min: 2, max: 2, chars: 11 },
  "04": { name: "벤2원", use: "교집합·공통점", items: "[왼쪽, 오른쪽, 가운데]", min: 3, max: 3, chars: 4 },
  "06": { name: "체크목록", use: "여러 항목 나열·확인", items: "[항목…]", min: 2, max: 4, chars: 9 },
  "07": { name: "취소선", use: "앞의 것을 지우고 마지막만 남김", items: "[항목…] 앞 항목은 취소선, 마지막만 남음", min: 2, max: 3 },
  "08": { name: "질문카드", use: "질문", items: "[위, 아래] 아래가 질문 문장", min: 2, max: 2, chars: 12 },
  "09": { name: "2x2", use: "항목을 2×2로 분류", items: "[\"제목|설명\" ×4]", min: 4, max: 4 },
  "10": { name: "3열카드", use: "여러 항목 나열·결론", items: "[\"줄1|줄2\" ×3] (줄2는 생략 가능)", min: 3, max: 3 },
  "11": { name: "3행카드", use: "여러 항목 나열·행동", items: "[문장 ×3]", min: 3, max: 3, chars: 9 },
  "12": { name: "계층", use: "순서·단계·층", items: "[위에서 아래로]", min: 2, max: 5 },
  "17": { name: "가로단계", use: "순서·단계·흐름", items: "[항목…]", min: 2, max: 4 },
  "18": { name: "세로단계", use: "순서·단계·흐름", items: "[항목…]", min: 2, max: 5 },
  "19": { name: "타임라인", use: "시간 순서", items: "[항목…]", min: 2, max: 5 },
  "20": { name: "지그재그", use: "교차·번갈아", items: "[단어 ×4]", min: 4, max: 4 },
  "21": { name: "번호목록", use: "여러 항목 나열·조건", items: "[항목…]", min: 2, max: 4, chars: 9 },
  "22": { name: "검정박스", use: "강조 주장", items: "[위 문장, 강조 문장]", min: 2, max: 2, chars: 14 },
  "23": { name: "밑줄강조", use: "강조 주장", items: "[위 문장, 강조 구절]", min: 2, max: 2, chars: 14 },
  "24": { name: "인용카드", use: "인용·책 소개", items: "[인용문(띄어쓰기 포함), 이름·출처]", min: 1, max: 2, chars: 40 },
  "25": { name: "공상승", use: "상승", items: "[단어]", min: 1, max: 1 },
  "26": { name: "공하강", use: "하강", items: "[단어]", min: 1, max: 1 },
  "27": { name: "수치그래프", use: "수치·비율 비교", items: "[라벨…]", min: 3, max: 6 },
  "28": { name: "버튼", use: "확인 행동", items: "[단어]", min: 1, max: 1 },
  "29": { name: "저울", use: "둘을 비교·무게", items: "[왼쪽, 오른쪽]", min: 2, max: 2, chars: 5 },
  "30": { name: "선그려지기", use: "연결·관계", items: "[나, 상대]", min: 2, max: 2 },
  "31": { name: "퍼즐", use: "조각을 맞춤", items: "[조각…]", min: 2, max: 4 },
  "34": { name: "카드모이기", use: "여러 항목 나열·합치기", items: "[항목…]", min: 2, max: 4 },
  "35": { name: "질문타이핑", use: "질문(영상 전체 1회)", items: "[질문 문장]", min: 1, max: 1, chars: 16 },
  "36": { name: "범위확장", use: "범위 확장", items: "[단어]", min: 1, max: 1 },
  "37": { name: "방향고르기", use: "선택지 중 고르기", items: "[선택지…]", min: 2, max: 4 },
  "38": { name: "파동", use: "반복·지속", items: "[단어]", min: 1, max: 1 },
  "39": { name: "말풍선", use: "대화·말", items: "[말…]", min: 2, max: 4, chars: 11 },
  "41": { name: "가로막대", use: "수치·비율 비교", items: "[\"라벨|0~1 비율\"…]", min: 2, max: 6 },
  "42": { name: "인물등장", use: "인물", items: "[인물 1~4명]", min: 1, max: 4, chars: 5 },
} as const;
export type MindmapDeck = keyof typeof MINDMAP_DECKS;
export const mindmapDeckIds = Object.keys(MINDMAP_DECKS) as MindmapDeck[];
