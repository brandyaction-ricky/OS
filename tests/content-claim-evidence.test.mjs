import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { claimEvidence, claimEvidenceInput } from "../lib/content-claim-evidence.ts";

const sourceId = "11111111-1111-4111-8111-111111111111";
const ownerId = "22222222-2222-4222-8222-222222222222";
const base = { sourceId, expectedSourceVersion: 4, location: "chapter", locationDetail: "8:57",
  claimText: "상상보다 기억이 2배 정확했다", sourceRelation: "unlinked", sourceUrl: "", sourceIdentifier: "", sourceExcerpt: "",
  measuredConcept: "", population: "", sample: "", comparison: "", conditions: "", assessment: "unverified", rationale: "" };
const row = (patch = {}) => ({ id: "claim-1", record_type: "content_package", parent_id: sourceId, owner_id: ownerId,
  archived_at: null, version: 1, created_at: "2026-09-23T02:00:00Z",
  metadata: { packageKind: "claim_evidence", schemaVersion: 1, verification: "reviewer_entered",
    ...Object.fromEntries(Object.entries(base).filter(([key]) => !["sourceId", "expectedSourceVersion"].includes(key))) }, ...patch });

test("unlinked claim remains unverified and source candidates cannot be marked aligned", () => {
  assert.equal(claimEvidenceInput.safeParse(base).success, true);
  const candidate = { ...base, sourceRelation: "candidate", sourceUrl: "https://example.com/paper", sourceIdentifier: "candidate DOI",
    sourceExcerpt: "Some excerpt", measuredConcept: "future affect forecast error", assessment: "reviewer_aligned", rationale: "The source confirms the exact measure." };
  assert.equal(claimEvidenceInput.safeParse(candidate).success, false);
  assert.equal(claimEvidenceInput.safeParse({ ...candidate, sourceRelation: "identified" }).success, true);
});
test("review-needed needs rationale; aligned needs identified source, excerpt, construct and reason", () => {
  assert.equal(claimEvidenceInput.safeParse({ ...base, assessment: "review_needed", rationale: "short" }).success, false);
  assert.equal(claimEvidenceInput.safeParse({ ...base, assessment: "review_needed", rationale: "측정 개념이 실제 표현과 다릅니다." }).success, true);
  for (const patch of [{ sourceExcerpt: "" }, { measuredConcept: "" }, { rationale: "too short" }, { sourceRelation: "candidate" }]) {
    const aligned = { ...base, sourceRelation: "identified", sourceUrl: "https://example.com/paper", sourceIdentifier: "doi:abc",
      sourceExcerpt: "the forecast error was reduced", measuredConcept: "forecast error", assessment: "reviewer_aligned",
      rationale: "실제 측정 개념과 수치가 표현 범위에 일치한다고 검토함", ...patch };
    assert.equal(claimEvidenceInput.safeParse(aligned).success, false);
  }
});
test("unsafe links, extra fields and missing source identifiers fail closed", () => {
  assert.equal(claimEvidenceInput.safeParse({ ...base, extra: "x" }).success, false);
  assert.equal(claimEvidenceInput.safeParse({ ...base, sourceRelation: "candidate", sourceUrl: "javascript:alert(1)", sourceIdentifier: "x" }).success, false);
  assert.equal(claimEvidenceInput.safeParse({ ...base, sourceRelation: "candidate", sourceUrl: "https://example.com" }).success, false);
});
test("claim list excludes other owners and malformed records without upgrading them", () => {
  const valid = row();
  const forged = row({ id: "claim-2", owner_id: "other" });
  const invalid = row({ id: "claim-3", metadata: { ...row().metadata, assessment: "reviewer_aligned" } });
  const result = claimEvidence(sourceId, ownerId, [valid, forged, invalid]);
  assert.equal(result.claims.length, 1); assert.equal(result.invalidCount, 1);
  assert.equal(result.claims[0].data.assessment, "unverified");
  assert.equal(claimEvidence(sourceId, null, [valid]).claims.length, 0);
});
test("claim route is DEV-only, owner-scoped, append-only, and does not mutate approvals", async () => {
  const route = await readFile(new URL("../app/api/v1/content/claim-evidence/route.ts", import.meta.url), "utf8");
  const generic = await readFile(new URL("../app/api/v1/records/route.ts", import.meta.url), "utf8");
  assert.match(route, /canUseSystemOneJevShadow\(process\.env\)/);
  assert.match(route, /allowAgent: false/); assert.match(route, /eq\("owner_id", actor\.id\)/);
  assert.match(route, /source\.version !== input\.expectedSourceVersion/);
  assert.match(route, /verification: "reviewer_entered"/);
  assert.doesNotMatch(route, /content_publish|service_role|status: "published"|pipelineReviews/);
  assert.match(generic, /isContentEvidence/); assert.match(generic, /EVIDENCE_APPEND_ONLY/);
});
