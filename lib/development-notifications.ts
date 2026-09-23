import { z } from "zod";

export const developmentNotificationReadSchema = z.object({
  ids: z.array(z.string().uuid()).min(1).max(100)
    .refine((ids) => new Set(ids).size === ids.length, "같은 알림을 두 번 처리할 수 없습니다."),
});

export type DevelopmentNotificationReason = "mention" | "assignment";

export interface DevelopmentNotificationItem {
  id: string;
  reason: DevelopmentNotificationReason;
  requestId: string;
  requestTitle: string;
  actorName: string;
  createdAt: string;
  deliveredAt: string;
  readAt: string;
}

export function notificationReason(value: unknown): DevelopmentNotificationReason | null {
  return value === "mention" || value === "assignment" ? value : null;
}
