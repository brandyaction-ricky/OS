export function isAppealCandidatePackage(recordType: string, metadata: Record<string, unknown> | null | undefined) {
  return recordType === "content_package" && metadata?.packageKind === "appeal_candidates";
}

function protectedAppealFields(metadata: Record<string, unknown> | null | undefined) {
  const result = metadata?.result && typeof metadata.result === "object" ? metadata.result as Record<string, unknown> : {};
  return JSON.stringify({
    packageKind: metadata?.packageKind,
    candidates: result.candidates,
    decisionHistory: metadata?.decisionHistory,
    workflowStage: metadata?.workflowStage,
  });
}

export function changesAppealDecision(metadata: Record<string, unknown> | null | undefined, next: Record<string, unknown> | null | undefined) {
  return next !== undefined && protectedAppealFields(metadata) !== protectedAppealFields(next);
}
