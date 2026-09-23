import { z } from "zod";
import type { OsRecord } from "./record-types";

const httpsUrl = z.string().max(2_000).refine(value => !value || (z.string().url().safeParse(value).success && new URL(value).protocol === "https:"), "HTTPS 주소만 사용할 수 있습니다.");
const location = z.enum(["title", "thumbnail", "description", "chapter", "spoken"]);
const sourceRelation = z.enum(["unlinked", "candidate", "identified"]);
const assessment = z.enum(["unverified", "review_needed", "reviewer_aligned"]);
type ClaimAssessmentFields = { sourceRelation: z.infer<typeof sourceRelation>; sourceUrl: string; sourceIdentifier: string;
  sourceExcerpt: string; measuredConcept: string; assessment: z.infer<typeof assessment>; rationale: string };
function validateAssessment(value: ClaimAssessmentFields, context: z.RefinementCtx) {
  if (value.sourceRelation === "unlinked" && (value.sourceUrl || value.sourceIdentifier || value.sourceExcerpt))
    context.addIssue({ code: "custom", path: ["sourceRelation"], message: "원출처가 미연결이면 출처 항목을 비워 주세요." });
  if (value.sourceRelation !== "unlinked" && (!value.sourceUrl || !value.sourceIdentifier))
    context.addIssue({ code: "custom", path: ["sourceUrl"], message: "출처 후보 또는 실제 인용 원문의 주소와 식별자가 필요합니다." });
  if (value.assessment === "reviewer_aligned" && (value.sourceRelation !== "identified" || !value.sourceExcerpt || !value.measuredConcept || value.rationale.length < 20))
    context.addIssue({ code: "custom", path: ["assessment"], message: "일치 검토에는 실제 원문 식별, 해당 대목, 측정 개념과 검토 이유가 필요합니다." });
  if (value.assessment === "review_needed" && value.rationale.length < 10)
    context.addIssue({ code: "custom", path: ["rationale"], message: "표현 재검토 이유를 10자 이상 적어 주세요." });
}

export const claimEvidenceInput = z.object({
  sourceId: z.string().uuid(), expectedSourceVersion: z.number().int().positive(),
  location, locationDetail: z.string().trim().max(200), claimText: z.string().trim().min(1).max(1_000),
  sourceRelation, sourceUrl: httpsUrl, sourceIdentifier: z.string().trim().max(300),
  sourceExcerpt: z.string().trim().max(1_500), measuredConcept: z.string().trim().max(500),
  population: z.string().trim().max(500), sample: z.string().trim().max(300),
  comparison: z.string().trim().max(700), conditions: z.string().trim().max(700),
  assessment, rationale: z.string().trim().max(1_500),
}).strict().superRefine(validateAssessment);

const storedClaim = z.object({
  packageKind: z.literal("claim_evidence"), schemaVersion: z.literal(1), verification: z.literal("reviewer_entered"),
  location, locationDetail: z.string().max(200), claimText: z.string().min(1).max(1_000),
  sourceRelation, sourceUrl: httpsUrl, sourceIdentifier: z.string().max(300), sourceExcerpt: z.string().max(1_500),
  measuredConcept: z.string().max(500), population: z.string().max(500), sample: z.string().max(300),
  comparison: z.string().max(700), conditions: z.string().max(700), assessment, rationale: z.string().max(1_500),
}).passthrough().superRefine(validateAssessment);

export function claimEvidence(sourceId: string, ownerId: string | null, records: OsRecord[], team = "") {
  if (!ownerId) return { claims: [], invalidCount: 0 };
  const rows = records.filter(row => row.record_type === "content_package" && row.parent_id === sourceId && !row.archived_at &&
    (row.owner_id === ownerId || (team.trim() && row.team === team && row.owner_id === row.created_by)) && row.metadata?.packageKind === "claim_evidence");
  const claims: Array<{ record: OsRecord; data: z.infer<typeof storedClaim> }> = [];
  let invalidCount = 0;
  for (const record of rows) {
    const parsed = storedClaim.safeParse(record.metadata);
    if (!parsed.success || !Number.isFinite(Date.parse(record.created_at))) { invalidCount++; continue; }
    claims.push({ record, data: parsed.data });
  }
  claims.sort((a, b) => Date.parse(b.record.created_at) - Date.parse(a.record.created_at) || b.record.id.localeCompare(a.record.id));
  return { claims, invalidCount };
}
