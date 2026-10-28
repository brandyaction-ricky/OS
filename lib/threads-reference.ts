import { z } from "zod";
import { ApiError } from "./http";
import { kstScheduleDate } from "./content-automation-schedule";

export const THREADS_REFERENCE_WORKFLOW = "threads_reference_v1";
export const THREADS_REFERENCE_KIND = "threads_reference";
export const THREADS_REFERENCE_LIMIT = 20;
export const THREADS_METRIC_KEYS = ["views", "likes", "comments", "reposts"] as const;
// Initial editorial operating criteria, not an empirically validated viral benchmark.
export const REFERENCE_POLICY = { version: "2026-10-27.1", threadsMinViews: 100_000,
  substackMinLikes: 100, substackMinComparisonPosts: 5, substackMinLift: 2 } as const;
export function protectedThreadsAutomationJob(recordType: string, metadata: Record<string, unknown> = {}) {
  return recordType === "ai_job" && metadata.space === "personal"
    && (metadata.proc === "threads" || metadata.editorial_workflow === THREADS_REFERENCE_WORKFLOW || Object.hasOwn(metadata, "threadsInput"));
}
const httpsUrl = z.string().trim().max(2000).url().refine(value => {
  try { const url = new URL(value); return url.protocol === "https:" && !url.username && !url.password; }
  catch { return false; }
}, "HTTPS 원문 주소를 입력해 주세요.");
const metric = z.object({ value: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER).nullable(), verified: z.boolean() })
  .strict().refine(value => value.value !== null || !value.verified, "확인하지 못한 반응수는 미확인으로 남겨 주세요.");
const publishedAt = z.union([z.string().date(), z.string().datetime({ offset: true })]).nullable();
export const threadsReferenceItemSchema = z.object({
  id: z.string().trim().min(1).max(100), url: httpsUrl, title: z.string().trim().max(240),
  platform: z.enum(["threads", "substack", "other"]), author: z.string().trim().max(240),
  publishedAt, observedAt: z.string().datetime({ offset: true }),
  metrics: z.object({ views: metric, likes: metric, comments: metric, reposts: metric }).strict(),
  scene: z.string().trim().max(5000), readerQuestion: z.string().trim().max(3000),
  addedPerspective: z.string().trim().max(3000),
  koreanTitle: z.string().trim().max(240).default(""), summary: z.string().trim().max(3000).default(""),
  suggestedTopic: z.string().trim().max(240).default(""), relevanceNote: z.string().trim().max(3000).default(""),
  audienceNote: z.string().trim().max(3000).default(""),
  comparison: z.object({ basis: z.string().trim().max(3000), posts: z.array(z.object({
    url: httpsUrl, likes: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER), publishedAt: z.string().date(),
  }).strict()).max(10) }).strict().optional(),
  readScope: z.enum(["full", "partial", "preview", "unavailable"]),
  readNote: z.string().trim().max(3000), capturedBy: z.enum(["human", "aside"]),
}).strict();
export const threadsReferenceItemsSchema = z.array(threadsReferenceItemSchema).max(THREADS_REFERENCE_LIMIT)
  .refine(items => new Set(items.map(item => item.id)).size === items.length, "원문 항목 번호가 겹칩니다.");
export type ThreadsReferenceItem = z.infer<typeof threadsReferenceItemSchema>;

