import { after } from "next/server";
import { ApiError } from "@/lib/http";
import { createServiceSupabase } from "@/lib/supabase/server";
import { GPT_TIERS, type GptTier } from "@/lib/youtube-process/gpt-draft";
import { projectFromRecord } from "@/lib/youtube-process/project";
import type { YpScreenCheck } from "@/lib/youtube-process/stages";
import { parseScreen, sceneHints, SCREEN_SCHEMA, screenPrompt } from "@/lib/youtube-screen-check";
import type { RequestActor } from "./auth";
import { generateContentText } from "./content-model";
import { myinSheetSources } from "./myin-run";
import { creditTier } from "./openai-credit";
import { readStages, writeStage } from "./youtube-process-stages";

// 화면 자동 검사 (owner 2026-10-29, ④ 방식 A): every new set of 점검 시트 is read by GPT by itself, [다시 검사] reads it again. It only
// tells; the drafts and the full video go on regardless.
const RUNNING_MS = 12 * 60_000;

/** The v1 project a run belongs to, or null for a video outside the 유튜브 공정 (no screen check there). */
async function projectOf(sourceId: string) {
  const { data } = await createServiceSupabase().from("os_records").select("*").eq("id", sourceId).is("archived_at", null).maybeSingle();
  return data ? projectFromRecord(data as Parameters<typeof projectFromRecord>[0]) : null;
}

export async function checkMyinScreens(runId: string, tier: GptTier, timeoutMs = 400_000) {
  if (!process.env.OPENAI_API_KEY?.trim()) throw new ApiError(503, "OPENAI_NOT_CONFIGURED", "OpenAI 연결이 아직 없어서 화면 검사를 할 수 없어요.");
  const service = createServiceSupabase();
  const source = await myinSheetSources(service, runId);
  if (!source.urls.length) throw new ApiError(409, "MYIN_SHEETS_MISSING", "점검 시트가 나온 뒤에 검사할 수 있어요.");
  const project = await projectOf(source.run.sourceId);
  if (!project) return null;
  const current = (await readStages(service, project)).screenCheck;
  const same = current.data.runId === runId && current.data.sheetsAt === source.sheetsAt;
  if (same && current.data.state === "running" && Date.now() - Date.parse(current.data.at) < RUNNING_MS) return current;
  const { model, effort } = GPT_TIERS[tier];
  const base = { at: new Date().toISOString(), model, runId, sheetsAt: source.sheetsAt, scenes: [], note: "" };
  const who = { id: source.record.owner_id ?? project.assigneeId ?? "", team: source.record.team ?? "" };
  const running = await writeStage(service, who.id, who.team, project, "screenCheck", current, { ...base, state: "running" } satisfies YpScreenCheck);
  let data: YpScreenCheck;
  try {
    // A look at pictures, not a long argument: one step less thinking than the 원고 review on the same tier.
    const text = await generateContentText({ model, effort: effort === "high" ? "medium" : "low", maxTokens: 16_000, timeoutMs, jsonSchema: SCREEN_SCHEMA,
      prompt: screenPrompt(sceneHints(source.scenes), source.short), images: source.urls });
    const result = parseScreen(text, source.scenes.length);
    data = result ? { ...base, state: "done", ...result } : { ...base, state: "failed", error: "GPT 답을 읽지 못했어요. 다시 검사해 주세요." };
  } catch (error) {
    data = { ...base, state: "failed", error: error instanceof ApiError ? error.message : "화면 검사를 끝내지 못했어요. 다시 검사해 주세요." };
  }
  data.at = new Date().toISOString();
  const saved = await writeStage(service, who.id, who.team, project, "screenCheck", running, data).catch(async () => {
    const latest = (await readStages(service, project)).screenCheck;
    if (latest.data.state === "running" && latest.data.sheetsAt !== source.sheetsAt) return null;   // a newer preparation's check wins
    return writeStage(service, who.id, who.team, project, "screenCheck", latest, data);
  });
  return saved ? { ...saved, data } : (await readStages(service, project)).screenCheck;
}

/** After the render PC's preparation response: 정밀 unless this month's credit is nearly used up. */
export function scheduleScreenCheck(runId: string) {
  if (!process.env.OPENAI_API_KEY?.trim()) return;
  after(() => creditTier().then((tier) => checkMyinScreens(runId, tier)).then(() => undefined,
    (error) => console.error(`screen check failed: ${runId}: ${error instanceof Error ? error.message : error}`)));
}

/** The ③ panel: this run's latest check (none when the stored one is for another run). */
export async function myinScreenCheck(actor: RequestActor, runId: string) {
  const { data } = await actor.supabase.from("os_records").select("parent_id").eq("id", runId).eq("record_type", "ai_job").is("archived_at", null).maybeSingle();
  if (!data?.parent_id) throw new ApiError(404, "MYIN_RUN_NOT_FOUND", "v13 작업을 찾지 못했습니다.");
  const project = await projectOf(data.parent_id as string);
  if (!project) return { check: null };
  const check = (await readStages(createServiceSupabase(), project)).screenCheck.data;
  return { check: check.runId === runId ? check : null };
}
