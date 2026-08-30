import type { RecordType } from "./record-types";

export interface WorkspaceConfig {
  href: string;
  recordType: RecordType;
  eyebrow: string;
  title: string;
  description: string;
  singular: string;
  empty: string;
  statuses: { value: string; label: string }[];
  defaultStatus: string;
  metricMode?: "progress" | "target" | "amount" | "schedule";
  defaultUnit?: string;
  helper: string;
}

const flow = (...values: string[]) => values.map((value) => ({ value, label: ({
  backlog: "대기", planned: "예정", active: "진행 중", blocked: "막힘", review: "검토", done: "완료",
  draft: "초안", ready: "준비", scheduled: "예약", published: "발행", measuring: "측정 중",
  open: "열림", decided: "결정", cancelled: "취소", healthy: "정상", warning: "주의", disconnected: "미연결",
  lead: "잠재고객", customer: "고객", loyal: "충성고객", churned: "이탈",
}[value] ?? value) }));

export const WORKSPACE_CONFIGS: Record<string, WorkspaceConfig> = {
  "/home/goals": { href: "/home/goals", recordType: "goal", eyebrow: "목표 관리", title: "목표·KPI", description: "회사 목표를 수치와 실행 업무로 연결합니다.", singular: "목표", empty: "첫 목표와 측정 지표를 등록하세요.", statuses: flow("planned", "active", "blocked", "done"), defaultStatus: "active", metricMode: "target", defaultUnit: "%", helper: "목표값과 현재값을 입력하면 달성률이 자동으로 보입니다." },
  "/home/decisions": { href: "/home/decisions", recordType: "decision", eyebrow: "결정 기록", title: "의사결정", description: "무엇을 왜 결정했는지 남기고 후속 실행을 추적합니다.", singular: "결정", empty: "첫 의사결정을 기록하세요.", statuses: flow("open", "review", "decided", "cancelled"), defaultStatus: "open", helper: "배경·선택지·결정 근거·후속 행동을 설명에 남겨두세요." },
  "/content/topics": { href: "/content/topics", recordType: "content_topic", eyebrow: "콘텐츠 제작 공정", title: "주제·기획", description: "콘텐츠 아이디어를 우선순위와 제작 단계로 관리합니다.", singular: "콘텐츠 주제", empty: "제작할 첫 콘텐츠 주제를 등록하세요.", statuses: flow("backlog", "planned", "active", "review", "done"), defaultStatus: "backlog", helper: "타깃·문제·핵심 메시지와 참고 링크를 함께 기록하세요." },
  "/content/scripts": { href: "/content/scripts", recordType: "content_script", eyebrow: "원고 작업공간", title: "원고·스크립트", description: "원고 작성과 검토 상태를 한곳에서 관리합니다.", singular: "원고", empty: "작성할 원고를 등록하세요.", statuses: flow("draft", "active", "review", "done"), defaultStatus: "draft", metricMode: "progress", helper: "관련 주제와 원고 문서를 연결할 수 있도록 출처 링크를 남겨두세요." },
  "/content/packages": { href: "/content/packages", recordType: "content_package", eyebrow: "제목·썸네일 작업", title: "제목·썸네일", description: "제목과 썸네일 후보의 검토·승인을 관리합니다.", singular: "제목·썸네일 안", empty: "검토할 제목 또는 썸네일 안을 등록하세요.", statuses: flow("draft", "review", "ready", "done"), defaultStatus: "draft", helper: "ThumbnailPeak 결과나 시안 링크를 출처 링크에 붙일 수 있습니다." },
  "/content/shorts": { href: "/content/shorts", recordType: "content_short", eyebrow: "파생 콘텐츠", title: "숏폼 편집", description: "롱폼에서 파생되는 숏폼 제작 묶음을 추적합니다.", singular: "숏폼", empty: "제작할 숏폼을 등록하세요.", statuses: flow("backlog", "active", "review", "ready", "published"), defaultStatus: "backlog", metricMode: "progress", helper: "원본 영상 링크와 구간, 훅, 플랫폼을 함께 기록하세요." },
  "/content/publishing": { href: "/content/publishing", recordType: "content_publish", eyebrow: "발행 대기열", title: "발행·업로드", description: "채널별 발행 준비와 승인 상태를 관리합니다.", singular: "발행 항목", empty: "발행할 콘텐츠를 등록하세요.", statuses: flow("ready", "scheduled", "published", "blocked"), defaultStatus: "ready", metricMode: "schedule", helper: "플랫폼·예약일·원문 링크를 한 항목에서 관리합니다." },
  "/content/calendar": { href: "/content/calendar", recordType: "content_publish", eyebrow: "발행 일정", title: "발행 캘린더", description: "예약된 콘텐츠를 날짜 기준으로 조율합니다.", singular: "발행 일정", empty: "예약된 발행 일정이 없습니다.", statuses: flow("ready", "scheduled", "published", "blocked"), defaultStatus: "scheduled", metricMode: "schedule", helper: "시작일에 발행 예정 시각을 입력하세요." },
  "/content/performance": { href: "/content/performance", recordType: "content_metric", eyebrow: "콘텐츠 성과", title: "영상 성과", description: "주제·플랫폼별 조회, 전환, 매출 성과를 기록합니다.", singular: "성과 기록", empty: "첫 콘텐츠 성과를 등록하세요.", statuses: flow("measuring", "done"), defaultStatus: "measuring", metricMode: "target", defaultUnit: "조회", helper: "목표값과 현재값에 핵심 지표를 입력하고 단위를 지정하세요." },
  "/knowledge/skills": { href: "/knowledge/skills", recordType: "skill", eyebrow: "업무 방식 관리", title: "Skill 관리", description: "개인 방식이 검증된 회사 실행 표준으로 발전하는 과정을 관리합니다.", singular: "Skill", empty: "첫 개인 Skill을 등록하세요.", statuses: flow("draft", "review", "ready", "done"), defaultStatus: "draft", helper: "시작 조건·절차·결과물·품질 기준을 설명에 작성하세요." },
  "/knowledge/graph": { href: "/knowledge/graph", recordType: "knowledge_link", eyebrow: "지식 연결", title: "지식 연결", description: "문서와 업무 사이의 관련성을 기록하고 탐색합니다.", singular: "지식 연결", empty: "연결할 문서나 업무를 등록하세요.", statuses: flow("active", "done"), defaultStatus: "active", helper: "제목에는 연결 관계를, 출처 링크에는 원문 위치를 입력하세요." },
  "/organization/tasks": { href: "/organization/tasks", recordType: "task", eyebrow: "업무 보드", title: "업무", description: "담당자·기한·상태로 모든 실행 업무를 추적합니다.", singular: "업무", empty: "첫 업무를 등록하세요.", statuses: flow("backlog", "planned", "active", "blocked", "review", "done"), defaultStatus: "planned", metricMode: "progress", helper: "완료 기준을 설명에 명확히 적고 기한과 담당 팀을 지정하세요." },
  "/organization/meetings": { href: "/organization/meetings", recordType: "meeting", eyebrow: "회의 → 실행", title: "회의", description: "회의 내용·결정·후속 업무가 끊기지 않게 관리합니다.", singular: "회의", empty: "예정된 회의 또는 지난 회의 기록을 등록하세요.", statuses: flow("planned", "active", "done", "cancelled"), defaultStatus: "planned", metricMode: "schedule", helper: "회의 요약, 결정사항, 후속 업무를 설명에 남기세요." },
  "/organization/agents": { href: "/organization/agents", recordType: "ai_job", eyebrow: "AI 작업 대기열", title: "AI 작업", description: "GPT·Codex·Claude에 맡긴 작업의 요청·진행·검수를 관리합니다.", singular: "AI 작업", empty: "AI에게 맡길 첫 작업을 등록하세요.", statuses: flow("backlog", "active", "review", "blocked", "done"), defaultStatus: "backlog", metricMode: "progress", helper: "요청문, 대상 저장소, 완료 조건과 결과 링크를 남겨두세요." },
  "/performance/revenue": { href: "/performance/revenue", recordType: "revenue", eyebrow: "매출 관리", title: "매출", description: "브랜드·채널별 목표와 매출 실적을 관리합니다.", singular: "매출 기록", empty: "첫 매출 기록을 등록하세요.", statuses: flow("planned", "measuring", "done"), defaultStatus: "measuring", metricMode: "amount", defaultUnit: "원", helper: "금액과 브랜드, 기준 기간을 함께 입력하세요." },
  "/performance/funnels": { href: "/performance/funnels", recordType: "funnel", eyebrow: "퍼널 분석", title: "퍼널", description: "유입부터 구매까지 단계별 전환 병목을 추적합니다.", singular: "퍼널", empty: "첫 퍼널 또는 전환 단계를 등록하세요.", statuses: flow("planned", "active", "warning", "healthy", "done"), defaultStatus: "active", metricMode: "target", defaultUnit: "%", helper: "목표 전환율과 실제 전환율을 입력해 병목을 확인하세요." },
  "/performance/crm": { href: "/performance/crm", recordType: "crm_action", eyebrow: "고객 여정", title: "CRM", description: "고객 세그먼트별 메시지와 후속 행동을 관리합니다.", singular: "CRM 액션", empty: "첫 고객 메시지 또는 자동화 액션을 등록하세요.", statuses: flow("draft", "ready", "scheduled", "active", "done"), defaultStatus: "draft", helper: "대상 태그·발송 조건·메시지·성과 기준을 기록하세요." },
  "/performance/customers": { href: "/performance/customers", recordType: "customer", eyebrow: "고객 신호", title: "고객", description: "브랜드별 고객 상태와 중요한 행동 신호를 관리합니다.", singular: "고객·세그먼트", empty: "첫 고객 또는 세그먼트를 등록하세요.", statuses: flow("lead", "customer", "loyal", "churned"), defaultStatus: "lead", helper: "개인정보 원문 대신 내부 고객 ID와 세그먼트 중심으로 기록하세요." },
  "/performance/brands": { href: "/performance/brands", recordType: "brand", eyebrow: "브랜드·태그 관리", title: "브랜드·태그", description: "운영 브랜드와 공통 분류 체계를 관리합니다.", singular: "브랜드", empty: "마이인·브랜디액션 에듀 등 운영 브랜드를 등록하세요.", statuses: flow("active", "done"), defaultStatus: "active", helper: "브랜드 목적, 데이터 원천, 담당 팀과 공통 태그를 기록하세요." },
  "/settings/connections": { href: "/settings/connections", recordType: "connection", eyebrow: "외부 연결", title: "연결", description: "외부 시스템 연결 상태와 담당자를 관리합니다.", singular: "연결", empty: "등록된 외부 연결이 없습니다.", statuses: flow("disconnected", "warning", "healthy"), defaultStatus: "disconnected", helper: "비밀키는 기록하지 말고 시스템명·담당자·설정 위치만 남기세요." },
  "/settings/access": { href: "/settings/access", recordType: "access_rule", eyebrow: "접근 권한 정책", title: "권한", description: "역할과 데이터 접근 원칙을 관리합니다.", singular: "권한 정책", empty: "추가 권한 정책이 없습니다.", statuses: flow("draft", "active", "done"), defaultStatus: "draft", helper: "실제 계정 역할은 구성원 메뉴에서 관리하고 이곳에는 정책을 기록하세요." },
  "/settings/company": { href: "/settings/company", recordType: "company_setting", eyebrow: "회사 공통 설정", title: "회사 설정", description: "회사 공통 운영 기준과 기본값을 관리합니다.", singular: "회사 설정", empty: "회사 기본 운영 기준을 등록하세요.", statuses: flow("draft", "active", "done"), defaultStatus: "active", helper: "회사명·업무시간·기본 팀·승인 원칙을 기록하세요." },
  "/settings/channels": { href: "/settings/channels", recordType: "channel", eyebrow: "메시지 창구", title: "메시지 창구", description: "Telegram·Slack 등 질문과 알림 통로를 관리합니다.", singular: "메시지 창구", empty: "연결할 메시지 창구를 등록하세요.", statuses: flow("disconnected", "warning", "healthy"), defaultStatus: "disconnected", helper: "토큰은 기록하지 말고 채널명·목적·허용 사용자 정책만 남기세요." },
};
