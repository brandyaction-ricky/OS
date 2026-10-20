import { createHash } from "node:crypto";
import { ApiError } from "@/lib/http";
import type { OsRecord } from "@/lib/record-types";
import { checkManuscript } from "@/lib/youtube-script-check";
import { narrationFromMarkdown } from "@/lib/youtube-narration-document";
import { projectFromRecord, projectName } from "@/lib/youtube-process/project";
import { stageData, STAGE_RECORD, utmUrl, withScriptVersion, type YpStageKind, type YpStageData } from "@/lib/youtube-process/stages";
import type { RequestActor } from "./auth";
import type { readPipeline } from "./content-pipeline";
import { writeStage } from "./youtube-process-stages";

// The automation that already runs (staff AI ② 원고 · ⑦ 발행키트, ③ 마이인 v13) reading a 유튜브 공정 v1 project instead of the
// old pipeline approvals: the confirmed 기획안 stands in for gate 1, the 구성안 원고 for the approved script.
type Pipeline = Awaited<ReturnType<typeof readPipeline>>;
const digest = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");

/** The person behind an AI key, as the screens name them ('○○의 Claude'); the key's own name is not shown. */
async function displayName(supabase: RequestActor["supabase"], ownerId: string, fallback: string) {
  const { data } = await supabase.from("os_profiles").select("display_name").eq("id", ownerId).maybeSingle();
  return String(data?.display_name ?? "") || fallback;
}

export const isYoutubeV1 = (source: Pick<OsRecord, "metadata">) => source.metadata?.workflow === "youtube_v1";

/** The project and its step records out of the pipeline read (which already holds every child record). */
export function v1Stages(state: Pick<Pipeline, "source" | "records">) {
  const project = projectFromRecord({ ...state.source, owner_id: state.source.owner_id ?? "" });
  if (!project) throw new ApiError(404, "YOUTUBE_PROJECT_NOT_FOUND", "프로젝트를 찾지 못했습니다.");
  const pick = <K extends YpStageKind>(kind: K) => {
    const spec = STAGE_RECORD[kind];
    const record = state.records.filter(row => !row.archived_at && row.record_type === spec.recordType && row.metadata?.[spec.key] === spec.value)
      .sort((a, b) => b.created_at.localeCompare(a.created_at))[0];
    return { id: record?.id ?? null, version: record?.version ?? 0, data: stageData(kind, record?.metadata?.yp, project.yp.topic.type) as YpStageData[K] };
  };
  return { project, plan: pick("plan"), outline: pick("outline"), make: pick("make"), upload: pick("upload") };
}
/** The title the video goes out with: the A the 대표 confirmed, or the A changed on purpose in 제작 (S5). */
export function v1Title(stages: ReturnType<typeof v1Stages>) {
  return stages.make.data.aTitle || stages.plan.data.confirmed?.A?.title || projectName(stages.project);
}

// ── ③ 마이인 v13 voice: the 구성안 원고 ──
/** The automation input for a v1 project: the current 구성안 원고, once the project is in 제작 (or later). */
export function v1AutomationInput(state: Pipeline) {
  const stages = v1Stages(state);
  const outline = state.records.find(row => row.id === stages.outline.id) ?? null;
  const markdown = stages.outline.data.script;
  const scriptText = narrationFromMarkdown(markdown);
  const open = ["make", "review"].includes(stages.project.yp.stage);
  const ready = Boolean(open && outline && scriptText);
  const missing = !open ? ["구성안을 마치고 제작 단계로 넘어오기"] : !scriptText ? ["구성안 원고"] : [];
  return {
    state, scriptText: ready ? scriptText : null, title: v1Title(stages), thumbnailCopy: stages.plan.data.confirmed?.A?.thumb?.copy ?? "",
    plan: { format: "narrated_visual" as const, privacyStatus: "private" as const, judgmentMode: "advisory_only" as const, sourceId: stages.project.id,
      inputKey: ready ? digest(["yp-v1-voice", stages.project.id, digest(markdown)]) : null, currentStage: ready ? "ready_for_voice" as const : "needs_input" as const,
      missing, script: ready && outline ? { id: outline.id, version: outline.version } : null, packaging: null, kit: null },
  };
}

