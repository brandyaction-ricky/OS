import { randomUUID } from "node:crypto";
import { z } from "zod";
import { ApiError } from "@/lib/http";
import type { OsRecord } from "@/lib/record-types";
import type { RequestActor } from "./auth";
import { conflict, getYoutubeProject, notify, readFailed } from "./youtube-process";
import { readFinals, readStages } from "./youtube-process-stages";
import { appendOnly, applyFeedback, FeedbackRuleError, normalizeReplies, type FeedbackReply, type FeedbackState } from "@/lib/youtube-process/feedback";

// S6 최종 검수 feedback (지시서 6-3): one content_feedback record per item, under the project. Needs the M1 record type.
export interface YpFeedback {
  id: string; version: number; text: string; who: string; whoId: string; at: string;
  target: "video" | "A" | "B" | "C"; ver: number; t: number | null; range: [number, number] | null;
  kind: string; sug: string; reaction: boolean; status: "open" | "done" | "declined"; declinedWhy: string; fixedIn: number | null;
  replies: FeedbackReply[]; doneBy: string; doneAt: string; confirmedBy: string; confirmedAt: string; deleted: boolean; editedAt: string;
}
export const feedbackCreateSchema = z.object({
  target: z.enum(["video", "A", "B", "C"]), ver: z.number().int().positive(), t: z.number().min(0).max(86_400).nullable().default(null),
  range: z.tuple([z.number().min(0), z.number().min(0)]).nullable().default(null), text: z.string().trim().max(2000).default(""),
  kind: z.enum(["", "제목", "썸네일 문구", "이미지 연출", "기타"]).default(""), sug: z.string().trim().max(200).default(""), reaction: z.boolean().default(false),
}).strict().refine(value => value.reaction || value.text, { message: "피드백을 써 주세요." });
export const feedbackActionSchema = z.object({ itemId: z.string().uuid(), expectedVersion: z.number().int().positive(),
  action: z.enum(["resolve", "reopen", "decline", "reply", "confirm", "unconfirm", "edit", "delete", "reply_edit", "reply_delete"]),
  text: z.string().trim().max(2000).default(""), replyId: z.string().max(120).optional() }).strict();

const present = (row: OsRecord): YpFeedback => {
  const m = row.metadata as Record<string, unknown>;
  return { id: row.id, version: row.version, text: row.description, who: String(m.who ?? ""), whoId: row.created_by ?? "", at: row.created_at,
    target: (m.target as YpFeedback["target"]) ?? "video", ver: Number(m.ver) || 1, t: typeof m.t === "number" ? m.t : null, range: Array.isArray(m.range) ? m.range as [number, number] : null,
    kind: String(m.kind ?? ""), sug: String(m.sug ?? ""), reaction: m.reaction === true, status: (m.status as YpFeedback["status"]) ?? "open",
    declinedWhy: String(m.declinedWhy ?? ""), fixedIn: typeof m.fixedIn === "number" ? m.fixedIn : null, replies: normalizeReplies(m.replies),
    doneBy: String(m.doneBy ?? ""), doneAt: String(m.doneAt ?? ""), confirmedBy: String(m.confirmedBy ?? ""), confirmedAt: String(m.confirmedAt ?? ""), deleted: m.deleted === true, editedAt: String(m.editedAt ?? "") };
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

/**
 * ✓ 반영 · 다시 열기 · 반영 안 함 · 요청자 확인 · 답글 · 내 피드백/답글 고치기·지우기.
 * Status changes keep the version check (two people flipping one item must not overwrite each other). Replies,
 * confirmations and edits of one's own words apply to the latest saved row, so a list opened before someone else
 * ticked the item no longer loses the reply (개발 요청 8cb3c12e R02).
 */
export async function actOnFeedback(actor: RequestActor, id: string, input: z.infer<typeof feedbackActionSchema>) {
  const project = await getYoutubeProject(actor, id);
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const { data: row, error } = await actor.supabase.from("os_records").select("*").eq("id", input.itemId).eq("parent_id", project.id).eq("record_type", "content_feedback").is("archived_at", null).maybeSingle();
    if (error) throw readFailed();
    if (!row) throw new ApiError(404, "FEEDBACK_NOT_FOUND", "피드백을 찾지 못했습니다.");
    if (!appendOnly(input.action) && row.version !== input.expectedVersion) throw conflict();
    const item = present(row as OsRecord);
    const m = row.metadata as Record<string, unknown>;
    let latest: number | null = null;
    if (input.action === "resolve" && item.target === "video") {
      const stages = await readStages(actor.supabase, project);
      latest = (await readFinals(actor.supabase, project.id, stages.make.data, project.yp.topic.type)).at(-1)?.v ?? null;
    }
    const before: FeedbackState = { text: item.text, whoId: item.whoId, status: item.status, declinedWhy: item.declinedWhy, fixedIn: item.fixedIn, replies: item.replies,
      ...(item.doneBy ? { doneBy: item.doneBy, doneAt: item.doneAt } : {}), ...(item.confirmedBy ? { confirmedBy: item.confirmedBy, confirmedAt: item.confirmedAt } : {}),
      ...(item.deleted ? { deleted: true } : {}), ...(item.editedAt ? { editedAt: item.editedAt } : {}) };
    let after: FeedbackState;
    try { after = applyFeedback(before, { id: actor.id, name: actor.name, admin: actor.role === "admin" }, input, new Date().toISOString(), latest, item.target); }
    catch (reason) { if (reason instanceof FeedbackRuleError) throw new ApiError(reason.status, reason.code, reason.message); throw reason; }
    const { text, whoId: _whoId, ...fields } = after; void _whoId;
    const metadata = { ...m, doneBy: null, doneAt: null, confirmedBy: null, confirmedAt: null, deleted: null, editedAt: null, ...fields };
    const { data: saved, error: saveError } = await actor.supabase.from("os_records").update({ metadata, description: text, status: after.status, updated_by: actor.id })
      .eq("id", row.id).eq("version", row.version).is("archived_at", null).select("*").maybeSingle();
    if (saveError) throw new ApiError(400, "FEEDBACK_SAVE_FAILED", "피드백을 저장하지 못했습니다.");
    if (!saved) { if (appendOnly(input.action)) continue; throw conflict(); }
    const author = row.created_by as string | null;
    if (author && author !== actor.id && ["decline", "reply", "resolve"].includes(input.action)) await notify([author], "yt_feedback", row.id, `feedback:${row.id}:${input.action}:${saved.version}`);
    return present(saved as OsRecord);
  }
  throw conflict();
}
