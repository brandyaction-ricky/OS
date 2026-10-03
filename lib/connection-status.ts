export const CONNECTIONS = [
  { id: "database", label: "데이터베이스", scope: "문서 조회", href: "/settings/monitoring" },
  { id: "auth", label: "로그인 인증", scope: "현재 계정 인증", href: "/settings/access" },
  { id: "embeddings", label: "지식 검색", scope: "OpenAI 모델 조회 · 색인 작업 이력", href: "/settings/monitoring" },
  { id: "telegram", label: "Telegram", scope: "봇 정보 조회", href: "/settings/channels" },
  { id: "contentAi", label: "콘텐츠 AI", scope: "Claude 모델 조회", href: "/organization/agents" },
  { id: "youtube", label: "YouTube Data API", scope: "공개 언어 목록 조회", href: "/content/youtube" },
  { id: "advertising", label: "광고 데이터", scope: "설정된 광고 계정의 전일 성과 조회", href: "/performance/ads" },
  { id: "orders", label: "주문·매출", scope: "주문 자동 수집 미구현 · 수기·CSV 별도", href: "/performance/revenue" },
] as const;
export type ConnectionId = typeof CONNECTIONS[number]["id"];
export type ConnectionState = "error" | "verified" | "stale" | "unverified" | "missing";
export interface ConnectionCheck {
  id: string;
  configured: boolean;
  lastOkAt: string | null;
  lastCheckedAt: string | null;
  failures24h: number | null;
  blockedJobs: number | null;
  latestFailed: boolean;
  historyAvailable: boolean;
  status: ConnectionState;
  primaryOwner: string | null;
  backupOwner: string | null;
  ownerVersion: number;
}
export function connectionState(check: Pick<ConnectionCheck, "configured" | "lastOkAt" | "failures24h" | "blockedJobs" | "latestFailed" | "historyAvailable">, now = Date.now()): ConnectionState {
  if (check.latestFailed || (check.failures24h ?? 0) > 0 || (check.blockedJobs ?? 0) > 0) return "error";
  if (!check.configured) return "missing";
  if (!check.historyAvailable || check.failures24h === null || !check.lastOkAt) return "unverified";
  return now - Date.parse(check.lastOkAt) <= 86_400_000 ? "verified" : "stale";
}
export const CONNECTION_STATE_LABELS: Record<ConnectionState, string> = {
  error: "오류", verified: "호출 확인됨", stale: "재확인 필요", unverified: "설정됨(미확인)", missing: "연결 대기",
};
