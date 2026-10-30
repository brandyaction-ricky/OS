// 카드뉴스 정본 다듬기 (정본 §9): one company 시험 묶음, and a run per 「이 정본으로 다시 뽑기」 — the company GPT draws every 시험 원본 in
// the picked formats under the 정본 as it is now, and people score the drafts on the 평가표. The 정본 itself is edited in its OS
// document (PD proposes, 대표 approves); each run keeps the 정본 묶음 version it was drawn under, so runs compare version by version.
import { randomUUID } from "node:crypto";
import { after } from "next/server";
import { z } from "zod";
import { ApiError } from "@/lib/http";
import { createServiceSupabase } from "@/lib/supabase/server";
import { CARD_FORMAT_IDS, type CardFormatId } from "@/lib/cardnews/formats";
import { BENCH_MAX, CARD_GRADES, resultKey, type Bench, type BenchItem, type BenchResult, type BenchRun } from "@/lib/cardnews/grind";
import { GPT_TIERS, type GptTier } from "@/lib/youtube-process/gpt-draft";
import { projectName, type YpProject } from "@/lib/youtube-process/project";
import type { RequestActor } from "./auth";
import { namedProcedures } from "./content-generation";
import { generateContentText } from "./content-model";
import { cardCanon, cardJobCard, checkCardResult, VOICE_CANON_TITLE } from "./youtube-process-card-job";
import { cardDocs, PREFACE, unwrap } from "./youtube-gpt-jobs";
import { getYoutubeProject } from "./youtube-process";
import { readStages } from "./youtube-process-stages";

const BENCH_KIND = "yp_card_bench", RUN_KIND = "yp_card_bench_run";
/** A run older than this that never finished counts as failed (the function was stopped). */
const RUNNING_MS = 15 * 60_000;
const service = () => createServiceSupabase();
type Row = { id: string; version: number; metadata: Record<string, unknown> };
const conflict = () => new ApiError(409, "RECORD_VERSION_CONFLICT", "다른 사람이 먼저 고쳤어요. 새로 불러와 주세요.");

async function benchRow(actor?: RequestActor): Promise<Row | null> {
  const { data, error } = await service().from("os_records").select("id,version,metadata").eq("record_type", "content_package")
    .eq("metadata->>packageKind", BENCH_KIND).is("archived_at", null).order("created_at").limit(1);
  if (error) throw new ApiError(503, "CARD_BENCH_READ_FAILED", "시험 묶음을 불러오지 못했어요.");
  if (data?.[0] || !actor) return (data?.[0] as Row) ?? null;
  const { data: made, error: makeError } = await service().from("os_records").insert({ id: randomUUID(), record_type: "content_package", title: "카드뉴스 시험 묶음",
    status: "active", priority: "normal", owner_id: actor.id, created_by: actor.id, updated_by: actor.id, team: actor.team, tags: ["카드뉴스", "정본 다듬기"],
    metadata: { packageKind: BENCH_KIND, bench: { items: [] } satisfies Bench }, description: "" }).select("id,version,metadata").single();
  if (makeError || !made) throw new ApiError(400, "CARD_BENCH_SAVE_FAILED", "시험 묶음을 만들지 못했어요.");
  return made as Row;
}
const benchOf = (row: Row | null): Bench => ({ items: (row?.metadata.bench as Bench | undefined)?.items ?? [] });

/** Read, change, write over the version read; a write that crossed another is read and applied again (up to three times). */
async function update<T>(read: () => Promise<Row>, change: (row: Row) => T, key: string, by: string) {
  for (let attempt = 0; attempt < 3; attempt++) {
    const row = await read();
    const value = change(row);
    const { data, error } = await service().from("os_records").update({ metadata: { ...row.metadata, [key]: value }, updated_by: by })
      .eq("id", row.id).eq("version", row.version).select("id").maybeSingle();
    if (error) throw new ApiError(400, "CARD_BENCH_SAVE_FAILED", "저장하지 못했어요.");
    if (data) return value;
  }
  throw conflict();
}

async function runRows(benchId: string) {
  const { data, error } = await service().from("os_records").select("id,version,metadata").eq("record_type", "content_package").eq("parent_id", benchId)
    .eq("metadata->>packageKind", RUN_KIND).is("archived_at", null).order("created_at", { ascending: false }).limit(12);
  if (error) throw new ApiError(503, "CARD_BENCH_READ_FAILED", "다시 뽑은 결과를 불러오지 못했어요.");
  return (data ?? []) as Row[];
}
const runOf = (row: Row): BenchRun => {
  const run = { ...(row.metadata.run as BenchRun), id: row.id };
  return run.state === "running" && Date.now() - Date.parse(run.at) > RUNNING_MS ? { ...run, state: "failed", error: "시간 안에 끝내지 못했어요. 다시 뽑아 주세요." } : run;
};

