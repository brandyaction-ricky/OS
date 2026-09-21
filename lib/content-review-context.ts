import { z } from "zod";

const marker = z.string().regex(/^[a-f0-9]{64}$/);
export const reviewContextSchema = z.object({
  status: z.literal("ready"), policyStatus: z.literal("unverified"), judgment: z.null(), executionAllowed: z.literal(false),
  source: z.object({ id: z.string().uuid(), version: z.number().int().positive() }).strict(),
  registryVersion: z.number().int().positive(), referenceCount: z.number().int().min(1).max(10),
  packageCount: z.number().int().min(0).max(100),
  linkedDocuments: z.array(z.object({ id: z.string().uuid(), title: z.string().min(1).max(300),
    role: z.enum(["research", "design", "manuscript", "editing"]), version: z.number().int().positive(),
    linkedVersion: z.number().int().positive(), linkedSourceVersion: z.number().int().positive(), marker,
  }).strict()).max(12).refine(rows => new Set(rows.map(row => row.id)).size === rows.length),
  markers: z.object({ source: marker, criteria: marker, bundle: marker }).strict(),
}).strict();
export type ReviewContext = z.infer<typeof reviewContextSchema>;
export function reviewContextChanges(before: ReviewContext, after: ReviewContext): string[] {
  if (before.source.id !== after.source.id) return ["다른 주제입니다. 이 화면을 다시 열어 자료를 확인해 주세요."];
  const changes: string[] = [];
  if (before.markers.source !== after.markers.source) changes.push("주제·제작 형식·인계 메모 등 기획 자료가 바뀌었습니다. 기존 설계와 원고에 미치는 영향을 확인해 주세요.");
  if (before.markers.criteria !== after.markers.criteria) changes.push("연결된 기획 기준 문서 또는 등록부가 바뀌었습니다. 현재 기준으로 다시 확인해 주세요.");
  if (before.packageCount !== after.packageCount) changes.push("조회 가능한 패키징 자료 수가 바뀌었습니다. 새 자료·삭제·접근 범위 변경 여부를 확인해 주세요.");
  const previous = new Map(before.linkedDocuments.map(document => [document.id, document]));
  for (const document of after.linkedDocuments) {
    const old = previous.get(document.id);
    if (!old) changes.push(`연결 문서 추가: ${document.title}. 현재 기획에서 사용할 자료인지 확인해 주세요.`);
    else if (old.marker !== document.marker || old.role !== document.role) changes.push(`연결 문서 변경: ${document.title} (v${old.version} → v${document.version}). 본문·제목·접근 상태 또는 지정 용도가 바뀌었을 수 있습니다. 현재 내용을 다시 확인해 주세요.`);
  }
  if (before.linkedDocuments.some(document => !after.linkedDocuments.some(current => current.id === document.id))) changes.push("이전 조회에 있던 문서 연결이 빠졌습니다. 원문 삭제인지 단정하지 않으며 현재 연결 목록을 확인해 주세요.");
  if (before.markers.bundle !== after.markers.bundle) changes.push("검토 자료 묶음이 처음 확인한 때와 다릅니다. 제목·썸네일 선택을 포함한 연결 자료를 다시 확인해 주세요.");
  return changes;
}
export function reviewContextFailure(code: unknown): string {
  if (code === "invalid_linked_documents") return "문서 연결 형식이나 연결 당시 주제 버전을 확인할 수 없습니다. 연결 정보를 점검해 주세요. 기존 내용은 덮어쓰지 않습니다.";
  if (code === "linked_documents_unavailable") return "연결 문서 중 읽기·버전·내용 확인이 되지 않은 항목이 있습니다. 아래 문서 연결에서 각각 현재 문서를 확인해 주세요. 전체 확인 결과는 보류하며 과거 제목이나 일부 성공 결과를 대신 표시하지 않습니다.";
  if (code === "stale") return "자료나 기준 버전이 바뀌었습니다. 최신 기획 메모를 다시 읽고 확인해 주세요. 등록부 버전 변경은 개발 설정 확인이 필요할 수 있습니다.";
  if (code === "authentication_failed" || code === "unavailable") return "로그인 또는 본인 소유 자료의 접근 권한을 확인해 주세요. 이전 조회를 현재 확인 결과로 사용하지 않습니다.";
  if (["setup_required", "missing_role", "invalid_registry", "invalid_entry_contract", "approval_required", "unsupported_context", "ambiguous_mapping"].includes(String(code))) return "현재 주제에 필요한 기획 기준 연결을 확인하지 못했습니다. 기준 문서·등록부 설정과 공개 상태를 확인해야 합니다.";
  return "자료를 확인하지 못했습니다. 잠시 후 다시 시도해 주세요. 확인 실패는 승인이나 검토 완료가 아닙니다.";
}
