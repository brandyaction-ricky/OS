import { randomUUID } from "node:crypto";
import { z } from "zod";
import { ApiError } from "@/lib/http";
import type { OsRecord } from "@/lib/record-types";
import type { RequestActor } from "./auth";
import { conflict, getYoutubeProject, notify, readFailed } from "./youtube-process";
import { readFinals, readStages } from "./youtube-process-stages";
import { appendOnly, applyFeedback, cleanMarks, FEEDBACK_FILE_MAX, FEEDBACK_FILE_TYPES, FEEDBACK_FILES_PER_ITEM, feedbackFilePath, FeedbackRuleError, mentionedIds, normalizeReplies, replyRecipients, type FeedbackFile, type FeedbackMark, type FeedbackReply, type FeedbackState } from "@/lib/youtube-process/feedback";
import { createServiceSupabase } from "@/lib/supabase/server";

// S6 최종 검수 feedback (지시서 6-3): one content_feedback record per item, under the project. Needs the M1 record type.
export interface YpFeedback {
  id: string; version: number; text: string; who: string; whoId: string; at: string;
  target: "video" | "A" | "B" | "C"; ver: number; t: number | null; range: [number, number] | null;
  kind: string; sug: string; reaction: boolean; status: "open" | "done" | "declined"; declinedWhy: string; fixedIn: number | null;
  replies: FeedbackReply[]; doneBy: string; doneAt: string; confirmedBy: string; confirmedAt: string; deleted: boolean; editedAt: string;
  marks: FeedbackMark[]; files: FeedbackFile[];
}
export const feedbackCreateSchema = z.object({
  target: z.enum(["video", "A", "B", "C"]), ver: z.number().int().positive(), t: z.number().min(0).max(86_400).nullable().default(null),
  range: z.tuple([z.number().min(0), z.number().min(0)]).nullable().default(null), text: z.string().trim().max(2000).default(""),
  kind: z.enum(["", "제목", "썸네일 문구", "이미지 연출", "기타", "알림"]).default(""), sug: z.string().trim().max(200).default(""), reaction: z.boolean().default(false),
  marks: z.array(z.unknown()).max(20).default([]),
  files: z.array(z.object({ path: z.string().max(200), name: z.string().trim().min(1).max(160), mime: z.string().max(60), size: z.number().int().positive().max(FEEDBACK_FILE_MAX) }).strict()).max(FEEDBACK_FILES_PER_ITEM).default([]),
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
    doneBy: String(m.doneBy ?? ""), doneAt: String(m.doneAt ?? ""), confirmedBy: String(m.confirmedBy ?? ""), confirmedAt: String(m.confirmedAt ?? ""), deleted: m.deleted === true, editedAt: String(m.editedAt ?? ""),
    marks: cleanMarks(m.marks), files: Array.isArray(m.files) ? (m.files as FeedbackFile[]) : [] };
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
    // N07: each version can be reviewed (요청 8cb3c12e); only a version that exists is accepted.
    if (input.ver < 1 || input.ver > latest) throw new ApiError(409, "NO_SUCH_VERSION", `v${input.ver} 영상이 없어요. 최신은 v${latest}이에요.`);
  }
  const files = input.files.filter(file => feedbackFilePath(project.id).test(file.path) && FEEDBACK_FILE_TYPES[file.mime]);
  if (files.length !== input.files.length) throw new ApiError(400, "FEEDBACK_FILE_INVALID", "첨부 파일을 다시 올려 주세요.");
  const { data, error } = await actor.supabase.from("os_records").insert({
    id: randomUUID(), record_type: "content_feedback", title: `${project.title} · 피드백`.slice(0, 240), description: input.text, status: "open", priority: "normal",
    parent_id: project.id, owner_id: actor.id, created_by: actor.id, updated_by: actor.id, team: actor.team, tags: ["유튜브", "피드백"],
    metadata: { projectId: project.id, feedbackKind: "item", stage: "review", who: actor.name, target: input.target, ver: input.ver, t: input.t, range: input.range,
      kind: input.kind, sug: input.sug, reaction: input.reaction, status: "open", replies: [], marks: cleanMarks(input.marks), files },
  }).select("*").single();
  if (error?.code === "23514") throw notReady();
  if (error || !data) throw new ApiError(400, "FEEDBACK_SAVE_FAILED", "피드백을 저장하지 못했습니다.");
  // N03: the PD hears about every new item; anyone @mentioned hears too.
  const mentioned = input.text.includes("@") ? mentionedIds(input.text, await activeMembers()) : [];
  const recipients = [...(project.assigneeId && !input.reaction ? [project.assigneeId] : []), ...mentioned].filter(id => id !== actor.id);
  if (recipients.length) await notify(recipients, "yt_feedback", data.id, `feedback:${data.id}`);
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
    // N03: a reply reaches the author, earlier repliers and anyone @mentioned; a decision reaches the author.
    const author = row.created_by as string | null;
    const recipients = input.action === "reply" ? replyRecipients(item, input.text, input.text.includes("@") ? await activeMembers() : [], actor.id)
      : author && author !== actor.id && ["decline", "resolve"].includes(input.action) ? [author] : [];
    if (recipients.length) await notify(recipients, "yt_feedback", row.id, `feedback:${row.id}:${input.action}:${saved.version}`);
    return present(saved as OsRecord);
  }
  throw conflict();
}

async function activeMembers() {
  const { data } = await createServiceSupabase().from("os_profiles").select("id,display_name").eq("is_active", true);
  return (data ?? []).map(row => ({ id: row.id as string, name: String(row.display_name ?? "") }));
}

// N06: reference images and PDFs for one comment, kept privately under the project in the content media bucket.
const FEEDBACK_BUCKET = "os-content-media";
export const feedbackFileSchema = z.object({ fileName: z.string().trim().min(1).max(160), mimeType: z.string().max(60), fileSize: z.number().int().positive().max(FEEDBACK_FILE_MAX) }).strict()
  .refine(value => Boolean(FEEDBACK_FILE_TYPES[value.mimeType]), { message: "이미지(jpg·png·webp·gif)나 PDF만 올릴 수 있어요." });

export async function signFeedbackFile(actor: RequestActor, id: string, input: z.infer<typeof feedbackFileSchema>) {
  const project = await getYoutubeProject(actor, id);
  const path = `feedback/${project.id}/${Date.now()}-${randomUUID()}.${FEEDBACK_FILE_TYPES[input.mimeType]}`;
  const { data, error } = await createServiceSupabase().storage.from(FEEDBACK_BUCKET).createSignedUploadUrl(path);
  if (error || !data) throw new ApiError(400, "FEEDBACK_FILE_SIGN_FAILED", "첨부 파일을 올릴 준비를 하지 못했어요.");
  return { path, token: data.token, mimeType: input.mimeType };
}

export async function feedbackFileUrl(actor: RequestActor, id: string, path: string) {
  const project = await getYoutubeProject(actor, id);
  if (!feedbackFilePath(project.id).test(path)) throw new ApiError(400, "FEEDBACK_FILE_INVALID", "첨부 파일 주소가 올바르지 않아요.");
  const { data, error } = await createServiceSupabase().storage.from(FEEDBACK_BUCKET).createSignedUrl(path, 3_600);
  if (error || !data) throw new ApiError(404, "FEEDBACK_FILE_NOT_FOUND", "첨부 파일을 찾지 못했어요.");
  return data.signedUrl;
}
