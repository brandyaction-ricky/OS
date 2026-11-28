import { after } from "next/server";
import type { CanonTrace } from "@/lib/youtube-process/canon-trace";
import { ApiError } from "@/lib/http";
import { createServiceSupabase } from "@/lib/supabase/server";
import { GPT_AUTO_TASKS, GPT_TIERS, type GptTier } from "@/lib/youtube-process/gpt-draft";
import type { YpProject } from "@/lib/youtube-process/project";
import type { RequestActor } from "./auth";
import { generateContentText } from "./content-model";
import { creditTier } from "./openai-credit";
import { cardJobPhase, claimStaffJob, completeStaffJob, failStaffJob, requestStaffJob, staffJobRequestSchema } from "./youtube-ai-jobs";
import { displayName } from "./youtube-process-ai";
import { columnToMyin, readStages } from "./youtube-process-stages";
import { getYoutubeProject, notify } from "./youtube-process";
import { makeShortFromRecycle } from "./youtube-process-short-recycle";
import { columnEmptyPlaces } from "@/lib/seo-column";

// GPT 초안 (owner 2026-10-29, ③): the OS does a staff-AI job card itself with the company's GPT credit — the same job record, the
// same card, the same checks and saves as a staff member's own AI, so a GPT 초안 lands where theirs would and is fixed the same way.
export const PREFACE = `아래 작업 카드는 직원 AI에게 주는 것과 같습니다. 이번에는 OS가 직접 당신에게 맡깁니다.
- 카드가 「먼저 끝까지 열 문서」로 적은 문서는 본문을 붙였습니다. 문서를 열라는 지시는 붙인 본문을 처음부터 끝까지 읽는 것으로 대신합니다.
- OS 검색 · 문서 도구는 쓸 수 없습니다. 카드와 붙인 문서에 없는 사실 · 후기 · 수치는 지어내지 않습니다.
- 답은 카드가 말하는 result 객체 하나를 JSON으로만 냅니다. action · job_id · lease · model은 쓰지 않고, 설명 문장도 붙이지 않습니다.
- 승인 · 업로드 · 게시는 하지 않습니다.`;
type Owner = { id: string; name: string; team: string };

/** The job owner's "AI" played by the OS: the service client, never a staff member's key. */
const gptActor = (owner: Owner) => ({ type: "agent", id: owner.id, ownerId: owner.id, name: owner.name, team: owner.team, user: null, role: "member", brand: null,
  allowedStatuses: [], scopes: [], organizationId: null, mustChangePassword: false, supabase: createServiceSupabase() }) as unknown as RequestActor;

/** The documents a card tells its AI to open, pasted in (each up to 40,000 letters, 160,000 in all). */
export async function cardDocs(instructions: string, expected?: CanonTrace[]) {
  const ids = expected?.map(ref => ref.id) ?? [...new Set([...instructions.matchAll(/doc_id: ([0-9a-f-]{36})/gi)].map((match) => match[1]))];
  if (!ids.length) return "";
  const { data } = await createServiceSupabase().from("os_documents").select("id,title,current_version,content_md").in("id", ids).neq("status", "archived");
  if (expected?.some(ref => !data?.some(doc => String(doc.id) === ref.id && Number(doc.current_version) === ref.version)))
    throw new ApiError(409, "CANON_VERSION_CHANGED", "작업을 시작한 뒤 정본이 바뀌었어요. 최신 정본으로 다시 요청해 주세요.");
  let left = 160_000;
  return (data ?? []).map((doc) => {
    const text = String(doc.content_md ?? "").slice(0, Math.max(0, Math.min(40_000, left)));
    left -= text.length;
    return `=== [${doc.title}] (doc_id: ${doc.id}) ===\n${text}`;
  }).join("\n\n");
}

/** GPT may answer { result: … } as the card's submit line shows; the saves want the object inside. */
export const unwrap = (value: unknown) => value && typeof value === "object" && !Array.isArray(value) && "result" in value && Object.keys(value).length <= 4
  ? (value as { result: unknown }).result : value;

