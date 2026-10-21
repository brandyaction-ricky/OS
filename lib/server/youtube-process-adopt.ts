import { ApiError } from "@/lib/http";
import { pickedPlanningCandidate, pipelineArtifacts } from "@/lib/content-pipeline";
import { contentOrigin } from "@/lib/content-origin";
import type { OsRecord } from "@/lib/record-types";
import { newProjectMeta, projectFromRecord, type YpGateInfo, type YpMeta, type YpProject, type YpStage } from "@/lib/youtube-process/project";
import { confirmPlan, emptyStage, hiddenTagsOf, withScriptVersion, type YpPlan } from "@/lib/youtube-process/stages";
import type { RequestActor } from "./auth";
import { readPipeline } from "./content-pipeline";
import { readFailed } from "./youtube-process";
import { writeStage } from "./youtube-process-stages";

// Videos started on the earlier 8-step screens continue in 유튜브 공정 v1 (owner request 2026-10-21: one flow, no separate
// '기존 화면'). Moving one keeps every old record; the topic gains the v1 project fields and its steps are filled from what exists.
const text = (value: unknown) => typeof value === "string" ? value.trim() : "";
const list = (value: unknown) => Array.isArray(value) ? value as Record<string, unknown>[] : [];
const result = (record: OsRecord | null) => (record?.metadata.result && typeof record.metadata.result === "object" ? record.metadata.result : {}) as Record<string, unknown>;

export interface LegacyTopic { id: string; title: string; updatedAt: string; step: string; assigneeId: string | null }

/** Earlier-flow videos still open: our own topics with the content pipeline started and no v1 project yet. */
export async function listLegacyTopics(actor: RequestActor): Promise<LegacyTopic[]> {
  const { data, error } = await actor.supabase.from("os_records").select("id,title,updated_at,assignee_id,owner_id,metadata,stage,status")
    .eq("record_type", "content_topic").eq("metadata->>pipelineEnabled", "true").is("archived_at", null).order("updated_at", { ascending: false }).limit(100);
  if (error) throw readFailed();
  return (data ?? []).filter(row => row.metadata?.workflow !== "youtube_v1" && contentOrigin(row as OsRecord) === "own" && !["done", "published", "cancelled"].includes(String(row.status)))
    .map(row => ({ id: row.id, title: row.title, updatedAt: row.updated_at, assigneeId: row.assignee_id ?? null, step: String(row.stage || "진행 중") }));
}

const passed = (at: string, by: string): YpGateInfo => ({ state: "ok", round: 1, decidedAt: at, decidedBy: by, memo: "이전 화면에서 진행된 단계" });

