import type { OsRecord } from "./record-types";

export type GenerationMode = "queue" | "api";
export const GENERATION_SETTING_KEY = "content-generation";
export function generationSetting(records: OsRecord[]) {
  return records.find(record => record.record_type === "company_setting" && !record.archived_at && record.metadata.settingKey === GENERATION_SETTING_KEY);
}
export function defaultGenerationMode(records: OsRecord[]): GenerationMode {
  return generationSetting(records)?.metadata.defaultGenerationMode === "api" ? "api" : "queue";
}
export function generationJobLabel(job: Pick<OsRecord, "status" | "stage" | "metadata">) {
  if (job.status === "blocked" && job.stage === "credentials") return "이전 방식 — API 연결 대기";
  if (job.stage === "failed" || job.status === "failed") return "실패";
  return ({ backlog: "대기", active: "처리 중", done: "완료", review: "검수 중", draft: "초안", ready: "승인 대기", blocked: "막힘" } as Record<string, string>)[job.status] ?? job.status;
}
export const GENERATION_QUEUED_NOTICE = "구독 대기열에 저장했습니다. AI 작업에서 처리 상태를 확인할 수 있습니다.";
