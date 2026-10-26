import { z } from "zod";
import { ApiError } from "@/lib/http";
import { createServiceSupabase } from "@/lib/supabase/server";
import { mayTrash, projectFromRecord, trashDaysLeft, type YpTrash, type YpTrashed } from "@/lib/youtube-process/project";
import type { RequestActor } from "./auth";
import { conflict } from "./youtube-process";
import { STAFF_AI_JOB_KIND } from "./youtube-ai-jobs";

// 내 영상 휴지통 (staff request 2026-10-26, owner: 「관리자가 직접 영구 삭제」). 휴지통 = archived_at; the row and its history stay
// (os_record_events keeps every record), so 영구 삭제 removes the video's files and hides it for good, leaving who · when · why.
const COLUMNS = "id,version,title,assignee_id,owner_id,updated_at,metadata,archived_at";
type Row = { id: string; version: number; title: string; assignee_id: string | null; owner_id: string; updated_at: string; archived_at: string | null; metadata: Record<string, unknown> };
type StoredTrash = YpTrash & { purged?: { at: string; by: string; name: string; reason: string; files: number } };
// Where a video's files live: the project's own folder, and one folder per v13 run · render (owner/project/run) in each media bucket.
const RUN_BUCKETS = ["os-youtube-voice", "os-youtube-voice-timing", "os-youtube-character", "os-content-media", "os-youtube-video"];
const PROJECT_BUCKET = "os-content-media";

export const trashActionSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("trash"), expectedVersion: z.number().int().positive(), reason: z.string().trim().max(300).default("") }).strict(),
  z.object({ action: z.literal("restore") }).strict(),
  z.object({ action: z.literal("purge"), reason: z.string().trim().min(1).max(300), confirm: z.literal(true) }).strict(),
]);

const service = () => createServiceSupabase();
const notFound = () => new ApiError(404, "YOUTUBE_PROJECT_NOT_FOUND", "프로젝트를 찾지 못했습니다.");

async function readRow(id: string) {
  const { data, error } = await service().from("os_records").select(COLUMNS).eq("id", id).eq("record_type", "content_topic").eq("metadata->>workflow", "youtube_v1").maybeSingle();
  if (error) throw new ApiError(503, "YOUTUBE_PROJECT_READ_FAILED", "프로젝트를 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.");
  const row = data as Row | null;
  const project = row && projectFromRecord(row);
  if (!row || !project) throw notFound();
  return { row, project, trash: row.metadata.trash as StoredTrash | undefined };
}

/** Every file under a folder, two levels down (storage lists one folder at a time). */
async function filesUnder(bucket: string, prefix: string, depth = 2): Promise<string[]> {
  const { data, error } = await service().storage.from(bucket).list(prefix, { limit: 1000 });
  if (error) throw new ApiError(503, "TRASH_FILES_READ_FAILED", "영상 파일을 확인하지 못했어요. 잠시 후 다시 눌러 주세요.");
  const found: string[] = [];
  for (const item of data ?? []) {
    const path = `${prefix}/${item.name}`;
    if (item.id) found.push(path); else if (depth > 0) found.push(...await filesUnder(bucket, path, depth - 1));
  }
  return found;
}

export async function listYoutubeTrash(actor: RequestActor): Promise<(YpTrashed & { canManage: boolean })[]> {
  const { data, error } = await service().from("os_records").select(COLUMNS).eq("record_type", "content_topic").eq("metadata->>workflow", "youtube_v1")
    .not("archived_at", "is", null).order("archived_at", { ascending: false }).limit(200);
  if (error) throw new ApiError(503, "YOUTUBE_PROJECT_READ_FAILED", "휴지통을 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.");
  return ((data ?? []) as Row[]).flatMap(row => {
    const project = projectFromRecord(row);
    const trash = row.metadata.trash as StoredTrash | undefined;
    if (!project || !trash || trash.purged) return [];
    const { purged, ...shown } = trash;
    void purged;
    return [{ project, trash: shown, canManage: mayTrash(project, actor.ownerId, actor.role === "admin") }];
  });
}

