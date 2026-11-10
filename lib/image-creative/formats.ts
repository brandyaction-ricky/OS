import { FORMAT_TEST_FORMATS, type WarehouseFormatId } from "./format-test-renderer.mjs";

/** Image-ad format candidates. Catalog inclusion is implementation readiness, never user approval or measured performance. */
export type CreativeSize = "square" | "portrait" | "story";
export const CREATIVE_SIZES: Record<CreativeSize, { width: number; height: number; label: string }> = {
  square: { width: 1080, height: 1080, label: "정사각 1:1" },
  portrait: { width: 1080, height: 1350, label: "피드 4:5" },
  story: { width: 1080, height: 1920, label: "스토리 9:16" },
};
export const LEGACY_IMAGE_FORMAT_IDS = ["photo_headline", "split_compare", "note", "annotated", "object_spotlight", "checklist", "question", "typography", "steps", "conversation", "reframe", "report_crop"] as const;
type LegacyImageFormatId = typeof LEGACY_IMAGE_FORMAT_IDS[number];
export type ImageFormatId = LegacyImageFormatId | WarehouseFormatId;
export const WAREHOUSE_FORMAT_IDS = FORMAT_TEST_FORMATS.map(format => format.id);
export const IMAGE_FORMAT_IDS: readonly ImageFormatId[] = [...LEGACY_IMAGE_FORMAT_IDS, ...WAREHOUSE_FORMAT_IDS];
export function isWarehouseFormat(id: unknown): id is WarehouseFormatId {
  return FORMAT_TEST_FORMATS.some(format => format.id === id);
}
export interface ImageFormat {
  id: ImageFormatId; version: 1 | 2; name: string; when: string; assetRequired: boolean; supportsAsset: boolean;
  bodyLines?: number; photoGuide?: string; limits: { headline: number; body: number; cta: number };
  keywords: string[]; status: "candidate"; references: { title: string; url: string; sourceId: string; basis: string }[];
}
// References are structural inspiration, not copied artwork or evidence of campaign performance.
// AdDogs entries are gallery reproductions; the advertiser's original campaign was not independently verified.
const REFERENCES: Partial<Record<ImageFormatId, ImageFormat["references"]>> = {
  photo_headline: [{ title: "AdDogs · Omnisend 공감 장면", url: "https://www.addogs.ai/ad-examples", sourceId: "F19", basis: "큰 실제 장면과 짧은 문제 문장" }],
  split_compare: [{ title: "Liz Fosslien · 계기판 대비", url: "https://www.fosslien.com/liz-fosslien-gas-fuel-showing-burnout", sourceId: "F04", basis: "같은 대상 두 가지를 나란히 대비하는 구조" }],
  annotated: [{ title: "AdDogs · Well 중앙 대상 주석", url: "https://www.addogs.ai/ad-examples", sourceId: "F16", basis: "보여주는 대상에서 한 부분을 짚는 구조" }],
  object_spotlight: [{ title: "HubSpot · 미니멀 인쇄 광고 모음", url: "https://blog.hubspot.com/agency/minimalist-print-ads", sourceId: "F09", basis: "한 물체를 크게 보여주는 구조; 도형·원본 작품은 복제하지 않음" }],
  checklist: [{ title: "Liz Fosslien · 화상 회의 빙고", url: "https://www.fosslien.com/liz-fosslien-bingo-for-virtual-meetings", sourceId: "F06", basis: "고객이 자기 상황을 대조하는 참여 구조; 빙고 대신 세 줄로 단순화" }],
  question: [{ title: "AdDogs · Misfits Market 질문과 대상", url: "https://www.addogs.ai/ad-examples", sourceId: "F17", basis: "답이 궁금한 질문과 하나의 눈에 보이는 대상" }],
  typography: [{ title: "Liz Fosslien · 문장이 그리는 굴곡", url: "https://www.fosslien.com/liz-fosslien-doing-your-best-might-look-different-each-day", sourceId: "F05", basis: "짧은 문장을 시각의 중심으로 사용; 원본 경로·문장 미사용" }],
  steps: [{ title: "Liz Fosslien · 크기가 달라지는 세 단계", url: "https://www.fosslien.com/liz-fosslien-a-really-hard-thing", sourceId: "F02", basis: "한 번에 읽히는 세 단계; 개선 정도를 나타내는 원의 크기는 미사용" }],
  reframe: [{ title: "Liz Fosslien · 단순 평가와 다른 가능성", url: "https://www.fosslien.com/liz-fosslien-why-i-procrastinated", sourceId: "F01", basis: "한 가지 평가를 다른 가능성으로 다시 보는 구조" }],
};
/** Conservative full-width character capacities shared with the fixed renderer. Explicit newlines consume lines too. */
export const IMAGE_TEXT_SLOTS: Record<LegacyImageFormatId, { headline: [number, number]; body: [number, number] }> = {
  photo_headline: { headline: [14, 2], body: [27, 2] },
  split_compare: { headline: [14, 2], body: [8, 5] },
  note: { headline: [10, 3], body: [17, 4] },
  annotated: { headline: [14, 2], body: [24, 2] },
  object_spotlight: { headline: [14, 2], body: [26, 2] },
  checklist: { headline: [14, 2], body: [19, 2] },
  question: { headline: [13, 3], body: [11, 4] },
  typography: { headline: [8, 4], body: [22, 2] },
  steps: { headline: [14, 2], body: [18, 2] },
  conversation: { headline: [12, 3], body: [17, 4] },
  reframe: { headline: [14, 2], body: [15, 2] },
  report_crop: { headline: [14, 2], body: [26, 2] },
};
const format = (id: ImageFormatId, name: string, when: string, assetRequired: boolean, headline: number, body: number, keywords: string[], bodyLines?: number): ImageFormat =>
  ({ id, version: 1, name, when, assetRequired, supportsAsset: assetRequired || id === "question", limits: { headline, body, cta: 18 }, keywords, ...(bodyLines ? { bodyLines } : {}), status: "candidate", references: REFERENCES[id] ?? [] });
