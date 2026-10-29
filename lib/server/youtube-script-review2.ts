import { after } from "next/server";
import { ApiError } from "@/lib/http";
import { projectName, type YpProject } from "@/lib/youtube-process/project";
import { scriptKey, type YpReview2 } from "@/lib/youtube-process/stages";
import { parseReview2, review2Prompt, REVIEW2_SCHEMA } from "@/lib/youtube-script-review2";
import type { RequestActor } from "./auth";
import { generateContentText } from "./content-model";
import { readStages, writeStage } from "./youtube-process-stages";
import { scriptCanonDocs } from "./youtube-script-canon";

// 원고 「두 번째 검수」 (owner 2026-10-29, 방식 A): runs by itself when a staff AI's 원고 lands, and again from [다시 검수]. It only
// shows its judgement; 다음: 제작 is not blocked until the owner decides so after it has been tried on her own live talks.
export const SECOND_REVIEW_MODEL = process.env.OPENAI_REVIEW_MODEL?.trim() || "gpt-6-astra";
const RUNNING_MS = 10 * 60_000;
type Who = { supabase: RequestActor["supabase"]; id: string; team: string };

/** Judges the 구성안's current 원고 and saves the result in its own record (running first, so a second press does not pay twice). */
export async function reviewScript(who: Who, project: YpProject, timeoutMs = 240_000) {
  if (!process.env.OPENAI_API_KEY?.trim()) throw new ApiError(503, "OPENAI_NOT_CONFIGURED", "OpenAI 연결이 아직 없어서 두 번째 검수를 할 수 없어요.");
  const stages = await readStages(who.supabase, project);
  const script = stages.outline.data.script;
  if (!script.trim()) throw new ApiError(409, "SCRIPT_EMPTY", "원고를 먼저 넣어 주세요.");
  const key = scriptKey(script), current = stages.review2;
  if (current.data.state === "running" && current.data.key === key && Date.now() - Date.parse(current.data.at) < RUNNING_MS) return current;
  const base = { at: new Date().toISOString(), model: SECOND_REVIEW_MODEL, key, gates: [], doubts: [] };
  const running = await writeStage(who.supabase, who.id, who.team, project, "review2", current, { ...base, state: "running" } satisfies YpReview2);
  let data: YpReview2;
  try {
    const canons = await scriptCanonDocs(who.supabase);
    const pick = stages.plan.data.confirmed?.A;
    const { prefix, prompt, paragraphs } = review2Prompt({ review: canons["원고 검수 정본"], tone: canons["원고 말투 정본"] },
      { title: pick?.title || projectName(project), thumbCopy: pick?.thumb?.copy || pick?.thumb?.screen || "", script });
    const text = await generateContentText({ model: SECOND_REVIEW_MODEL, cachedPrefix: prefix, prompt, jsonSchema: REVIEW2_SCHEMA, maxTokens: 32_000, effort: "high", timeoutMs });
    const result = parseReview2(text, paragraphs);
    data = result ? { ...base, state: "done", ...result } : { ...base, state: "failed", error: "GPT 답을 읽지 못했어요. 다시 검수해 주세요." };
  } catch (error) {
    data = { ...base, state: "failed", error: error instanceof ApiError ? error.message : "GPT 검수를 끝내지 못했어요. 다시 검수해 주세요." };
  }
  data.at = new Date().toISOString();
  const saved = await writeStage(who.supabase, who.id, who.team, project, "review2", running, data).catch(async () => {
    // Someone saved this record meanwhile: a newer 원고's judgement that is still running wins, anything else is overwritten.
    const latest = (await readStages(who.supabase, project)).review2;
    if (latest.data.state === "running" && latest.data.key !== key) return null;
    return writeStage(who.supabase, who.id, who.team, project, "review2", latest, data);
  });
  return saved ? { ...saved, data } : (await readStages(who.supabase, project)).review2;
}

/** After the response that saved a staff AI's 원고: the judgement must not hold up the AI's own complete call. */
export function scheduleScriptReview(who: Who, project: YpProject) {
  if (!process.env.OPENAI_API_KEY?.trim()) return;
  after(() => reviewScript(who, project).then(() => undefined, (error) => console.error(`script review2 failed: ${project.id}: ${error instanceof Error ? error.message : error}`)));
}
