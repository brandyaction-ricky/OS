import type { KnowledgeDocument, SearchResult } from "./types";

export const DEMO_DOCUMENTS: KnowledgeDocument[] = [
  {
    id: "demo-packaging",
    title: "패키징 원칙",
    content_md:
      "# 패키징 원칙\n\n제목과 썸네일은 고객이 얻을 이익 또는 피하고 싶은 위험을 직관적으로 보여준다.\n\n## 검토 기준\n\n- 한눈에 핵심이 읽히는가\n- 콘텐츠의 실제 내용과 일치하는가\n- 측정 가능한 가설이 있는가",
    folder: "회사 wiki/채널 운영",
    status: "canonical",
    brand: "브랜디액션",
    team: "콘텐츠",
    tags: ["유튜브", "썸네일", "정본"],
    source: "wiki",
    source_ref: null,
    owner_id: "demo-ricky",
    created_by: "demo-ricky",
    current_version: 3,
    created_at: "2026-08-20T09:00:00.000Z",
    updated_at: "2026-08-29T02:10:00.000Z",
  },
  {
    id: "demo-needs",
    title: "6대 욕구 정본",
    content_md:
      "# 6대 욕구\n\n브랜디액션은 성취·실행·영향·관계·이해·의미의 여섯 욕구를 자기이해의 핵심 축으로 사용한다.",
    folder: "회사 wiki/핵심 IP",
    status: "canonical",
    brand: "마이인",
    team: "브랜드",
    tags: ["욕구", "자기이해", "정본"],
    source: "wiki",
    source_ref: null,
    owner_id: "demo-ricky",
    created_by: "demo-ricky",
    current_version: 5,
    created_at: "2026-08-11T09:00:00.000Z",
    updated_at: "2026-08-28T06:30:00.000Z",
  },
  {
    id: "demo-telegram",
    title: "텔레그램 지식창구 운영안",
    content_md:
      "# 텔레그램 지식창구\n\n팀원이 질문하면 회사 정본을 검색하고 근거 문단과 함께 답한다. 저장한 답은 개인 초안으로 들어가 검토 후 정본으로 승격한다.",
    folder: "리키/작업 중",
    status: "review",
    brand: "브랜디액션",
    team: "개발",
    tags: ["텔레그램", "RAG"],
    source: "decision",
    source_ref: null,
    owner_id: "demo-ricky",
    created_by: "demo-ricky",
    current_version: 1,
    created_at: "2026-08-29T01:30:00.000Z",
    updated_at: "2026-08-29T04:15:00.000Z",
  },
  {
    id: "demo-workflow",
    title: "지식 정본 승격 절차",
    content_md:
      "# 지식 정본 승격 절차\n\n개인 초안 → 팀 공유 → 검토 요청 → 검토 완료 → 회사 정본 순서로 이동한다. 작성자와 최종 검토자는 분리한다.",
    folder: "회사 wiki/운영 원칙",
    status: "team",
    brand: "브랜디액션",
    team: "전체",
    tags: ["지식", "검토", "운영"],
    source: "process",
    source_ref: null,
    owner_id: "demo-jeongho",
    created_by: "demo-jeongho",
    current_version: 2,
    created_at: "2026-08-27T07:00:00.000Z",
    updated_at: "2026-08-29T00:45:00.000Z",
  },
];

export function searchDemoDocuments(query: string): SearchResult[] {
  const terms = query.toLocaleLowerCase("ko-KR").split(/\s+/).filter(Boolean);
  return DEMO_DOCUMENTS.map((document) => {
    const haystack = `${document.title} ${document.content_md} ${document.tags.join(" ")}`.toLocaleLowerCase("ko-KR");
    const hits = terms.reduce((count, term) => count + (haystack.includes(term) ? 1 : 0), 0);
    return { document, score: terms.length ? hits / terms.length : 0 };
  })
    .filter(({ score }) => score > 0)
    .sort((a, b) => b.score - a.score)
    .map(({ document, score }) => ({
      chunkId: null,
      documentId: document.id,
      title: document.title,
      folder: document.folder,
      status: document.status,
      brand: document.brand,
      heading: document.content_md.match(/^#\s+(.+)$/m)?.[1] ?? "본문",
      text: document.content_md.replace(/^#+\s+/gm, "").slice(0, 420),
      score,
      citation: { documentId: document.id, version: document.current_version, chunkId: null },
    }));
}