function warehouse(id: WarehouseFormatId, when: string, photoGuide: string, keywords: string[], chapter: string): ImageFormat {
  const name = FORMAT_TEST_FORMATS.find(format => format.id === id)!.label;
  return { id, name, version: 2, when, photoGuide, keywords, assetRequired: true, supportsAsset: true,
    limits: { headline: 32, body: 34, cta: 12 }, status: "candidate",
    references: [{ title: name, sourceId: id, url: "https://brandyaction-os.vercel.app/knowledge/doc/" + chapter, basis: when }] };
}
export const IMAGE_FORMATS: Record<ImageFormatId, ImageFormat> = {
  M01: warehouse("M01", "망설이는 순간을 인물 사진과 손글씨 말풍선으로 보여줄 때", "인물의 얼굴이 잘 보이고 주변에 말풍선을 놓을 여백이 있는 사진.", ["속마음", "독백", "고민", "공감", "망설", "계획"], "d5681399-e3e7-4275-ad08-f43754e12f88"),
  A04: warehouse("A04", "한 질문에서 갈라지는 두 선택지를 방향 표지로 보여줄 때", "작은 원형으로 크롭해도 인물의 표정이 남는 정면 또는 반측면 사진.", ["갈림길", "선택", "기준", "비교", "고르", "진단"], "29f424df-f389-4ee4-9ff7-45202cdde7f7"),
  A10: warehouse("A10", "찾고 있지만 답이 없는 상황을 빈 검색 결과로 보여줄 때", "렌즈 일부에 옅게 비쳐도 상황이 전달되는 한 피사체의 사진.", ["검색", "빈칸", "선택 기준", "찾는", "찾기"], "29f424df-f389-4ee4-9ff7-45202cdde7f7"),
  D12: warehouse("D12", "사람이 떠올린 질문을 미리 채운 입력창으로 보여줄 때", "인물의 얼굴이 오른쪽에 있고 눈길과 아래 입력창이 이어질 수 있는 사진.", ["입력", "질문", "참여", "신청", "지원"], "d344e918-a847-4f0a-b7b6-427ec26bb900"),
  M09: warehouse("M09", "결정하기 직전 멈춘 행동을 흑백 사진 한 컷으로 보여줄 때", "손끝과 누르기 직전 대상이 함께 보이고, 사이의 간격이 확대 후에도 읽히는 사진.", ["손끝", "클릭", "망설", "지원", "결정", "실행"], "d5681399-e3e7-4275-ad08-f43754e12f88"),
  photo_headline: format("photo_headline", "사진 한 장 · 한 문장", "실제 장면이나 상품 자체를 먼저 보여줄 때", true, 28, 44, ["사진", "장면", "상품", "유입", "인지"]),
  split_compare: format("split_compare", "좌우 비교", "같은 기준의 두 상황을 한눈에 비교할 때", false, 28, 64, ["비교", "차이", "선택", "전환"], 2),
  note: format("note", "짧은 메모", "일상에서 써둔 메모처럼 공감되는 한마디를 건넬 때", false, 30, 64, ["공감", "메모", "경험", "유입"]),
  annotated: format("annotated", "사진 속 한곳 짚기", "실제 이미지에서 봐야 할 부분을 짧게 설명할 때", true, 28, 40, ["근거", "상세", "기능", "설명", "전환"]),
  object_spotlight: format("object_spotlight", "물체 하나 크게", "한 물체만으로 메시지를 이해할 수 있을 때", true, 28, 40, ["물체", "비유", "후킹", "인지"]),
  checklist: format("checklist", "세 가지 체크", "고객이 자기 상황을 대조하거나 제공 내용을 훑게 할 때", false, 28, 72, ["체크", "상황", "증상", "제공", "전환"], 3),
  question: format("question", "질문 하나", "답이 떠오르는 쉬운 질문으로 참여를 유도할 때", false, 34, 42, ["질문", "참여", "진단", "유입"]),
  typography: format("typography", "짧은 문장 포스터", "이미지 없이도 즉시 이해되는 강한 한 문장이 있을 때", false, 22, 38, ["한 문장", "메시지", "후킹", "인지"]),
  steps: format("steps", "세 단계 흐름", "받는 과정이나 사용법을 간단히 보여줄 때", false, 28, 72, ["과정", "방법", "순서", "전환"], 3),
  conversation: format("conversation", "대화 두 마디", "고객의 실제 질문과 답을 짧게 대비할 때", false, 30, 60, ["질문", "답", "대화", "공감"]),
  reframe: format("reframe", "생각 바꾸기", "익숙한 평가를 다른 관점의 말로 다시 보게 할 때", false, 26, 64, ["오해", "관점", "다시", "공감"], 2),
  report_crop: format("report_crop", "실제 결과 화면", "고객이 무엇을 받는지 공개 가능한 실제 화면으로 보여줄 때", true, 28, 42, ["보고서", "결과", "실제", "근거", "구매"]),
};
export const isImageFormat = (value: unknown): value is ImageFormatId => typeof value === "string" && Object.hasOwn(IMAGE_FORMATS, value);
/** Rules-based suggestions, not a performance prediction. No candidate is silently approved. */
export function recommendImageFormats(brief: { objective: string; funnel: string; audience: string; product: string; offer: string; facts: string; brand?: string }, hasAsset = false, size: CreativeSize = "portrait") {
  const text = Object.values(brief).join(" ").toLocaleLowerCase("ko-KR");
  return IMAGE_FORMAT_IDS.filter(id => !isWarehouseFormat(id) || (size === "portrait" && hasAsset && Boolean(brief.brand?.trim()))).map(id => {
    const entry = IMAGE_FORMATS[id], matches = entry.keywords.filter(word => text.includes(word));
    return { id, name: entry.name, reason: matches.length ? `${matches.join(" · ")} 내용을 담기 좋은 구조예요. ${entry.when}.` : entry.when,
      score: matches.length, needsAsset: entry.assetRequired && !hasAsset, status: entry.status };
  }).sort((a, b) => b.score - a.score || Number(a.needsAsset) - Number(b.needsAsset)).slice(0, 4);
}