export async function readGrind() {
  const row = await benchRow();
  const canon = await cardCanon(service());
  return { bench: benchOf(row), runs: row ? (await runRows(row.id)).map(runOf) : [], canon };
}

export const grindActionSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("add"), projectId: z.string().uuid() }).strict(),
  z.object({ action: z.literal("addTopic"), title: z.string().trim().min(2).max(200), target: z.string().trim().min(1).max(300), note: z.string().max(2000).default("") }).strict(),
  z.object({ action: z.literal("remove"), itemId: z.string().max(40) }).strict(),
  z.object({ action: z.literal("run"), formats: z.array(z.enum(CARD_FORMAT_IDS as [CardFormatId, ...CardFormatId[]])).min(1).max(3), tier: z.enum(["precise", "saving"]) }).strict(),
  z.object({ action: z.literal("score"), runId: z.string().uuid(), key: z.string().max(60),
    grades: z.record(z.enum(["1", "2", "3", "4", "5", "6"]), z.enum(CARD_GRADES as [string, ...string[]])), notes: z.record(z.enum(["1", "2", "3", "4", "5", "6"]), z.string().max(300)).default({}) }).strict(),
]);

/** A 카드뉴스 the person can open, frozen as a 시험 원본 (its text, focus and topic). */
async function itemFromProject(actor: RequestActor, projectId: string): Promise<BenchItem> {
  const project = await getYoutubeProject(actor, projectId);
  if (project.yp.topic.type !== "card") throw new ApiError(400, "NOT_CARD_PROJECT", "카드뉴스만 시험 묶음에 넣을 수 있어요.");
  const cards = (await readStages(actor.supabase, project)).cards.data;
  const title = projectName(project);
  return { id: randomUUID().slice(0, 8), title, target: project.yp.topic.target, note: project.yp.topic.note, focus: cards.focus, source: cards.source,
    from: { projectId, title }, at: new Date().toISOString(), by: actor.name };
}

export async function actOnGrind(actor: RequestActor, input: z.infer<typeof grindActionSchema>) {
  if (input.action === "add" || input.action === "addTopic" || input.action === "remove") {
    const item = input.action === "add" ? await itemFromProject(actor, input.projectId)
      : input.action === "addTopic" ? { id: randomUUID().slice(0, 8), title: input.title, target: input.target, note: input.note, focus: "",
        source: { kind: "none" as const, title: input.title, text: "", at: new Date().toISOString() }, at: new Date().toISOString(), by: actor.name } satisfies BenchItem : null;
    await update(async () => (await benchRow(actor))!, row => {
      const bench = benchOf(row);
      if (input.action === "remove") return { items: bench.items.filter(row => row.id !== input.itemId) };
      if (bench.items.length >= BENCH_MAX) throw new ApiError(400, "CARD_BENCH_FULL", `시험 원본은 ${BENCH_MAX}개까지예요. 하나를 빼고 넣어 주세요.`);
      if (item!.from && bench.items.some(row => row.from?.projectId === item!.from!.projectId)) throw new ApiError(409, "CARD_BENCH_DUPLICATE", "이미 시험 묶음에 있어요.");
      return { items: [...bench.items, item!] };
    }, "bench", actor.id);
    return readGrind();
  }
  if (input.action === "score") {
    const read = async () => {
      const { data, error } = await service().from("os_records").select("id,version,metadata").eq("id", input.runId).eq("metadata->>packageKind", RUN_KIND).is("archived_at", null).maybeSingle();
      if (error || !data) throw new ApiError(404, "CARD_RUN_NOT_FOUND", "그 결과를 찾지 못했어요.");
      return data as Row;
    };
    await update(read, row => {
      const run = runOf(row);
      if (run.state !== "done" || !run.results.some(result => result.key === input.key && result.draft)) throw new ApiError(409, "CARD_RUN_NOT_READY", "다 뽑힌 초안만 채점할 수 있어요.");
      if (Object.entries(input.grades).some(([n, grade]) => grade !== "상" && !input.notes[n as keyof typeof input.notes]?.trim())) throw new ApiError(400, "CARD_SCORE_REASON", "‘중’ · ‘하’에는 이유를 한 줄 써 주세요.");
      const grades = Object.fromEntries(Object.entries(input.grades).map(([n, grade]) => [Number(n), grade]));
      const notes = Object.fromEntries(Object.entries(input.notes).filter(([, note]) => note.trim()).map(([n, note]) => [Number(n), note.trim()]));
      return { ...(row.metadata.run as BenchRun), scores: { ...run.scores, [input.key]: { ...(run.scores[input.key] ?? {}), [actor.ownerId]: { name: actor.name, grades, notes, at: new Date().toISOString() } } } };
    }, "run", actor.id);
    return readGrind();
  }
  return { ...(await startRun(actor, input.formats, input.tier)), ...(await readGrind()) };
}