/** Takes the job, asks GPT (a second try with the OS's format problems), and completes or fails it like a staff AI would. */
export async function runGptJob(jobId: string, owner: Owner, tier: GptTier) {
  const agent = gptActor(owner);
  const claimed = await claimStaffJob(agent, jobId, true) as { task?: string; lease: string; instructions: string; documentRefs?: CanonTrace[] };
  const { model, effort } = GPT_TIERS[tier];
  let issues = "", lastText = "";
  try {
    // Image requests already contain their authorized product/reference snapshot. Never treat
    // a doc_id typed into the user's advertising brief as permission to read a service-role document.
    const docs = claimed.task === "image-creative" ? "" : await cardDocs(claimed.instructions, claimed.documentRefs);
    for (let attempt = 0; attempt < 2; attempt++) {
      if (claimed.task === "card") await cardJobPhase(agent, jobId, claimed.lease, "card_writing");
      const text = await generateContentText({ model, effort, maxTokens: 32_000, timeoutMs: 600_000, cachedPrefix: docs ? `${PREFACE}\n\n# 붙인 문서\n${docs}` : PREFACE,
        prompt: `# 작업 카드\n${claimed.instructions}${issues ? `\n\n## 지난 답에서 OS가 돌려준 고칠 점 (고쳐서 다시 답합니다)\n${issues}` : ""}` });
      if (claimed.task === "card") await cardJobPhase(agent, jobId, claimed.lease, "card_checking");
      lastText = text;
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
    await failStaffJob(agent, { action: "fail", jobId, lease: claimed.lease, reason: reason.slice(0, 1000) }, error instanceof ApiError && error.code === "GPT_FORMAT" ? { lastAnswer: lastText } : undefined).catch(() => undefined);
    throw error;
  }
}

/** The project's PD, or the person who acted when there is none. */
async function pdOf(project: YpProject, by: Owner): Promise<Owner> {
  const id = project.assigneeId || by.id;
  return { id, name: id === by.id ? by.name : await displayName(createServiceSupabase(), id, "담당자"), team: by.team };
}

/**
 * 업로드 뒤 저절로 (요청 11-25): once a longform is on YouTube, its 숏폼 5편 (롱폼에서 뽑기) and its SEO 칼럼 go on with nobody pressing a
 * button — the 칼럼 to public on MYIN, the 숏폼 to their previews — unless the PD turned it off on the upload step. Nothing already made is
 * made again; a GPT job that is still to come carries on from its completion (requestStaffJob auto).
 */
export function scheduleUploadFollowUps(project: YpProject, by: Owner) {
  after(async () => {
    const owner = await pdOf(project, by);
    const stages = await readStages(createServiceSupabase(), project);
    const gpt = Boolean(process.env.OPENAI_API_KEY?.trim());
    const start = async (task: "column" | "short-recycle") => {
      if (!gpt) return;
      const tier = await creditTier();
      const job = await requestStaffJob(gptActor(owner), staffJobRequestSchema.parse({ task, sourceId: project.id, ...(task === "column" ? { count: 1 } : {}) }), { tier }, true);
      if (job.status === "backlog") await runGptJob(job.id, owner, tier);
    };
    await Promise.all([
      stages.column.data.items.length ? publishColumnAfterUpload(project.id, owner) : start("column"),
      stages.shortTopics.data.recycle?.items.length ? makeRecycleAfterUpload(project.id, owner) : start("short-recycle"),
    ].map((step) => step.catch((error) => console.error(`upload follow-up skipped: ${project.id}: ${error instanceof Error ? error.message : error}`))));
  });
}

/** Only after this video's upload, with 업로드 뒤 저절로 on. */
async function followReady(projectId: string, owner: Owner) {
  const actor = gptActor(owner);
  const project = await getYoutubeProject(actor, projectId);
  const stages = await readStages(actor.supabase, project);
  return { actor, stages, ok: Boolean(stages.upload.data.run?.status === "done" && stages.upload.data.run.follow) };
}

/**
 * The 칼럼 to public on MYIN, as 「마이인에 임시 글로 올리기」 then 「공개하기」 would: the first column, when none was sent yet. An image place
 * nothing would fill keeps it back (요청: 비면 공개하지 않고 알리기) — the 칼럼 screen says which. The PD hears it either way. Never throws.
 */
export async function publishColumnAfterUpload(projectId: string, owner: Owner) {
  try {
    const { actor, stages, ok } = await followReady(projectId, owner);
    const item = stages.column.data.items[0];
    if (!ok || !item || stages.column.data.items.some((row) => row.myin)) return;
    const empty = columnEmptyPlaces(item.html, item.fills, { hero: Boolean(stages.make.data.thumbs?.A), video: Boolean(stages.upload.data.run?.videoUrl) });
    if (!empty.length) {
      const sent = await columnToMyin(actor, projectId, { item: item.id, action: "send", expectedVersion: stages.column.version });
      await columnToMyin(actor, projectId, { item: item.id, action: "publish", expectedVersion: sent.stage.version });
    }
    await notify([owner.id], "ai_result", projectId, `auto-column:${projectId}:${item.id}`);
  } catch (error) {
    console.error(`auto column skipped: ${projectId}: ${error instanceof Error ? error.message : error}`);
    await notify([owner.id], "ai_result", projectId, `auto-column-failed:${projectId}`).catch(() => undefined);
  }
}

/**
 * The picked stretches to 숏폼, as 「5편 모두 만들기」 would (each runs by itself to its preview and tells the PD there); none made yet. A
 * stretch the OS refuses (a title line too long) stays on 「롱폼에서 뽑기」 for the PD. Never throws.
 */
export async function makeRecycleAfterUpload(projectId: string, owner: Owner) {
  try {
    const { actor, stages, ok } = await followReady(projectId, owner);
    const items = stages.shortTopics.data.recycle?.items ?? [];
    if (!ok || items.some((item) => item.made)) return;
    for (const item of items) await makeShortFromRecycle(actor, projectId, { itemId: item.id, start: true })
      .catch((error) => console.error(`auto short skipped: ${projectId}/${item.id}: ${error instanceof Error ? error.message : error}`));
  } catch (error) { console.error(`auto shorts skipped: ${projectId}: ${error instanceof Error ? error.message : error}`); }
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
  // 업로드 자료 · SEO 칼럼 · 숏폼 주제 후보 belong to a longform only.
  if (!process.env.OPENAI_API_KEY?.trim() || !["live", "anim"].includes(project.yp.topic.type ?? "")) return;
  after(async () => {
    const service = createServiceSupabase();
    const owner = await pdOf(project, by);
    const [stages, tier] = await Promise.all([readStages(service, project), creditTier()]);
    const filled = { kit: Boolean(stages.upload.data.desc.trim()), column: stages.column.data.items.length > 0, "short-topics": stages.shortTopics.data.items.length > 0 };
    await Promise.all(GPT_AUTO_TASKS.filter((task) => !filled[task]).map(async (task) => {
      try {
        const input = staffJobRequestSchema.parse(task === "kit" ? { task, sourceId: project.id } : { task, sourceId: project.id, count: task === "column" ? 1 : 3 });
        // A 칼럼 that arrives after the upload is published by itself (업로드 뒤 저절로); before it, it waits for the upload.
        const job = await requestStaffJob(gptActor(owner), input, { tier }, task === "column");
        if (job.status === "backlog") await runGptJob(job.id, owner, tier);
      } catch (error) { console.error(`gpt draft ${task} skipped: ${project.id}: ${error instanceof Error ? error.message : error}`); }
    }));
  });
}

/**
 * 롱폼에서 나온 숏폼 (대표 11-21): its storyboard is GPT's straight away, for the person who made the 숏폼, so the five shorts reach their
 * preview with nobody waiting on a staff computer. The OS check (and the 렌더 전 관문 after it) is the only check before the preview.
 */
export async function requestGptStoryboard(sourceId: string, ownerId: string) {
  if (!process.env.OPENAI_API_KEY?.trim()) return null;
  const service = createServiceSupabase();
  const [name, tier] = await Promise.all([displayName(service, ownerId, "담당자"), creditTier()]);
  const owner = { id: ownerId, name, team: "" };
  const job = await requestStaffJob(gptActor(owner), staffJobRequestSchema.parse({ task: "storyboard", sourceId }), { tier });
  if (job.status === "backlog") scheduleGptJob(job.id, owner, tier);
  return job;
}