// ── ② 원고 by the staff member's own AI ──
export function assertV1ScriptInputs(state: Pipeline) {
  const { project, plan } = v1Stages(state);
  if (!["outline", "make", "review"].includes(project.yp.stage) || !plan.data.confirmed)
    throw new ApiError(409, "PIPELINE_APPROVAL_REQUIRED", "기획안 컨펌 OK 뒤에 구성안 원고를 내 AI에 보낼 수 있어요.");
  if (["upload", "done", "shorts"].includes(project.yp.stage)) throw new ApiError(409, "STAGE_LOCKED", "업로드 단계에서는 원고를 다시 쓰지 않아요.");
}
/** Changes when the confirmed 기획안 or the topic changes; a job for older inputs is closed. */
export function v1ScriptInputKey(state: Pipeline) {
  const { project, plan } = v1Stages(state);
  const { confirmed, opening, body, closing, note } = plan.data;
  return digest(["yp-v1-script", project.yp.topic, project.title, confirmed, opening, body, closing, note]);
}
/** What the job card hands the AI for a v1 project, in place of the pipeline's ① 기획 record. */
export function v1ScriptCardInputs(state: Pipeline, card: { targetMinutes: number; role: string; attachments?: string; targetChars: number }) {
  const { project, plan } = v1Stages(state);
  const confirmed = plan.data.confirmed;
  return {
    title: confirmed?.A?.title ?? projectName(project),
    inputs: {
      projectId: project.id, title: confirmed?.A?.title ?? "", thumbnailCopy: confirmed?.A?.thumb?.copy ?? "",
      otherTitles: [confirmed?.B?.title, confirmed?.C?.title].filter(Boolean), targetMinutes: card.targetMinutes, targetChars: card.targetChars, role: card.role, format: "원고형",
      topic: projectName(project), audience: project.yp.topic.target, references: project.yp.topic.refs.map(ref => ref.url),
      plan: { opening: plan.data.opening, body: plan.data.body, closing: plan.data.closing, note: [project.yp.topic.note, plan.data.note].filter(Boolean).join("\n") },
      staffAttachments: card.attachments ?? null,
    },
    planNote: "- plan은 대표가 컨펌한 기획안(제목 A · B · C, 오프닝 · 본론 · 클로징)이며 이것이 정본 §2의 '① 기획 승인본'입니다. 따로 열 문서는 없습니다. audience는 정밀 타겟입니다.",
  };
}
/** A submitted 원고 becomes the current 구성안 원고 (the previous one stays as a version). */
export async function saveV1Script(client: { supabase: RequestActor["supabase"]; id: string }, state: Pipeline, bundle: { manuscript: string; materials: string; axis: string; design: string; review: string; canonBundle: string; suggestions: string[] }, author: { model: string; jobId?: string; targetMinutes: number; name: string }) {
  const stages = v1Stages(state);
  const title = stages.plan.data.confirmed?.A?.title ?? projectName(stages.project);
  const check = checkManuscript(bundle.manuscript, { title, targetMinutes: author.targetMinutes });
  if (check.issues.length) throw new ApiError(422, "SCRIPT_FORMAT_INVALID", `원고 형식 검사(관문 1)에서 걸린 곳 ${check.issues.length}건: ${check.issues.join(" / ")}`);
  const now = new Date().toISOString();
  // The head comments (축 · 출처) stay with the AI notes; the editor gets the readable 원고.
  const md = bundle.manuscript.replace(/\r/g, "").split("\n").filter(line => !line.trim().startsWith("<!--")).join("\n").trim() + "\n";
  const by = await displayName(client.supabase, client.id, author.name);
  const outline = { ...withScriptVersion(stages.outline.data, md, by, now, "ai", author.model),
    ai: { jobId: author.jobId ?? "", model: author.model, at: now, by, materials: bundle.materials, axis: bundle.axis, design: bundle.design,
      review: bundle.review, canonBundle: bundle.canonBundle, suggestions: bundle.suggestions, head: bundle.manuscript.split("\n").filter(line => line.trim().startsWith("<!--")).join("\n") } };
  await writeStage(client.supabase, client.id, state.source.team ?? "", stages.project, "outline", stages.outline, outline);
  return { chars: check.chars, paragraphs: check.paragraphs.length, sections: check.sections };
}

