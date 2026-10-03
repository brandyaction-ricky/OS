import type { OsRecord } from "./record-types";
export const DEVELOPMENT_STATUS_LABELS: Record<string, string> = {
  backlog: "접수", active: "수정 중", review: "검수 요청", done: "해결", blocked: "보류",
  working: "작업 중", tested: "검증 완료", dev_deployed: "Preview 배포", completed: "완료",
  ready: "배포 성공", failed: "배포 실패", deploying: "배포 중", rolled_back: "되돌림",
};
export const developmentStatusLabel = (status: string) => DEVELOPMENT_STATUS_LABELS[status] ?? status;
export function requestPlainSummary(record: Pick<OsRecord, "metadata" | "description" | "status">) {
  const text = (key: string) => typeof record.metadata[key] === "string" ? record.metadata[key].trim() : "";
  return {
    summary: text("plainSummary") || record.description.split("\n").find(line => line.trim())?.slice(0, 240) || "요청 내용 확인이 필요합니다.",
    nextAction: text("nextAction") || ({ backlog: "담당자와 처리 범위 확인", active: "수정 후 검증 결과 기록", review: "요청자가 반영 화면 확인", done: "문제가 남으면 다시 요청", blocked: "보류 사유와 재검토일 확인" } as Record<string, string>)[record.status] || "최근 기록 확인",
    holdReason: text("holdReason"), reviewDate: text("reviewDate"),
  };
}