export async function actOnYoutubeTrash(actor: RequestActor, id: string, input: z.infer<typeof trashActionSchema>) {
  const { row, project, trash } = await readRow(id);
  const now = new Date().toISOString();
  const admin = actor.role === "admin";
  if (input.action === "trash") {
    if (row.archived_at) throw new ApiError(409, "ALREADY_TRASHED", "이미 휴지통에 있어요.");
    if (!mayTrash(project, actor.ownerId, admin)) throw new ApiError(403, "TRASH_DENIED", "만든 사람 · 담당 PD · 관리자만 지울 수 있어요.");
    if (row.version !== input.expectedVersion) throw conflict();
    const stored: StoredTrash = { at: now, by: actor.ownerId, name: actor.name, reason: input.reason, stage: project.yp.stage };
    const { data, error } = await service().from("os_records").update({ archived_at: now, metadata: { ...row.metadata, trash: stored }, updated_by: actor.id })
      .eq("id", id).eq("version", row.version).is("archived_at", null).select("id").maybeSingle();
    if (error) throw new ApiError(400, "TRASH_FAILED", "휴지통으로 옮기지 못했어요.");
    if (!data) throw conflict();
    // Waiting staff-AI jobs for it close, so nobody's AI picks up a trashed video.
    await service().from("os_records").update({ status: "cancelled", updated_by: actor.id }).eq("parent_id", id).eq("record_type", "ai_job")
      .eq("metadata->>kind", STAFF_AI_JOB_KIND).eq("status", "backlog");
    return { trashed: true };
  }
  if (!row.archived_at || !trash || trash.purged) throw new ApiError(404, "NOT_IN_TRASH", "휴지통에 없는 영상이에요.");
  if (input.action === "restore") {
    if (!mayTrash(project, actor.ownerId, admin)) throw new ApiError(403, "RESTORE_DENIED", "만든 사람 · 담당 PD · 관리자만 복구할 수 있어요.");
    const metadata = { ...row.metadata };
    delete metadata.trash;
    const { data, error } = await service().from("os_records").update({ archived_at: null, metadata, updated_by: actor.id })
      .eq("id", id).eq("version", row.version).select("id").maybeSingle();
    if (error) throw new ApiError(400, "RESTORE_FAILED", "복구하지 못했어요.");
    if (!data) throw conflict();
    return { restored: true };
  }
  if (!admin) throw new ApiError(403, "PURGE_DENIED", "영구 삭제는 관리자만 할 수 있어요.");
  const left = trashDaysLeft(trash.at);
  if (left > 0) throw new ApiError(409, "PURGE_TOO_EARLY", `휴지통에 넣은 지 30일이 지나야 영구 삭제할 수 있어요. ${left}일 남았어요.`);
  const { data: runs, error: runError } = await service().from("os_records").select("id,owner_id").eq("parent_id", id).eq("record_type", "ai_job");
  if (runError) throw new ApiError(503, "TRASH_FILES_READ_FAILED", "영상 파일을 확인하지 못했어요. 잠시 후 다시 눌러 주세요.");
  const targets: { bucket: string; paths: string[] }[] = [{ bucket: PROJECT_BUCKET, paths: await filesUnder(PROJECT_BUCKET, `youtube/${id}`) }];
  for (const bucket of RUN_BUCKETS) {
    const paths = (await Promise.all((runs ?? []).map(run => filesUnder(bucket, `${run.owner_id}/${id}/${run.id}`, 1)))).flat();
    if (paths.length) targets.push({ bucket, paths });
  }
  let files = 0;
  for (const { bucket, paths } of targets) for (let at = 0; at < paths.length; at += 100) {
    const { error } = await service().storage.from(bucket).remove(paths.slice(at, at + 100));
    if (error) throw new ApiError(503, "PURGE_FILES_FAILED", `파일을 ${files}개 지운 뒤 멈췄어요. 다시 누르면 남은 파일부터 지워요.`);
    files += Math.min(100, paths.length - at);
  }
  const stored: StoredTrash = { ...trash, purged: { at: now, by: actor.ownerId, name: actor.name, reason: input.reason, files } };
  const { error } = await service().from("os_records").update({ metadata: { ...row.metadata, trash: stored }, updated_by: actor.id }).eq("id", id).eq("version", row.version);
  if (error) throw new ApiError(400, "PURGE_FAILED", "파일은 지웠지만 기록을 남기지 못했어요. 다시 눌러 주세요.");
  return { purged: true, files };
}
