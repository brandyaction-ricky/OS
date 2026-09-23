import type { OsRecord } from "./record-types";

export function evidenceAuthorLabel(record: OsRecord | null, authors: Record<string, string>, viewerId: string | undefined) {
  if (!record) return "작성자 미확인";
  const id = record.created_by;
  return `작성자: ${authors[id] || (viewerId === id ? "나" : `계정 ${id.slice(0, 8)}`)}`;
}
