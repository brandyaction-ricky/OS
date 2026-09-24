const evidenceKinds = new Set(["copy_decision_evidence", "publication_copy_observation", "claim_evidence"]);

// Evidence is created through its validated, owner-scoped endpoint only.
// This is an application API guard, not a database-level immutability guarantee.
export function isContentEvidence(recordType: unknown, metadata: unknown): boolean {
  if (recordType !== "content_package" || !metadata || typeof metadata !== "object" || Array.isArray(metadata)) return false;
  const kind = (metadata as Record<string, unknown>).packageKind;
  return typeof kind === "string" && evidenceKinds.has(kind);
}
