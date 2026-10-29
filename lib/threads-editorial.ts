import { z } from "zod";
import { ApiError } from "./http";

export const THREADS_EDITORIAL_WORKFLOW = "threads_editorial_v1";
export const THREADS_EDITORIAL_CANON_MIN_VERSION = 16;
export const threadsEditorialRouteSchema = z.enum(["insight", "person"]);
export type ThreadsEditorialRoute = z.infer<typeof threadsEditorialRouteSchema>;
const text = (max: number) => z.string().trim().min(1).max(max);
const httpsUrl = z.string().url().max(2000).refine(value => {
  try { const url = new URL(value); return url.protocol === "https:" && !url.username && !url.password; }
  catch { return false; }
}, "HTTPS 원문 주소를 입력해 주세요.");
export function threadsEditorialDocumentId(value: string): string | null {
  try {
    const url = new URL(value);
    if (url.origin !== "https://brandyaction-os.vercel.app") return null;
    const id = url.pathname.match(/^\/knowledge\/doc\/([0-9a-f-]{36})\/?$/i)?.[1]
      ?? (url.pathname === "/knowledge" ? url.searchParams.get("document") : null);
    return id && z.string().uuid().safeParse(id).success ? id : null;
  } catch { return null; }
}
export const threadsEditorialMaterialSchema = z.object({
  firstParagraph: z.string().trim().min(20).max(1000).refine(value => /[가-힣]/.test(value), "첫 문단 시안을 한국어로 작성해 주세요."),
  readerQuestion: text(500), readerContext: text(1000), scene: text(1600),
  sceneKind: z.enum(["hypothetical", "documented"]), directAnswer: text(1000),
  perspective: text(2000), application: text(1600), reasonToRead: text(1000),
  sources: z.array(z.object({
    kind: z.enum(["os_document", "public"]), title: text(240), url: httpsUrl,
    locator: text(500), evidenceNote: text(1600),
  }).strict().superRefine((source, ctx) => {
    if (source.kind === "os_document" && !threadsEditorialDocumentId(source.url))
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["url"], message: "OS 문서 원문 주소가 필요합니다." });
    let internal = false;
    try { internal = new URL(source.url).origin === "https://brandyaction-os.vercel.app"; } catch { /* URL validation reports invalid input. */ }
    if (source.kind === "public" && internal)
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["url"], message: "내부 OS 문서는 공개 출처로 사용할 수 없습니다." });
  })).min(1).max(5),
  personName: text(120).optional(), eventDate: text(100).optional(),
}).strict();
export type ThreadsEditorialMaterial = z.infer<typeof threadsEditorialMaterialSchema>;
export const threadsEditorialCandidateSchema = z.object({
  title: text(240), editorial_route: threadsEditorialRouteSchema,
  editorial_material: threadsEditorialMaterialSchema,
}).strict().superRefine((candidate, ctx) => {
  const material = candidate.editorial_material;
  if (candidate.editorial_route === "insight" && !material.sources.some(source => source.kind === "os_document"))
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["editorial_material", "sources"], message: "인사이트형에는 wiki·보고서의 OS 원문 근거가 필요합니다." });
  if (candidate.editorial_route === "person" && (!material.personName || !material.eventDate
    || material.sceneKind !== "documented" || !material.sources.some(source => source.kind === "public")))
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["editorial_material"], message: "인물 분석형에는 인물·시점·실제 장면과 공개 원출처가 필요합니다." });
});
export const threadsEditorialCandidatesSchema = z.object({ candidates: z.array(threadsEditorialCandidateSchema).max(3) }).strict();
export type ThreadsEditorialCandidate = z.infer<typeof threadsEditorialCandidateSchema>;
export function hasThreadsEditorialMetadata(metadata: Record<string, unknown>) {
  return metadata.editorial_workflow === THREADS_EDITORIAL_WORKFLOW
    || Object.hasOwn(metadata, "editorial_route") || Object.hasOwn(metadata, "editorial_material");
}
export function parseThreadsEditorialMetadata(metadata: Record<string, unknown>) {
  if (!hasThreadsEditorialMetadata(metadata)) return null;
  if (metadata.editorial_workflow !== THREADS_EDITORIAL_WORKFLOW
    || ["kind", "reference_items", "sourceReferenceIds", "referenceIds", "sourceJobId"].some(key => Object.hasOwn(metadata, key)))
    throw new ApiError(422, "THREADS_EDITORIAL_INPUT_INVALID", "레퍼런스형과 인사이트·인물 분석형을 섞거나 경로를 바꿀 수 없습니다. 새 후보를 만들어 주세요.");
  const result = threadsEditorialCandidateSchema.safeParse({ title: "후보", editorial_route: metadata.editorial_route, editorial_material: metadata.editorial_material });
  if (!result.success) throw new ApiError(422, "THREADS_EDITORIAL_INPUT_INVALID", "질문·장면·답·관점·적용과 원문 근거를 확인해 주세요.", result.error.flatten());
  return { editorial_workflow: THREADS_EDITORIAL_WORKFLOW, editorial_route: result.data.editorial_route, editorial_material: result.data.editorial_material };
}
export function assertThreadsEditorialWorkflowUnchanged(current: Record<string, unknown>, patch: Record<string, unknown>) {
  for (const key of ["editorial_workflow", "editorial_route", "kind"])
    if (Object.hasOwn(patch, key) && patch[key] !== current[key])
      throw new ApiError(422, "THREADS_WORKFLOW_IMMUTABLE", "작성 경로는 바꿀 수 없습니다. 해당 경로에서 새 주제 후보를 만들어 주세요.");
}
