import { z } from "zod";
import { ApiError } from "./http";

export const THREADS_REFERENCE_WORKFLOW = "threads_reference_v1";
export const THREADS_REFERENCE_KIND = "threads_reference";
export const THREADS_REFERENCE_LIMIT = 20;
export const THREADS_METRIC_KEYS = ["views", "likes", "comments", "reposts"] as const;
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
    scene: "", readerQuestion: "", addedPerspective: "", readScope: "unavailable", readNote: "", capturedBy: "human" };
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
export function assertThreadsReferencesReady(items: ThreadsReferenceItem[]) {
  if (!items.length || items.some(item => !["full", "partial"].includes(item.readScope)
    || !item.scene || !item.readerQuestion || !item.addedPerspective))
    throw new ApiError(422, "THREADS_REFERENCE_READ_REQUIRED", "선택한 원문의 실제 장면·독자 질문·추가 관점과 읽은 범위를 기록한 뒤 제작해 주세요.");
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
