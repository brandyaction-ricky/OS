import type { RequestActor } from "./auth";
import type { OsRecord } from "@/lib/record-types";
import { hrWorkspaceEnabled } from "@/lib/hr/gate";
import { hrRpc } from "./hr";
export async function hrNotificationSources(
  actor: RequestActor,
  rows: OsRecord[],
) {
  if (!hrWorkspaceEnabled()) return [];
  const ids = [
    ...new Set(
      rows
        .filter((r) => String(r.metadata.sourceType).startsWith("hr_"))
        .map((r) => String(r.metadata.sourceId)),
    ),
  ];
  if (!ids.length) return [];
  const sources = await hrRpc<
    Array<{ id: string; type: string; title: string; href: string }>
  >(actor, "os_hr_notification_sources", { p_ids: ids });
  return sources.map(
    (s) =>
      [
        `${s.type}:${s.id}`,
        {
          id: s.id,
          title: s.title,
          record_type: "task" as const,
          metadata: { hrHref: s.href },
        },
      ] as const,
  );
}
