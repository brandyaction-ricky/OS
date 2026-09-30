export type AppealDecision = "pending" | "approved" | "revision" | "held";

export interface AppealCandidate {
  text: string;
  decision: AppealDecision;
  decidedAt?: string;
}

export interface AppealResearchBrief {
  sourceUrls?: string[];
  youtubeUrls?: string[];
  instagramUrls?: string[];
  topicFit?: string;
  audienceFit?: string;
  queryIntentFit?: string;
  verifiedMetrics?: string;
  limitations?: string;
  verifiedAt?: string;
}

export function normalizeAppealCandidates(value: unknown): AppealCandidate[] {
  if (!Array.isArray(value)) return [];
  return value.slice(0, 12).flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const candidate = item as Record<string, unknown>;
    const text = String(candidate.text ?? "").trim();
    if (!text) return [];
    const decision = ["approved", "revision", "held"].includes(String(candidate.decision))
      ? String(candidate.decision) as AppealDecision
      : "pending";
    const decidedAt = typeof candidate.decidedAt === "string" ? candidate.decidedAt : undefined;
    return [{ text, decision, ...(decidedAt ? { decidedAt } : {}) }];
  });
}

export function decideAppealCandidate(candidates: AppealCandidate[], index: number, decision: AppealDecision, decidedAt: string) {
  return candidates.map((candidate, candidateIndex) => candidateIndex === index
    ? { ...candidate, decision, decidedAt }
    : candidate);
}

export function approvedAppeals(candidates: AppealCandidate[]) {
  return candidates.filter((candidate) => candidate.decision === "approved");
}

export function appealApprovalMatches(candidatesValue: unknown, briefValue: unknown) {
  const approved = approvedAppeals(normalizeAppealCandidates(candidatesValue)).map((item) => item.text).sort();
  if (!briefValue || typeof briefValue !== "object") return false;
  const snapshots = (briefValue as Record<string, unknown>).approvedAppeals;
  if (!Array.isArray(snapshots)) return false;
  const saved = snapshots.flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const text = String((item as Record<string, unknown>).text ?? "").trim();
    return text ? [text] : [];
  }).sort();
  return approved.length > 0 && approved.length === saved.length && approved.every((text, index) => text === saved[index]);
}

export function researchBriefReady(value: unknown) {
  if (!value || typeof value !== "object") return false;
  const brief = value as AppealResearchBrief;
  const validUrl = (value: string, expectedHost?: string) => {
    try {
      const url = new URL(value);
      return ["http:", "https:"].includes(url.protocol) && (!expectedHost || url.hostname === expectedHost || url.hostname.endsWith(`.${expectedHost}`));
    }
    catch { return false; }
  };
  const hasValidSource = (brief.youtubeUrls ?? []).some((value) => validUrl(value, "youtube.com") || validUrl(value, "youtu.be"))
    || (brief.instagramUrls ?? []).some((value) => validUrl(value, "instagram.com"))
    || (brief.sourceUrls ?? []).some((value) => validUrl(value));
  return Boolean(
    hasValidSource
    && brief.topicFit?.trim()
    && brief.audienceFit?.trim()
    && brief.queryIntentFit?.trim()
    && brief.limitations?.trim()
    && brief.verifiedAt,
  );
}

export function appealWorkflowState(candidates: AppealCandidate[], researchReady: boolean) {
  const approved = approvedAppeals(candidates).length;
  if (!candidates.length) return {
    stage: "소구점 후보 준비",
    nextAction: "소구점 후보 약 10개를 만들어 주세요.",
    blocker: "후보 세트가 아직 없습니다.",
  };
  if (!approved) return {
    stage: "대표 승인 대기",
    nextAction: "진행할 소구점을 선택하거나 수정 요청·보류하세요.",
    blocker: "승인된 소구점이 없습니다.",
  };
  if (!researchReady) return {
    stage: "레퍼런스 검증",
    nextAction: `승인된 소구점 ${approved}개의 근거와 3가지 적합성을 기록하세요.`,
    blocker: "레퍼런스 검증이 완료되지 않았습니다.",
  };
  return {
    stage: "기획 확정 준비",
    nextAction: "검증된 소구점과 근거로 기획안을 만드세요.",
    blocker: "",
  };
}
