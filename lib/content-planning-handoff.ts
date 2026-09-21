import { z } from "zod";

const productionFormatSchema = z.enum(["undecided", "script", "board", "mixed"]);
const formatChangeSchema = z.object({
  from: productionFormatSchema, to: productionFormatSchema,
  sourceVersion: z.number().int().positive(),
}).strict().refine(value => value.from !== value.to);

// User-authored working context, never an approval or a policy snapshot.
export const planningHandoffSchema = z.object({
  schemaVersion: z.literal(1),
  productionFormat: productionFormatSchema,
  contentApproach: z.enum(["undecided", "information", "viewpoint", "mixed"]),
  titlePromise: z.string().trim().max(1000),
  thumbnailCopy: z.string().trim().max(500),
  openingHook: z.string().trim().max(2000),
  evidenceNotes: z.string().trim().max(4000),
  unresolved: z.string().trim().max(2000),
  sharingNotes: z.string().trim().max(1000),
}).strict();

export type PlanningHandoff = z.infer<typeof planningHandoffSchema>;
export const productionFormats = { undecided: "미정", script: "원고형", board: "칠판형", mixed: "혼합형" } as const;
export const contentApproaches = { undecided: "미정", information: "정보 중심", viewpoint: "관점 중심", mixed: "정보 + 관점" } as const;
export const handoffFields = [
  ["titlePromise", "제목·영상이 약속하는 내용", 1000],
  ["thumbnailCopy", "썸네일 카피", 500],
  ["openingHook", "도입에서 보여줄 정보·질문", 2000],
  ["evidenceNotes", "자료·근거와 설계 메모", 4000],
  ["unresolved", "미확정 사항·확인이 필요한 것", 2000],
  ["sharingNotes", "편집자 전달 범위·공유 유의사항", 1000],
] as const;

export function readPlanningHandoff(value: unknown): PlanningHandoff | null {
  const result = planningHandoffSchema.safeParse(value);
  return result.success ? result.data : null;
}

export function planningHandoffUpdate(source: { id: string; version: number; metadata: Record<string, unknown> }, input: unknown) {
  const next = planningHandoffSchema.parse(input);
  const previous = readPlanningHandoff(source.metadata.planningHandoff);
  if (source.metadata.planningHandoff != null && !previous) throw new Error("기존 인계 메모 형식을 확인해 주세요.");
  const changed = previous && previous.productionFormat !== next.productionFormat;
  return { id: source.id, expectedVersion: source.version,
    metadata: { ...source.metadata, planningHandoff: next,
      ...(changed ? { productionFormatChange: { from: previous.productionFormat, to: next.productionFormat, sourceVersion: source.version } } : {}) } };
}

// A last-change note, not an approval, audit identity, or a completed review.
export function readProductionFormatChange(source: { version: number; metadata: Record<string, unknown> }) {
  const parsed = formatChangeSchema.safeParse(source.metadata.productionFormatChange);
  const current = readPlanningHandoff(source.metadata.planningHandoff);
  return parsed.success && current && parsed.data.to === current.productionFormat && parsed.data.sourceVersion < source.version ? parsed.data : null;
}
