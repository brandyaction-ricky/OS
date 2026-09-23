import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { copyDecisionInput, copyLineage, publicationObservationInput } from "../lib/content-copy-lineage.ts";

const sourceId = "11111111-1111-4111-8111-111111111111";
const ownerId = "22222222-2222-4222-8222-222222222222";
const decision = (patch = {}) => ({
  id: "decision-1", record_type: "content_package", parent_id: sourceId, owner_id: ownerId, archived_at: null,
  version: 1, created_at: "2026-09-04T10:00:00Z",
  metadata: { packageKind: "copy_decision_evidence", schemaVersion: 1, verification: "user_entered",
    decisionAt: "2026-09-04", evidenceUrl: "https://example.com/decision", title: "Synthetic title",
    thumbnailCopy: "선택이 어려운 사람에게 / 답은, 오답 지우기", note: "" }, ...patch,
});
const publication = (patch = {}) => ({
  id: "publication-1", record_type: "content_package", parent_id: sourceId, owner_id: ownerId, archived_at: null,
  version: 1, created_at: "2026-09-06T10:00:00Z",
  metadata: { packageKind: "publication_copy_observation", schemaVersion: 1, verification: "user_entered",
    observedAt: "2026-09-06", videoUrl: "https://www.youtube.com/watch?v=RE2hRqLR-eM",
    title: "Synthetic title", thumbnailCopy: "후회하지 않는 선택법", note: "" }, ...patch,
});

test("manual P03-like records flag copy difference without declaring unapproved publication", () => {
  const rows = [decision(), publication()]; const before = structuredClone(rows);
  const result = copyLineage(sourceId, ownerId, rows);
  assert.equal(result.state, "different"); assert.equal(result.title, "same");
  assert.equal(result.thumbnailCopy, "different");
  assert.equal(result.decision.data.verification, "user_entered");
  assert.deepEqual(rows, before);
});
test("missing, wrong-parent, archived, and malformed evidence cannot become a match", () => {
  assert.equal(copyLineage(sourceId, ownerId, []).state, "unverified");
  for (const patch of [{ parent_id: "other" }, { owner_id: "other" }, { archived_at: "2026-09-07" }, { metadata: { packageKind: "publication_copy_observation", verification: "verified" } }])
    assert.equal(copyLineage(sourceId, ownerId, [decision(), publication(patch)]).state, "unverified");
});
test("newest evidence is used, but identical timestamps remain ambiguous", () => {
  const newer = publication({ id: "publication-2", created_at: "2026-09-07T10:00:00Z", metadata: { ...publication().metadata, thumbnailCopy: decision().metadata.thumbnailCopy } });
  assert.equal(copyLineage(sourceId, ownerId, [decision(), publication(), newer]).state, "same");
  assert.equal(copyLineage(sourceId, ownerId, [decision(), publication(), publication({ id: "publication-2" })]).state, "unverified");
});
test("formatting-only changes and missing decision title remain distinct", () => {
  const aligned = publication({ metadata: { ...publication().metadata, thumbnailCopy: "선택이 어려운 사람에게 / 답은, 오답 지우기" } });
  assert.equal(copyLineage(sourceId, ownerId, [decision(), aligned]).state, "same");
  const spaced = publication({ metadata: { ...publication().metadata, thumbnailCopy: "선택이 어려운 사람에게 /  답은, 오답 지우기" } });
  assert.equal(copyLineage(sourceId, ownerId, [decision(), spaced]).state, "formatting_only");
  const noTitle = decision({ metadata: { ...decision().metadata, title: "" } });
  assert.equal(copyLineage(sourceId, ownerId, [noTitle, aligned]).state, "partial");
});
test("typed inputs forbid extra fields, blank copy and non-HTTPS links", () => {
  const base = { kind: "decision", sourceId, expectedSourceVersion: 4, decisionAt: "2026-09-04", evidenceUrl: "https://example.com/decision", title: "", thumbnailCopy: "a", note: "" };
  assert.equal(copyDecisionInput.safeParse(base).success, true);
  for (const patch of [{ extra: "unexpected" }, { thumbnailCopy: " " }, { evidenceUrl: "javascript:alert(1)" }, { expectedSourceVersion: 0 }])
    assert.equal(copyDecisionInput.safeParse({ ...base, ...patch }).success, false);
  assert.equal(publicationObservationInput.safeParse({ ...base, kind: "publication", observedAt: "2026-09-06", videoUrl: "https://www.youtube.com/watch?v=RE2hRqLR-eM" }).success, false);
});
test("DEV-only route checks source ownership and never changes publication or approval", async () => {
  const route = await readFile(new URL("../app/api/v1/content/copy-lineage/route.ts", import.meta.url), "utf8");
  assert.match(route, /canUseSystemOneContentEvidence\(process\.env\)/);
  assert.match(route, /allowAgent: false/); assert.match(route, /eq\("owner_id", actor\.id\)/);
  assert.match(route, /token\.startsWith\("bos_pat_"\)/);
  assert.match(route, /source\.version !== input\.expectedSourceVersion/);
  assert.match(route, /record_type: "content_package"/);
  assert.match(route, /verification: "user_entered"/);
  assert.doesNotMatch(route, /content_publish|service_role|status: "published"|finalApproved: true/);
  const generic = await readFile(new URL("../app/api/v1/records/route.ts", import.meta.url), "utf8");
  assert.match(generic, /isContentEvidence/);
  assert.match(generic, /EVIDENCE_API_REQUIRED/);
  assert.match(generic, /EVIDENCE_APPEND_ONLY/);
});