/** 「이 정본으로 다시 뽑기」: one run record now, the GPT work after the response (several minutes). */
async function startRun(actor: RequestActor, formats: CardFormatId[], tier: GptTier) {
  if (!process.env.OPENAI_API_KEY?.trim()) throw new ApiError(503, "OPENAI_NOT_CONFIGURED", "OpenAI 연결이 아직 없어서 다시 뽑을 수 없어요.");
  const row = await benchRow(actor);
  const bench = benchOf(row);
  if (!bench.items.length) throw new ApiError(400, "CARD_BENCH_EMPTY", "시험 원본을 먼저 넣어 주세요.");
  const canon = await cardCanon(service());
  if (!canon) throw new ApiError(409, "CARD_CANON_MISSING", "「카드뉴스 정본」을 찾지 못했어요.");
  if ((await runRows(row!.id)).map(runOf).some(run => run.state === "running")) throw new ApiError(409, "CARD_RUN_BUSY", "이미 다시 뽑는 중이에요. 끝나면 다시 눌러 주세요.");
  const { model } = GPT_TIERS[tier];
  const run: Omit<BenchRun, "id"> = { canon: canon.version, at: new Date().toISOString(), by: actor.ownerId, byName: actor.name, model, formats, state: "running", results: [], scores: {} };
  const { data, error } = await service().from("os_records").insert({ id: randomUUID(), record_type: "content_package", title: `카드뉴스 정본 ${canon.version} 다시 뽑기`, status: "active",
    priority: "normal", parent_id: row!.id, owner_id: actor.id, created_by: actor.id, updated_by: actor.id, team: actor.team, tags: ["카드뉴스", "정본 다듬기"],
    metadata: { packageKind: RUN_KIND, run }, description: "" }).select("id").single();
  if (error || !data) throw new ApiError(400, "CARD_RUN_SAVE_FAILED", "다시 뽑기를 시작하지 못했어요.");
  after(() => drawRun(data.id as string, bench.items, formats, tier, canon, actor.id).catch(reason => console.error(`card grind run failed: ${reason instanceof Error ? reason.message : reason}`)));
  return { started: data.id as string };
}

/** Every 시험 원본 drawn in parallel (each one GPT answer with all formats, a second try with the OS's format problems), then saved once. */
async function drawRun(runId: string, items: BenchItem[], formats: CardFormatId[], tier: GptTier, canon: { id: string; version: string }, by: string) {
  const { model, effort } = GPT_TIERS[tier];
  const voice = await namedProcedures(service(), [VOICE_CANON_TITLE]);
  const card = (item: BenchItem) => cardJobCard({ project: { title: item.title, yp: { topic: { target: item.target, note: item.note } } } as unknown as Pick<YpProject, "title" | "yp">,
    cards: { source: item.source, focus: item.focus }, formats, canon, voice, leaseMinutes: 30 });
  const docs = await cardDocs(card(items[0]));
  const draw = async (item: BenchItem): Promise<BenchResult[]> => {
    let issues = "";
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const text = await generateContentText({ model, effort, maxTokens: 32_000, timeoutMs: 600_000, cachedPrefix: docs ? `${PREFACE}\n\n# 붙인 문서\n${docs}` : PREFACE,
          prompt: `# 작업 카드\n${card(item)}${issues ? `\n\n## 지난 답에서 OS가 돌려준 고칠 점 (고쳐서 다시 답합니다)\n${issues}` : ""}` });
        const checked = checkCardResult(unwrap(JSON.parse(text)), formats);
        return checked.drafts.map(draft => ({ key: resultKey(item.id, draft.format), itemId: item.id, title: item.title, format: draft.format, draft }));
      } catch (error) {
        issues = error instanceof ApiError ? error.message : error instanceof SyntaxError ? "JSON 객체 하나로만 답해 주세요." : "";
        if (!issues) return formats.map(format => ({ key: resultKey(item.id, format), itemId: item.id, title: item.title, format, error: "GPT가 끝내지 못했어요." }));
      }
    }
    return formats.map(format => ({ key: resultKey(item.id, format), itemId: item.id, title: item.title, format, error: `형식을 맞추지 못했어요: ${issues}`.slice(0, 500) }));
  };
  let results: BenchResult[] = [], failure = "";
  try { results = (await Promise.all(items.map(draw))).flat(); } catch (error) { failure = error instanceof Error ? error.message : "다시 뽑지 못했어요."; }
  const read = async () => (await service().from("os_records").select("id,version,metadata").eq("id", runId).single()).data as Row;
  await update(read, row => ({ ...(row.metadata.run as BenchRun), state: failure ? "failed" as const : "done" as const, results, ...(failure ? { error: failure.slice(0, 300) } : {}) }), "run", by);
}
