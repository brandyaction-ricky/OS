import { randomUUID } from "node:crypto";
import { z } from "zod";
import { ApiError } from "@/lib/http";
import type { OsRecord } from "@/lib/record-types";
import type { RequestActor } from "./auth";
import { conflict, getYoutubeProject, notify, readFailed } from "./youtube-process";
import { readFinals, readStages } from "./youtube-process-stages";

// S6 최종 검수 feedback (지시서 6-3): one content_feedback record per item, under the project. Needs the M1 record type.
export interface YpFeedback {
  id: string; version: number; text: string; who: string; whoId: string; at: string;
  target: "video" | "A" | "B" | "C"; ver: number; t: number | null; range: [number, number] | null;
  kind: string; sug: string; reaction: boolean; status: "open" | "done" | "declined"; declinedWhy: string; fixedIn: number | null;
  replies: { by: string; text: string; at: string }[];
}
export const feedbackCreateSchema = z.object({
  target: z.enum(["video", "A", "B", "C"]), ver: z.number().int().positive(), t: z.number().min(0).max(86_400).nullable().default(null),
  range: z.tuple([z.number().min(0), z.number().min(0)]).nullable().default(null), text: z.string().trim().max(2000).default(""),
  kind: z.enum(["", "제목", "썸네일 문구", "이미지 연출", "기타"]).default(""), sug: z.string().trim().max(200).default(""), reaction: z.boolean().default(false),
}).strict().refine(value => value.reaction || value.text, { message: "피드백을 써 주세요." });
export const feedbackActionSchema = z.object({ itemId: z.string().uuid(), expectedVersion: z.number().int().positive(),
  action: z.enum(["resolve", "reopen", "decline", "reply"]), text: z.string().trim().max(1000).default("") }).strict();

const present = (row: OsRecord): YpFeedback => {
  const m = row.metadata as Record<string, unknown>;
  return { id: row.id, version: row.version, text: row.description, who: String(m.who ?? ""), whoId: row.created_by ?? "", at: row.created_at,
    target: (m.target as YpFeedback["target"]) ?? "video", ver: Number(m.ver) || 1, t: typeof m.t === "number" ? m.t : null, range: Array.isArray(m.range) ? m.range as [number, number] : null,
    kind: String(m.kind ?? ""), sug: String(m.sug ?? ""), reaction: m.reaction === true, status: (m.status as YpFeedback["status"]) ?? "open",
    declinedWhy: String(m.declinedWhy ?? ""), fixedIn: typeof m.fixedIn === "number" ? m.fixedIn : null, replies: Array.isArray(m.replies) ? m.replies as YpFeedback["replies"] : [] };
};

/** Long-form items in running order (a range by its start), thumbnails A → B → C, then by time written (4-7). */
export function sortFeedback(items: YpFeedback[]) {
  return [...items].sort((a, b) => a.target === "video" && b.target === "video"
    ? ((a.t ?? a.range?.[0] ?? 0) - (b.t ?? b.range?.[0] ?? 0)) || a.at.localeCompare(b.at)
    : a.target.localeCompare(b.target) || a.at.localeCompare(b.at));
}

export async function listFeedback(actor: RequestActor, id: string) {
  const project = await getYoutubeProject(actor, id);
  const { data, error } = await actor.supabase.from("os_records").select("*").eq("parent_id", project.id).eq("record_type", "content_feedback").is("archived_at", null).limit(500);
  if (error) throw readFailed();
  return sortFeedback((data ?? []).map(row => present(row as OsRecord)));
}

const notReady = () => new ApiError(503, "FEEDBACK_NOT_READY", "피드백 저장 기능을 준비하는 중이에요. (데이터베이스에 피드백 칸을 더하는 작업이 아직 적용되지 않았어요)");