/** What the earlier flow already produced, as v1 steps; the stage is the furthest one the old records support. */
function legacyShape(state: Awaited<ReturnType<typeof readPipeline>>, actor: RequestActor, now: string) {
  const { source, records, approved } = state;
  const artifacts = pipelineArtifacts(records);
  const planning = pickedPlanningCandidate(artifacts.research);
  const packaging = result(artifacts.packaging);
  const titles = [...list(packaging.titles).filter(row => row.picked === true), ...list(packaging.titles).filter(row => row.picked !== true)].map(row => text(row.text)).filter(Boolean);
  if (!titles.length) titles.push(text(planning?.title) || source.title);
  const copies = [...list(packaging.copies).filter(row => row.picked === true), ...list(packaging.copies).filter(row => row.picked !== true)].map(row => text(row.text)).filter(Boolean);
  if (!copies.length && text(planning?.thumbnailCopy)) copies.push(text(planning?.thumbnailCopy));
  const plan: YpPlan = {
    ...emptyStage("plan", "anim"),
    titles: titles.slice(0, 6).map((title, index) => ({ id: `legacy-t${index}`, text: title })),
    thumbs: (copies.length ? copies : [""]).slice(0, 4).map((copy, index) => ({ id: `legacy-h${index}`, mode: "text" as const, copy })),
    opening: text(source.metadata.coreMessage) || "(이전 화면 기획 — 본론 참고)", body: [text(planning?.narrative), text(result(artifacts.research).summary)].filter(Boolean).join("\n\n"),
    closing: text(planning?.cta), note: [text(source.metadata.evidence), text(source.metadata.experience)].filter(Boolean).join("\n").slice(0, 2000),
  };
  if (!plan.closing) plan.closing = "(이전 화면 기획에 따로 없음)";
  const script = artifacts.script;
  const manuscript = text(script?.metadata.manuscript) || text(script?.description);
  const outline = manuscript ? withScriptVersion({ ...emptyStage("outline", "anim"), spec: { ...emptyStage("outline", "anim").spec, runtimeMin: Number(script?.metadata.targetMinutes) || null } },
    manuscript.split("\n").filter(line => !line.trim().startsWith("<!--")).join("\n").trim() + "\n", "이전 화면", now, "manual") : null;
  const kit = result(artifacts.kit);
  const youtube = artifacts.kit?.metadata.youtubeUpload as { videoId?: string; videoUrl?: string; uploadedAt?: string } | undefined;
  const chapters = Array.isArray(kit.chapters) ? kit.chapters.map(String) : [];
  const desc = text(kit.description) && chapters.length && !text(kit.description).includes("00:00") ? `${text(kit.description)}\n\n[타임라인]\n${chapters.join("\n")}` : text(kit.description);
  const upload = desc || youtube?.videoId ? { ...emptyStage("upload", "anim"), desc, pinned: text(kit.pinnedComment), hiddenTags: Array.isArray(kit.tags) ? kit.tags.map(String) : hiddenTagsOf(desc),
    run: youtube?.videoId ? { at: youtube.uploadedAt ?? now, by: "이전 화면", status: "done" as const, videoId: youtube.videoId, videoUrl: youtube.videoUrl } : null } : null;
  const hasRun = records.some(row => row.record_type === "ai_job" && row.metadata.kind === "youtube_myin_v13");
  const stage: YpStage = youtube?.videoId ? "upload" : approved[2] ? "upload" : artifacts.myin ? "review" : hasRun || (manuscript && approved[1]) ? "make" : manuscript || approved[0] ? "outline" : "draft";
  const at = (gate: "draft" | "review") => gate === "draft" ? !["topic", "draft"].includes(stage) : stage === "upload";
  const meta = newProjectMeta({ type: "anim", target: text(source.metadata.audience), note: text(source.metadata.coreMessage).slice(0, 2000), refs: [] }, now);
  const yp: YpMeta & { adoptedFrom?: { at: string; by: string } } = { ...meta.yp, stage, adoptedFrom: { at: now, by: actor.id },
    gates: { topic: passed(now, actor.id), draft: at("draft") ? passed(now, actor.id) : { state: "none", round: 0 }, review: at("review") ? passed(now, actor.id) : { state: "none", round: 0 } } };
  if (at("draft")) plan.confirmed = confirmPlan(plan, now);
  return { yp, plan, outline, upload };
}

/** [새 화면으로 옮기기]: the topic becomes a v1 project on the step it had reached; nothing old is removed. */
export async function adoptLegacyTopic(actor: RequestActor, id: string): Promise<YpProject> {
  const state = await readPipeline(actor, id);
  const source = state.source;
  if (source.metadata.workflow === "youtube_v1") return projectFromRecord({ ...source, owner_id: source.owner_id ?? "" })!;
  if (source.metadata.pipelineEnabled !== true) throw new ApiError(409, "NOT_LEGACY_VIDEO", "이전 화면에서 진행하던 영상이 아니에요.");
  const now = new Date().toISOString();
  const { yp, plan, outline, upload } = legacyShape(state, actor, now);
  const { data, error } = await actor.supabase.from("os_records").update({ metadata: { ...source.metadata, workflow: "youtube_v1", yp }, updated_by: actor.id, assignee_id: source.assignee_id ?? actor.id })
    .eq("id", source.id).eq("version", source.version).is("archived_at", null).select("id,version,title,assignee_id,owner_id,updated_at,metadata").maybeSingle();
  if (error) throw new ApiError(400, "ADOPT_FAILED", "새 화면으로 옮기지 못했어요.");
  if (!data) throw new ApiError(409, "RECORD_VERSION_CONFLICT", "다른 사람이 먼저 고쳤어요. 새로 불러와 주세요.");
  const project = projectFromRecord(data)!;
  const team = source.team ?? actor.team;
  await writeStage(actor.supabase, actor.id, team, project, "plan", { id: null, version: 0 }, plan);
  if (outline) await writeStage(actor.supabase, actor.id, team, project, "outline", { id: null, version: 0 }, outline);
  if (upload) await writeStage(actor.supabase, actor.id, team, project, "upload", { id: null, version: 0 }, upload);
  return project;
}
