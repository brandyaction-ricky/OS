import type { OsRecord } from "./record-types";
export interface HomeChannel { platform: string; ownerId: string; accountName: string; status: string; expiresSoon: boolean }
export function summarizeTodayContent(posts: OsRecord[], comments: Array<OsRecord & { canRespond: boolean }>, metrics: OsRecord[], channels: HomeChannel[], userId: string, now = new Date()) {
  const end = new Date(now); end.setHours(23, 59, 59, 999);
  const visible = new Set(channels.map(row => `${row.platform}:${row.ownerId}`));
  const due = posts.filter(row => {
    const account = row.metadata.account as { platform?: string; ownerId?: string } | undefined;
    return !row.archived_at && row.status === "scheduled" && !!row.starts_at && Date.parse(row.starts_at) <= end.getTime()
      && !!account && visible.has(`${account.platform}:${account.ownerId}`);
  });
  const unanswered = comments.filter(row => !row.archived_at && row.status === "unanswered" && (row.canRespond || row.assignee_id === userId));
  const measured = new Set(metrics.filter(row => !row.archived_at && row.metadata.channelSnapshotVersion === 1
    && Date.parse(row.created_at) <= now.getTime() && Date.parse(row.created_at) >= now.getTime() - 86400000).map(row => String(row.metadata.publishId || row.parent_id || row.id)));
  return { due, unanswered, measured: measured.size, warnings: channels.filter(row => row.expiresSoon || row.status !== "connected") };
}