export function newThreadsReference(): ThreadsReferenceItem {
  return { id: globalThis.crypto.randomUUID(), url: "", title: "", platform: "threads", author: "",
    publishedAt: null, observedAt: new Date().toISOString(),
    metrics: { views: { value: null, verified: false }, likes: { value: null, verified: false },
      comments: { value: null, verified: false }, reposts: { value: null, verified: false } },
    scene: "", readerQuestion: "", addedPerspective: "", koreanTitle: "", summary: "", suggestedTopic: "",
    relevanceNote: "", audienceNote: "", readScope: "unavailable", readNote: "", capturedBy: "human" };
}
export function parseThreadsReferences(value: unknown): ThreadsReferenceItem[] {
  const parsed = threadsReferenceItemsSchema.safeParse(value);
  if (!parsed.success) throw new ApiError(422, "THREADS_REFERENCES_INVALID", "원문 주소·관측 시각·반응수·읽은 범위를 확인해 주세요.", parsed.error.flatten());
  return parsed.data;
}
export function hasVerifiedThreadsReaction(item: ThreadsReferenceItem) {
  return ["full", "partial"].includes(item.readScope) && Boolean(item.author.trim())
    && THREADS_METRIC_KEYS.some(key => item.metrics[key].verified && item.metrics[key].value !== null);
}
function sourceIdentity(value: string) {
  try {
    // Substack post identity is its host/path. Share and referral query
    // variants cannot count as independent comparison posts.
    const url = new URL(value); url.hash = ""; url.search = "";
    url.pathname = url.pathname.replace(/\/+$/, "") || "/";
    return url.toString();
  } catch { return value; }
}
export function evaluateThreadsReference(item: ThreadsReferenceItem): {
  status: "recommended" | "pending" | "reference_only"; label: string; reasons: string[];
  evidenceLabel: string; comparisonMedian: number | null;
} {
  const reasons: string[] = [];
  let referenceOnly = false, comparisonMedian: number | null = null;
  const present = (value: string | undefined) => Boolean(value?.trim());
  const korean = (value: string | undefined) => present(value) && /[가-힣]/.test(value!);
  const now = Date.now(), today = kstScheduleDate(new Date(now));
  const observedTime = Date.parse(item.observedAt);
  const observedDay = Number.isFinite(observedTime) ? kstScheduleDate(new Date(observedTime)) : "";
  const known = (key: typeof THREADS_METRIC_KEYS[number]) => item.metrics[key].verified && item.metrics[key].value !== null;
  const evidenceLabel = THREADS_METRIC_KEYS.some(known) ? "수치 확인됨 · 추천 여부 별도" : "반응 수치 미확인";
  if (item.readScope !== "full") reasons.push("원문 전체를 읽고 읽은 근거를 기록해 주세요.");
  for (const [key, label] of [["koreanTitle", "한국어 제목"], ["summary", "한국어 요약"], ["suggestedTopic", "한국어 추천 주제"]] as const)
    if (!korean(item[key])) reasons.push(`${label}를 작성해 주세요.`);
  for (const [key, label] of [["scene", "실제 장면"], ["readerQuestion", "독자 질문"], ["addedPerspective", "추가 관점"],
    ["relevanceNote", "우리 독자와의 관련성"], ["readNote", "읽은 근거"], ["author", "저자"], ["url", "원문 주소"]] as const)
    if (!present(item[key])) reasons.push(`${label}를 기록해 주세요.`);
  const audience = item.audienceNote?.trim() ?? "";
  if (audience.length < 20 || /^(미확인|확인 불가|없음|unknown|n\/?a)$/i.test(audience)
    || /(반응|질문|댓글).{0,20}(미확인|확인하지 못|확인할 수 없)/.test(audience))
    reasons.push("실제로 관측한 독자 질문·반응을 구체적으로 기록해 주세요(20자 이상). 예상 독자 반응은 근거가 아닙니다.");
  if (!item.observedAt || !Number.isFinite(observedTime) || observedTime > now)
    reasons.push("실제 관측 시각을 확인해 주세요. 미래 시각은 근거로 쓸 수 없습니다.");
  if (item.publishedAt) {
    const publishedTime = Date.parse(item.publishedAt);
    // Timestamp offsets identify instants; date-only entries use the same KST
    // calendar as the operator's publication-date and comparison-date fields.
    const futurePublication = item.publishedAt.includes("T")
      ? publishedTime > now || publishedTime > observedTime
      : item.publishedAt > today || item.publishedAt > observedDay;
    if (!Number.isFinite(publishedTime) || futurePublication)
      reasons.push("발행일은 관측일보다 늦거나 미래일 수 없습니다.");
  }
  if (item.platform === "threads") {
    if (!known("views")) reasons.push("Threads 조회수를 원문에서 확인해 주세요.");
    else if (item.metrics.views.value! < REFERENCE_POLICY.threadsMinViews) {
      referenceOnly = true; reasons.push("Threads 조회수가 추천 기준인 10만에 미치지 않습니다.");
    }
  } else if (item.platform === "substack") {
    if (!known("likes")) reasons.push("Substack 좋아요 수를 원문에서 확인해 주세요.");
    else if (item.metrics.likes.value! < REFERENCE_POLICY.substackMinLikes) {
      referenceOnly = true; reasons.push("Substack 좋아요 100개 이상이 초기 추천 운영 기준입니다.");
    }
    const basis = item.comparison?.basis ?? "";
    if (basis.length < 20 || !/((동일한?|같은)\s*(저자|작성자)|same\s+(author|writer))/i.test(basis) || !/(형식|포맷|format)/i.test(basis)
      || !/(발행|게시|경과|publication|published|age)/i.test(basis))
      reasons.push("비교 기준에 동일 저자·유사 형식·발행 후 경과기간을 확인한 근거를 적어 주세요.");
    const posts = item.comparison?.posts ?? [], seen = new Set<string>(), current = sourceIdentity(item.url);
    let invalidComparison = false;
    for (const post of posts) {
      const key = sourceIdentity(post.url);
      if (key === current || seen.has(key)) invalidComparison = true;
      seen.add(key);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(post.publishedAt) || !Number.isFinite(Date.parse(post.publishedAt))
        || post.publishedAt > today || post.publishedAt > observedDay) invalidComparison = true;
    }
    if (invalidComparison) reasons.push("비교 글의 중복·현재 원문·미래 발행일을 제외하고 실제 관측한 다른 글을 기록해 주세요.");
    if (seen.size < REFERENCE_POLICY.substackMinComparisonPosts)
      reasons.push("동일 저자의 비교 가능한 다른 글을 최소 5개 기록해 주세요.");
    if (!invalidComparison && posts.length >= REFERENCE_POLICY.substackMinComparisonPosts) {
      const likes = posts.map(post => post.likes).sort((a, b) => a - b), middle = Math.floor(likes.length / 2);
      comparisonMedian = likes.length % 2 ? likes[middle] : (likes[middle - 1] + likes[middle]) / 2;
      if (comparisonMedian === 0) reasons.push("비교 글 중앙값이 0이라 상대 반응을 판단할 수 없습니다. 비교 표본을 재검토해 주세요.");
      else if (known("likes") && item.metrics.likes.value! < comparisonMedian * REFERENCE_POLICY.substackMinLift) {
        referenceOnly = true; reasons.push("좋아요가 비교 글 중앙값의 2배에 미치지 않아 추천 기준을 충족하지 않습니다.");
      }
    }
  } else {
    referenceOnly = true; reasons.push("현재 추천 반응 기준은 Threads와 Substack에만 적용합니다.");
  }
  const status = referenceOnly ? "reference_only" : reasons.length ? "pending" : "recommended";
  return { status, label: status === "recommended" ? "추천 후보" : status === "pending" ? "검증 대기" : "내용 참고",
    reasons, evidenceLabel, comparisonMedian };
}
export function assertThreadsReferencesSelected(items: ThreadsReferenceItem[]) {
  if (!items.length) throw new ApiError(422, "THREADS_REFERENCE_REQUIRED", "주제에 사용할 원문을 하나 이상 선택해 주세요.");
}
export function validateThreadsTopicMetadata(metadata: Record<string, unknown>) {
  if (!("reference_items" in metadata) && metadata.editorial_workflow !== THREADS_REFERENCE_WORKFLOW
    && metadata.kind !== THREADS_REFERENCE_KIND) return metadata;
  if (metadata.editorial_workflow !== THREADS_REFERENCE_WORKFLOW)
    throw new ApiError(422, "THREADS_WORKFLOW_INVALID", "Threads 레퍼런스 작업의 공정을 확인해 주세요.");
  const items = parseThreadsReferences(metadata.reference_items ?? []);
  if (metadata.kind === THREADS_REFERENCE_KIND && items.length !== 1)
    throw new ApiError(422, "THREADS_REFERENCE_COUNT", "원문 기록 한 건에는 원문 하나를 저장해 주세요.");
  return { ...metadata, reference_items: items };
}
