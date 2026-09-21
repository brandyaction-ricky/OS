import { z } from "zod";

const marker = z.string().regex(/^[a-f0-9]{64}$/);
export const reviewContextSchema = z.object({
  status: z.literal("ready"), policyStatus: z.literal("unverified"), judgment: z.null(), executionAllowed: z.literal(false),
  source: z.object({ id: z.string().uuid(), version: z.number().int().positive() }).strict(),
  registryVersion: z.number().int().positive(), referenceCount: z.number().int().min(1).max(10),
  packageCount: z.number().int().min(0).max(100),
  markers: z.object({ source: marker, criteria: marker, bundle: marker }).strict(),
}).strict();
export type ReviewContext = z.infer<typeof reviewContextSchema>;
export function reviewContextChanges(before: ReviewContext, after: ReviewContext): string[] {
  if (before.source.id !== after.source.id) return ["다른 주제입니다. 이 화면을 다시 열어 자료를 확인해 주세요."];
  const changes: string[] = [];
  if (before.markers.source !== after.markers.source) changes.push("주제·제작 형식·인계 메모 등 기획 자료가 바뀌었습니다. 기존 설계와 원고에 미치는 영향을 확인해 주세요.");
  if (before.markers.criteria !== after.markers.criteria) changes.push("연결된 기획 기준 문서 또는 등록부가 바뀌었습니다. 현재 기준으로 다시 확인해 주세요.");
  if (before.packageCount !== after.packageCount) changes.push("조회 가능한 패키징 자료 수가 바뀌었습니다. 새 자료·삭제·접근 범위 변경 여부를 확인해 주세요.");
  if (before.markers.bundle !== after.markers.bundle) changes.push("검토 자료 묶음이 처음 확인한 때와 다릅니다. 제목·썸네일 선택을 포함한 연결 자료를 다시 확인해 주세요.");
  return changes;
}
export function reviewContextFailure(code: unknown): string {
  if (code === "stale") return "자료나 기준 버전이 바뀌었습니다. 최신 기획 메모를 다시 읽고 확인해 주세요. 등록부 버전 변경은 개발 설정 확인이 필요할 수 있습니다.";
  if (code === "authentication_failed" || code === "unavailable") return "로그인 또는 본인 소유 자료의 접근 권한을 확인해 주세요. 이전 조회를 현재 확인 결과로 사용하지 않습니다.";
  if (["setup_required", "missing_role", "invalid_registry", "invalid_entry_contract", "approval_required", "unsupported_context", "ambiguous_mapping"].includes(String(code))) return "현재 주제에 필요한 기획 기준 연결을 확인하지 못했습니다. 기준 문서·등록부 설정과 공개 상태를 확인해야 합니다.";
  return "자료를 확인하지 못했습니다. 잠시 후 다시 시도해 주세요. 확인 실패는 승인이나 검토 완료가 아닙니다.";
}
