import { z } from "zod";

export const contentStages = { packaging: "제목·썸네일", writing: "설계·집필" } as const;
const version = z.number().int().positive().max(2_147_483_647);
export const stageReferenceSchema = z.object({
  status: z.literal("ready"), stage: z.enum(["packaging", "writing"]),
  source: z.object({ id: z.string().uuid(), version }).strict(), registryVersion: version,
  entryDocument: z.object({ role: z.enum(["youtube.packaging", "youtube.writing"]),
    id: z.string().uuid(), title: z.string().min(1).max(300), version }).strict(),
  dependenciesStatus: z.literal("unresolved"), approvalStatus: z.literal("unverified"),
  policyStatus: z.literal("unverified"), judgment: z.null(), executionAllowed: z.literal(false),
}).strict().refine(value => value.entryDocument.role === `youtube.${value.stage}`);
export type StageReference = z.infer<typeof stageReferenceSchema>;

export function stageReferenceFailure(code: unknown) {
  if (code === "missing_role") return "이 단계의 담당 정본이 현재 개발용 등록부에 연결되지 않았습니다. 등록부 연결이 필요하며 다른 문서로 대신하지 않습니다.";
  if (code === "approval_required") return "등록부 또는 담당 문서의 정본 상태를 확인해야 합니다. 콘텐츠 승인 여부와는 별개입니다.";
  if (code === "stale") return "조회 중 주제나 정본이 바뀌었습니다. 최신 기획 메모를 다시 읽은 뒤 확인해 주세요.";
  if (code === "authentication_failed" || code === "unavailable") return "로그인·주제 소유권·문서 접근 권한을 확인해 주세요. 이전 조회 결과는 표시하지 않습니다.";
  if (code === "not_enabled") return "이 환경에서는 단계별 기준 조회를 제공하지 않습니다. DEV 검수용 기능입니다.";
  if (["setup_required", "invalid_registry", "ambiguous_mapping", "unsupported_context"].includes(String(code))) return "현재 주제의 담당 기준 연결 설정을 확인해야 합니다. 승인이나 집필 가능 여부를 판정하지 않았습니다.";
  return "담당 정본을 확인하지 못했습니다. 잠시 후 다시 시도해 주세요.";
}
