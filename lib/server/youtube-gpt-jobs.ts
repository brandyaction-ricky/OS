import { after } from "next/server";
import { ApiError } from "@/lib/http";
import { createServiceSupabase } from "@/lib/supabase/server";
import { GPT_AUTO_TASKS, GPT_TIERS, type GptTier } from "@/lib/youtube-process/gpt-draft";
import type { YpProject } from "@/lib/youtube-process/project";
import type { RequestActor } from "./auth";
import { generateContentText } from "./content-model";
import { creditTier } from "./openai-credit";
import { claimStaffJob, completeStaffJob, failStaffJob, requestStaffJob, staffJobRequestSchema } from "./youtube-ai-jobs";
import { displayName } from "./youtube-process-ai";
import { readStages } from "./youtube-process-stages";

// GPT 초안 (owner 2026-10-29, ③): the OS does a staff-AI job card itself with the company's GPT credit — the same job record, the
// same card, the same checks and saves as a staff member's own AI, so a GPT 초안 lands where theirs would and is fixed the same way.
const PREFACE = `아래 작업 카드는 직원 AI에게 주는 것과 같습니다. 이번에는 OS가 직접 당신에게 맡깁니다.
- 카드가 「먼저 끝까지 열 문서」로 적은 문서는 본문을 붙였습니다. 문서를 열라는 지시는 붙인 본문을 처음부터 끝까지 읽는 것으로 대신합니다.
- OS 검색 · 문서 도구는 쓸 수 없습니다. 카드와 붙인 문서에 없는 사실 · 후기 · 수치는 지어내지 않습니다.
- 답은 카드가 말하는 result 객체 하나를 JSON으로만 냅니다. action · job_id · lease · model은 쓰지 않고, 설명 문장도 붙이지 않습니다.
- 승인 · 업로드 · 게시는 하지 않습니다.`;
type Owner = { id: string; name: string; team: string };

/** The job owner's "AI" played by the OS: the service client, never a staff member's key. */
const gptActor = (owner: Owner) => ({ type: "agent", id: owner.id, ownerId: owner.id, name: owner.name, team: owner.team, user: null, role: "member", brand: null,
  allowedStatuses: [], scopes: [], organizationId: null, mustChangePassword: false, supabase: createServiceSupabase() }) as unknown as RequestActor;

/** The documents a card tells its AI to open, pasted in (each up to 40,000 letters, 160,000 in all). */
async function cardDocs(instructions: string) {
  const ids = [...new Set([...instructions.matchAll(/doc_id: ([0-9a-f-]{36})/gi)].map((match) => match[1]))];
  if (!ids.length) return "";
  const { data } = await createServiceSupabase().from("os_documents").select("id,title,content_md").in("id", ids).neq("status", "archived");
  let left = 160_000;
  return (data ?? []).map((doc) => {
    const text = String(doc.content_md ?? "").slice(0, Math.max(0, Math.min(40_000, left)));
    left -= text.length;
    return `=== [${doc.title}] (doc_id: ${doc.id}) ===\n${text}`;
  }).join("\n\n");
}

/** GPT may answer { result: … } as the card's submit line shows; the saves want the object inside. */
const unwrap = (value: unknown) => value && typeof value === "object" && !Array.isArray(value) && "result" in value && Object.keys(value).length <= 4
  ? (value as { result: unknown }).result : value;

/** Takes the job, asks GPT (a second try with the OS's format problems), and completes or fails it like a staff AI would. */
export async function runGptJob(jobId: string, owner: Owner, tier: GptTier) {
  const agent = gptActor(owner);
  const claimed = await claimStaffJob(agent, jobId, true) as { lease: string; instructions: string };
  const { model, effort } = GPT_TIERS[tier];
  let issues = "";
  try {
    const docs = await cardDocs(claimed.instructions);
    for (let attempt = 0; attempt < 2; attempt++) {
      const text = await generateContentText({ model, effort, maxTokens: 32_000, timeoutMs: 600_000, cachedPrefix: docs ? `${PREFACE}\n\n# 붙인 문서\n${docs}` : PREFACE,
        prompt: `# 작업 카드\n${claimed.instructions}${issues ? `\n\n## 지난 답에서 OS가 돌려준 고칠 점 (고쳐서 다시 답합니다)\n${issues}` : ""}` });
      let result: unknown;
      try { result = unwrap(JSON.parse(text)); } catch { issues = "JSON 객체 하나로만 답해 주세요."; continue; }
      if (!result || typeof result !== "object" || Array.isArray(result)) { issues = "result는 JSON 객체여야 해요."; continue; }
      try { return await completeStaffJob(agent, { action: "complete", jobId, lease: claimed.lease, model, result: result as Record<string, unknown> }); }
      catch (error) { if (error instanceof ApiError && error.status === 422) { issues = error.message; continue; } throw error; }
    }
    throw new ApiError(422, "GPT_FORMAT", `형식을 맞추지 못했어요: ${issues}`);
  } catch (error) {
    const reason = error instanceof ApiError ? error.message : "GPT가 끝내지 못했어요. 다시 만들어 주세요.";
    // A job the OS already closed (its input moved on) has no lease left to fail.
    await failStaffJob(agent, { action: "fail", jobId, lease: claimed.lease, reason: reason.slice(0, 1000) }).catch(() => undefined);
    throw error;
  }
}

/** After the response that made the job: GPT takes several minutes, the person who asked does not wait for it. */
export function scheduleGptJob(jobId: string, owner: Owner, tier: GptTier) {
  after(() => runGptJob(jobId, owner, tier).then(() => undefined, (error) => console.error(`gpt job failed: ${jobId}: ${error instanceof Error ? error.message : error}`)));
}

/**
 * The 최종 검토 OK of a longform: 업로드 자료 · SEO 칼럼 1편 · 숏폼 주제 후보 3개 start on GPT for the project's PD (the 대표 when there is
 * none). A step that already has content, or a staff AI still writing it, is left alone.
 */
export function scheduleAutoDrafts(project: YpProject, by: Owner) {
  if (!process.env.OPENAI_API_KEY?.trim() || project.yp.topic.type === "short") return;
  after(async () => {
    const service = createServiceSupabase();
    const ownerId = project.assigneeId || by.id;
    const owner = { id: ownerId, name: ownerId === by.id ? by.name : await displayName(service, ownerId, "담당자"), team: by.team };
    const [stages, tier] = await Promise.all([readStages(service, project), creditTier()]);
    const filled = { kit: Boolean(stages.upload.data.desc.trim()), column: stages.column.data.items.length > 0, "short-topics": stages.shortTopics.data.items.length > 0 };
    await Promise.all(GPT_AUTO_TASKS.filter((task) => !filled[task]).map(async (task) => {
      try {
        const input = staffJobRequestSchema.parse(task === "kit" ? { task, sourceId: project.id } : { task, sourceId: project.id, count: task === "column" ? 1 : 3 });
        const job = await requestStaffJob(gptActor(owner), input, { tier });
        if (job.status === "backlog") await runGptJob(job.id, owner, tier);
      } catch (error) { console.error(`gpt draft ${task} skipped: ${project.id}: ${error instanceof Error ? error.message : error}`); }
    }));
  });
}