export async function createFeedback(actor: RequestActor, id: string, input: z.infer<typeof feedbackCreateSchema>) {
  const project = await getYoutubeProject(actor, id);
  if (!["review", "upload"].includes(project.yp.stage)) throw new ApiError(409, "STAGE_LOCKED", "최종 검토 단계에서 피드백을 남겨요.");
  if (input.target === "video") {
    const stages = await readStages(actor.supabase, project);
    const latest = (await readFinals(actor.supabase, project.id, stages.make.data, project.yp.topic.type)).at(-1)?.v ?? 0;
    if (input.ver !== latest) throw new ApiError(409, "OLD_VERSION", `v${input.ver}은 이전 버전이라 보기만 해요. 피드백은 최신 v${latest}에 남겨요.`);
  }
  const { data, error } = await actor.supabase.from("os_records").insert({
    id: randomUUID(), record_type: "content_feedback", title: `${project.title} · 피드백`.slice(0, 240), description: input.text, status: "open", priority: "normal",
    parent_id: project.id, owner_id: actor.id, created_by: actor.id, updated_by: actor.id, team: actor.team, tags: ["유튜브", "피드백"],
    metadata: { projectId: project.id, feedbackKind: "item", stage: "review", who: actor.name, target: input.target, ver: input.ver, t: input.t, range: input.range,
      kind: input.kind, sug: input.sug, reaction: input.reaction, status: "open", replies: [] },
  }).select("*").single();
  if (error?.code === "23514") throw notReady();
  if (error || !data) throw new ApiError(400, "FEEDBACK_SAVE_FAILED", "피드백을 저장하지 못했습니다.");
  if (project.assigneeId && project.assigneeId !== actor.id && !input.reaction) await notify([project.assigneeId], "yt_feedback", data.id, `feedback:${data.id}`);
  return present(data as OsRecord);
}

/** ✓ 반영 · 다시 열기 · 반영 안 함(이유 필수, 남긴 사람에게 알림) · 답글. */
export async function actOnFeedback(actor: RequestActor, id: string, input: z.infer<typeof feedbackActionSchema>) {
  const project = await getYoutubeProject(actor, id);
  const { data: row, error } = await actor.supabase.from("os_records").select("*").eq("id", input.itemId).eq("parent_id", project.id).eq("record_type", "content_feedback").is("archived_at", null).maybeSingle();
  if (error) throw readFailed();
  if (!row) throw new ApiError(404, "FEEDBACK_NOT_FOUND", "피드백을 찾지 못했습니다.");
  if (row.version !== input.expectedVersion) throw conflict();
  const item = present(row as OsRecord);
  const m = row.metadata as Record<string, unknown>;
  const now = new Date().toISOString();
  let metadata: Record<string, unknown>;
  if (input.action === "reply") {
    if (!input.text) throw new ApiError(400, "REPLY_REQUIRED", "답글을 써 주세요.");
    metadata = { ...m, replies: [...item.replies, { by: actor.name, text: input.text, at: now }].slice(-50) };
  } else if (input.action === "decline") {
    if (!input.text) throw new ApiError(400, "REASON_REQUIRED", "반영하지 않는 이유를 한 줄 써 주세요.");
    metadata = { ...m, status: "declined", declinedWhy: input.text };
  } else {
    const stages = await readStages(actor.supabase, project);
    const latest = (await readFinals(actor.supabase, project.id, stages.make.data, project.yp.topic.type)).at(-1)?.v ?? null;
    metadata = { ...m, status: input.action === "resolve" ? "done" : "open", fixedIn: input.action === "resolve" && item.target === "video" ? latest : null };
  }
  const { data: saved, error: saveError } = await actor.supabase.from("os_records").update({ metadata, status: String(metadata.status ?? "open"), updated_by: actor.id })
    .eq("id", row.id).eq("version", row.version).is("archived_at", null).select("*").maybeSingle();
  if (saveError) throw new ApiError(400, "FEEDBACK_SAVE_FAILED", "피드백을 저장하지 못했습니다.");
  if (!saved) throw conflict();
  const author = row.created_by as string | null;
  if (author && author !== actor.id && (input.action === "decline" || input.action === "reply")) await notify([author], "yt_feedback", row.id, `feedback:${row.id}:${input.action}:${saved.version}`);
  return present(saved as OsRecord);
}
