import { after } from "next/server";
import { ApiError } from "@/lib/http";
import { projectName, type YpProject } from "@/lib/youtube-process/project";
import { scriptKey, type YpReview2 } from "@/lib/youtube-process/stages";
import { GPT_TIERS, type GptTier } from "@/lib/youtube-process/gpt-draft";
import { mergeDelta, numberedScript, parseReview2, reviewDelta, review2Prompt, REVIEW2_SCHEMA } from "@/lib/youtube-script-review2";
import type { RequestActor } from "./auth";
import { generateContentText } from "./content-model";
import { creditTier } from "./openai-credit";
import { readStages, writeStage } from "./youtube-process-stages";
import { scriptCanonDocs } from "./youtube-script-canon";
import { channelContext } from "./channel-canon";

// 원고 「두 번째 검수」 (owner 2026-10-29, 방식 A): runs by itself when a staff AI's 원고 lands, and again from [다시 검수]. It only
// shows its judgement; 다음: 제작 is not blocked until the owner decides so after it has been tried on her own live talks.
const RUNNING_MS = 12 * 60_000;
type Who = { supabase: RequestActor["supabase"]; id: string; team: string };

/** Judges the 구성안's current 원고 and saves the result in its own record (running first, so a second press does not pay twice). */
// GPT-6 Astra on high effort took 216 s on a 6,700-letter 원고 and ran past 300 s on another (calibration 2026-10-29).
export async function reviewScript(who: Who, project: YpProject, tier: GptTier, timeoutMs = 600_000) {
  if (!process.env.OPENAI_API_KEY?.trim()) throw new ApiError(503, "OPENAI_NOT_CONFIGURED", "OpenAI 연결이 아직 없어서 두 번째 검수를 할 수 없어요.");
  const stages = await readStages(who.supabase, project);
  const script = stages.outline.data.script;
  if (!script.trim()) throw new ApiError(409, "SCRIPT_EMPTY", "원고를 먼저 넣어 주세요.");
  const key = scriptKey(script), current = stages.review2;
  const { model, effort } = GPT_TIERS[tier];
  const outline = stages.outline.data;
  const version = outline.versions.at(-1);
  const isGenerated = version?.why === "ai" && version.md === script && (version.trace !== undefined || version.at === outline.ai?.at);
  const trace = isGenerated ? version.trace ?? (version.at === outline.ai?.at ? outline.ai.trace : undefined) : undefined;
  const source: YpReview2["source"] = { version: version?.v ?? 0, origin: isGenerated ? "ai" : "human", by: version?.by ?? "", bundle: trace?.find(ref => ref.title === "원고 공정 정본")?.bundle, trace };
  const sameSource = current.data.source?.origin === source.origin && current.data.source?.version === source.version;
  if (current.data.state === "done" && current.data.key === key && sameSource) return current;
  if (current.data.state === "running" && current.data.key === key && sameSource && Date.now() - Date.parse(current.data.at) < RUNNING_MS) return current;
  const lines = numberedScript(script).text.split("\n\n").filter(line => /^\[\d+\]/.test(line));
  const paragraphKeys = lines.map(line => scriptKey(line.replace(/^\[\d+\] /, "")));
  const delta = isGenerated && !sameSource ? null : reviewDelta(current.data, paragraphKeys);
  const history = [...(current.data.history ?? [])];
  if (current.data.state === "done") {
    const { source: oldSource, key: oldKey, at, pass, gates } = current.data;
    history.push({ source: oldSource, key: oldKey, at, pass, gates });
  }
  const base = { history: history.slice(-20), source, paragraphKeys, ...(delta ? { reviewedParagraphs: delta.changed } : {}), at: new Date().toISOString(), model, key, gates: [], doubts: [] };
  const running = await writeStage(who.supabase, who.id, who.team, project, "review2", current, { ...base, state: "running" } satisfies YpReview2);
  let data: YpReview2;
  try {
    const canons = await scriptCanonDocs(who.supabase);
    const pick = stages.plan.data.confirmed?.A;
    const channel = await channelContext(project.id);
    const { data: canon } = channel ? await who.supabase.from("os_documents").select("content_md").eq("id", channel.canon.id).maybeSingle() : { data: null };
    const { prefix, prompt, paragraphs } = review2Prompt({ review: canons["원고 검수 정본"], tone: canons["원고 말투 정본"] },
      { title: pick?.title || projectName(project), thumbCopy: pick?.thumb?.copy || pick?.thumb?.screen || "", script },
      channel ? { text: channel.text, title: channel.canon.title, content: String(canon?.content_md ?? "").slice(0, 40_000) } : undefined);
    const scope = delta ? `${prompt.split("=== 원고 (")[0]}=== 바뀐 문단 ===\n${delta.changed.map(n => lines[n - 1]).join("\n\n")}\n위 번호의 문단만 검수합니다. 제공되지 않은 문단에 대해 추측하지 마세요.` : prompt;
    const text = await generateContentText({ model, cachedPrefix: prefix, prompt: scope, jsonSchema: REVIEW2_SCHEMA, maxTokens: 32_000, effort, timeoutMs });
    const result = parseReview2(text, paragraphs);
    data = result ? { ...base, state: "done", ...(delta ? mergeDelta(current.data, result, delta) : result) } : { ...base, state: "failed", error: "GPT 답을 읽지 못했어요. 다시 검수해 주세요." };
  } catch (error) {
    data = { ...base, state: "failed", error: error instanceof ApiError ? error.message : "GPT 검수를 끝내지 못했어요. 다시 검수해 주세요." };
  }
  data.at = new Date().toISOString();
  const saved = await writeStage(who.supabase, who.id, who.team, project, "review2", running, data).catch(async () => {
    // Someone saved this record meanwhile: a newer 원고's judgement that is still running wins, anything else is overwritten.
    const latest = (await readStages(who.supabase, project)).review2;
    if (latest.data.at !== base.at || latest.data.state !== "running" || latest.data.key !== key) return null;
    return writeStage(who.supabase, who.id, who.team, project, "review2", latest, data);
  });
  return saved ? { ...saved, data } : (await readStages(who.supabase, project)).review2;
}

/** After the response that saved a staff AI's 원고: the judgement must not hold up the AI's own complete call (the routes that
 * save one allow 800 s for it). */
export function scheduleScriptReview(who: Who, project: YpProject) {
  if (!process.env.OPENAI_API_KEY?.trim()) return;
  after(() => creditTier().then(tier => reviewScript(who, project, tier)).then(() => undefined, (error) => console.error(`script review2 failed: ${project.id}: ${error instanceof Error ? error.message : error}`)));
}