// ── ⑦ 설명란 · 고정 댓글 (S7 3번) ──
export function assertV1KitInputs(state: Pipeline) {
  const { project } = v1Stages(state);
  if (project.yp.stage !== "upload" || project.yp.gates.review.state !== "ok") throw new ApiError(409, "PIPELINE_APPROVAL_REQUIRED", "최종 검수 컨펌 OK 뒤에 설명란을 내 AI에 보낼 수 있어요.");
}
/** The latest OS-made final for the subtitles, the UTM settings and the title: a job for other inputs is closed. */
export function v1KitInputKey(state: Pipeline, myinFinalId: string | null) {
  const stages = v1Stages(state);
  return digest(["yp-v1-kit", myinFinalId, stages.upload.data.srt?.path ?? null, stages.upload.data.utm, v1Title(stages)]);
}
export function v1KitCardInputs(state: Pipeline) {
  const stages = v1Stages(state);
  const { utm } = stages.upload.data;
  return {
    title: v1Title(stages), thumbnailCopy: stages.plan.data.confirmed?.A?.thumb?.copy ?? "", audience: stages.project.yp.topic.target,
    script: narrationFromMarkdown(stages.outline.data.script), srtPath: stages.upload.data.srt?.path ?? null,
    rules: `## 유튜브 공정 업로드 칸 규칙 (OS가 7줄로 점검합니다)
- description 구역 순서: 해시태그 5개 → ----- → ⬇️ 진단 CTA 한 줄 + 링크 → ----- → [타임라인] → ----- → [설명문 본문] 5줄 → ----- → [인용 및 출처] → ----- → [히든 태그](맨 마지막, 쉼표로).
- [타임라인]은 아래 자막 시각으로 00:00부터 3줄 이상, 줄마다 20자 안팎. 자막이 없으면 시각을 [시각]으로 둡니다. chapters는 빈 배열로 둡니다(타임라인이 설명란 안에 있음).
- 진단 CTA는 40자 이하, '무료'를 붙이지 않습니다(진단은 유료).
- 링크는 아래 두 개만 씁니다. 지어내지 않습니다. 진단 링크: ${utm.short || utmUrl(utm)} · 이어서 볼 영상: ${utm.next || "(없음 — 고정 댓글에 [이어서 볼 영상 링크]로 둡니다)"}
- 출처는 "- 수치·내용 / 종류 / 기관 (기준 시점, 발표일)". 확인하지 못한 것은 끝에 '불확실'.
- pinnedComment: "⬇️ 진단 CTA" 한 줄 + 진단 링크 + "이어서 보면 좋을 영상 보러가기" + 이어서 볼 영상 링크.
- tags는 [히든 태그]와 같은 값으로 둡니다. title은 아래 제목을 그대로 둡니다(OS가 컨펌된 제목을 씁니다).`,
  };
}
/** The AI draft goes into the empty (or untouched AI) description; a description a person edited keeps its text and gets the draft beside it (9-5). */
export async function saveV1Kit(supabase: RequestActor["supabase"], ownerId: string, ownerName: string, state: Pipeline, result: { description: string; pinnedComment: string; tags: string[] }, author: { model: string; jobId: string }) {
  const stages = v1Stages(state);
  const current = stages.upload.data;
  const untouched = !current.desc.trim() || (current.descBy && current.desc === current.descBy.draft);
  const descBy = { userId: ownerId, name: await displayName(supabase, ownerId, ownerName), model: author.model, jobId: author.jobId, at: new Date().toISOString(), draft: result.description };
  const upload = untouched
    ? { ...current, desc: result.description, pinned: result.pinnedComment || current.pinned, hiddenTags: result.tags, descBy }
    : { ...current, descBy, pinnedDraft: result.pinnedComment };
  await writeStage(supabase, ownerId, state.source.team ?? "", stages.project, "upload", stages.upload, upload);
  return { replaced: Boolean(untouched) };
}

