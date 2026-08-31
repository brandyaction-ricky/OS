const EVENT_LABELS: Record<string, string> = {
  created: "생성",
  updated: "수정",
  status_changed: "상태 변경",
  archived: "보관",
  restored: "복원",
  approved: "승인",
  rejected: "반려",
};

const RECORD_LABELS: Record<string, string> = {
  project: "프로젝트",
  task: "업무",
  goal: "목표",
  kpi: "핵심 지표",
  decision: "결정사항",
  meeting: "회의",
  ai_job: "AI 작업",
  content_topic: "콘텐츠 주제",
  content_script: "원고",
  content_package: "제목·썸네일",
  title_package: "제목·썸네일",
  content_short: "숏폼 기획안",
  shorts_proposal: "숏폼 기획안",
  content_publish: "유튜브 발행 키트",
  youtube_publish_kit: "유튜브 발행 키트",
  derivatives: "파생물",
  content_metric: "콘텐츠 성과",
  skill: "업무 절차",
  knowledge_link: "지식 연결",
  revenue: "매출",
  funnel: "퍼널",
  crm_action: "고객 관리 실행",
  customer: "고객",
  brand: "브랜드",
  connection: "외부 연결",
  access_rule: "권한 규칙",
  company_setting: "회사 설정",
  channel: "메시지 창구",
  knowledge_document: "지식 문서",
  leave_balance: "연차 잔여",
  leave_request: "휴가 신청",
  expense: "지출",
  contract: "계약",
  subscription: "구독",
  company_document: "회사 서류",
};

const STATUS_LABELS: Record<string, string> = {
  backlog: "대기",
  planned: "예정",
  active: "운영 중",
  blocked: "막힘",
  review: "검토 중",
  reviewed: "검토 완료",
  ready: "승인 완료",
  done: "완료",
  draft: "초안",
  team: "팀 공유",
  canonical: "회사 정본",
  archived: "보관",
  pending: "승인 대기",
  approved: "승인",
  rejected: "반려",
  recorded: "기록 완료",
  decided: "결정됨",
  scheduled: "예약",
  published: "발행 완료",
  measuring: "측정 중",
  healthy: "정상",
  warning: "확인 필요",
  disconnected: "연결 끊김",
  classified: "분류 완료",
  needs_review: "확인 필요",
};

const FIELD_LABELS: Record<string, string> = {
  title: "제목",
  description: "설명",
  status: "상태",
  priority: "우선순위",
  stage: "진행 단계",
  brand: "브랜드",
  team: "팀",
  owner_id: "책임자",
  assignee_id: "담당자",
  parent_id: "연결 기록",
  due_date: "기한",
  starts_at: "시작일",
  ends_at: "종료일",
  progress: "진행률",
  metric_target: "목표값",
  metric_current: "현재값",
  metric_unit: "단위",
  amount: "금액",
  source_url: "출처 주소",
  tags: "태그",
  metadata: "세부 정보",
  content_md: "본문",
  folder: "폴더",
};

export function auditEventLabel(value: string) {
  return EVENT_LABELS[value] ?? "기록 변경";
}

export function auditRecordLabel(value: string | null | undefined) {
  return value ? RECORD_LABELS[value] ?? "운영 기록" : "운영 기록";
}

export function auditStatusLabel(
  value: string | null,
  recordType?: string | null,
) {
  if (!value) return "없음";
  if (
    value === "blocked" &&
    (recordType?.startsWith("content_") ||
      ["title_package", "shorts_proposal", "derivatives", "youtube_publish_kit"].includes(
        recordType ?? "",
      ))
  )
    return "비공개";
  return STATUS_LABELS[value] ?? "기타 상태";
}

export function auditFieldLabels(values: string[]) {
  return [
    ...new Set(values.map((value) => FIELD_LABELS[value] ?? "기타 정보")),
  ];
}
