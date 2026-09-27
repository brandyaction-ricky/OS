export type TopicCandidate = {
  title: string;
  hook: string;
  audienceNeed: string;
  angle: string;
  format: string;
  whyNow: string;
  evidence: string;
  sourceUrl: string;
  cta: string;
};

export function citedUrls(output: unknown): string[] {
  const urls = new Set<string>();
  const walk = (value: unknown): void => {
    if (!value || typeof value !== "object") return;
    if (Array.isArray(value)) { value.forEach(walk); return; }
    const object = value as Record<string, unknown>;
    if (object.type === "url_citation" && typeof object.url === "string") urls.add(object.url);
    Object.values(object).forEach(walk);
  };
  walk(output);
  return [...urls].filter((url) => { try { return new URL(url).protocol === "https:"; } catch { return false; } });
}

export function outputText(output: unknown): string {
  if (!output || typeof output !== "object") return "";
  const body = output as { output?: { content?: { type?: string; text?: string }[] }[] };
  return (body.output ?? []).flatMap((item) => item.content ?? [])
    .filter((item) => item.type === "output_text")
    .map((item) => item.text ?? "").join("\n").trim();
}

export function validateCandidates(value: unknown, sourceUrls: string[]): TopicCandidate[] {
  if (!value || typeof value !== "object") throw new Error("INVALID_CANDIDATES");
  const candidates = (value as { candidates?: unknown }).candidates;
  if (!Array.isArray(candidates) || candidates.length !== 3) throw new Error("INVALID_CANDIDATE_COUNT");
  const required: (keyof TopicCandidate)[] = ["title", "hook", "audienceNeed", "angle", "format", "whyNow", "evidence", "sourceUrl", "cta"];
  const allowed = new Set(sourceUrls);
  const validated = candidates.map((candidate) => {
    if (!candidate || typeof candidate !== "object") throw new Error("INVALID_CANDIDATE");
    const row = candidate as Record<string, unknown>;
    if (required.some((key) => typeof row[key] !== "string" || !(row[key] as string).trim())) throw new Error("INCOMPLETE_CANDIDATE");
    if (!allowed.has(row.sourceUrl as string)) throw new Error("UNVERIFIED_SOURCE");
    return row as TopicCandidate;
  });
  if (new Set(validated.map((item) => item.title.trim().toLowerCase())).size !== 3) throw new Error("DUPLICATE_CANDIDATES");
  return validated;
}

export function formatCandidates(candidates: TopicCandidate[]): string {
  return ["브랜디액션 인스타그램 주제 후보 3개 · 기획 검토용", ...candidates.map((item, index) => [
    `\n${index + 1}. ${item.title}`,
    `첫 문장: ${item.hook}`,
    `고객 문제: ${item.audienceNeed}`,
    `핵심 각도: ${item.angle}`,
    `형식: ${item.format}`,
    `지금 다룰 이유: ${item.whyNow}`,
    `자료 근거: ${item.evidence}`,
    `출처: ${item.sourceUrl}`,
    `CTA: ${item.cta}`,
  ].join("\n")), "\n자료를 확인한 후보입니다. 게시 전 채널 적합성과 표현을 검토해 주세요."].join("\n");
}
