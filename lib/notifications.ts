import type { OsRecord } from "./record-types";
import { recordWorkHref } from "./personal-work.ts";
export const NOTIFICATION_REASONS = {
  assignment: "업무 배정", review: "검토 요청", approval: "승인 대기", blocked: "자동화 확인 필요", status_change: "요청 상태 변경", scheduled: "예약 게시 확인", token_expiring: "채널 연결 만료 확인",
} as const;
export interface WorkNotification { id: string; title: string; reason: keyof typeof NOTIFICATION_REASONS; href: string; createdAt: string; readAt: string }
export interface WorkNotificationSummary { notifications: WorkNotification[]; unread: number; truncated: boolean }
export function presentNotification(row: OsRecord, source: Pick<OsRecord, "id" | "title" | "record_type" | "metadata">): WorkNotification | null {
  const reason = row.metadata.reason;
  if (typeof reason !== "string" || !Object.hasOwn(NOTIFICATION_REASONS, reason)) return null;
  return { id: row.id, title: source.title, reason: reason as WorkNotification["reason"],
    href: row.metadata.sourceType === "document" ? `/knowledge/review?document=${encodeURIComponent(source.id)}` : recordWorkHref(source),
    createdAt: row.created_at, readAt: typeof row.metadata.readAt === "string" ? row.metadata.readAt : "" };
}
