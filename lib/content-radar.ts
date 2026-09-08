import type { OsRecord } from "./record-types";

type RadarRecord = Pick<OsRecord, "metadata">;

export function radarStudioKind(record: RadarRecord) {
  return String(record.metadata?.studioKind ?? "");
}

export function isNicheQueueRecord(record: RadarRecord) {
  return radarStudioKind(record) !== "channel" && record.metadata?.automationSource !== true;
}
