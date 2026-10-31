import { randomUUID } from "node:crypto";
import { z } from "zod";
import { ApiError } from "@/lib/http";
import { createServiceSupabase } from "@/lib/supabase/server";
import { rankAds, type AdHistoryRow, type AdResult } from "@/lib/youtube-process/ad-results";
import { projectFromRecord, projectName } from "@/lib/youtube-process/project";
import type { RequestActor } from "./auth";
import { conflict, getYoutubeProject } from "./youtube-process";
import { shortJobInputs } from "./youtube-process-short";
import { readStages, writeStage } from "./youtube-process-stages";

// 광고 성과 1단계 (로건 QA 10/30): an ad's numbers are kept on its 업로드 (내보내기) step record, any time after it was made.
const count = z.number().min(0).max(1e12);
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
export const adResultSchema = z.object({
  expectedVersion: z.number().int().min(0), remove: z.string().trim().max(40).optional(),
  entry: z.object({ id: z.string().trim().max(40).optional(), from: day, to: day, spend: count, impressions: count, clicks: count, plays3s: count, purchases: count, revenue: count,
    note: z.string().trim().max(300).default("") }).strict().optional(),
}).strict();

export async function saveAdResult(actor: RequestActor, id: string, input: z.infer<typeof adResultSchema>) {
  const project = await getYoutubeProject(actor, id);
  if (project.yp.topic.type !== "short" || project.yp.topic.purpose !== "ad") throw new ApiError(409, "NOT_AN_AD", "광고 숏폼에서만 광고 성과를 적어요.");
  const stages = await readStages(actor.supabase, project);
  if (stages.upload.version !== input.expectedVersion) throw conflict();
  let ads = (stages.upload.data.ads ?? []).filter(row => row.id !== input.remove);
  if (input.entry) {
    if (input.entry.to < input.entry.from) throw new ApiError(400, "AD_PERIOD", "끝난 날이 시작한 날보다 앞서요.");
    // What the ad said, as it stands when its numbers come in: the picked 구매 이유's first line and the confirmed 헤드 카피.
    const { brief } = await shortJobInputs(createServiceSupabase(), project);
    const script = stages.shortScript.data;
    const row: AdResult = { ...input.entry, id: input.entry.id || randomUUID().slice(0, 8), at: new Date().toISOString(), by: actor.name,
      appeal: brief.appeal.split("\n")[0].trim().slice(0, 120), headCopy: (script.confirmed?.headCopy || script.headCopy || "").slice(0, 120) };
    ads = ads.some(item => item.id === row.id) ? ads.map(item => item.id === row.id ? row : item) : [...ads, row].slice(-20);
  }
  const saved = await writeStage(actor.supabase, actor.id, actor.team, project, "upload", stages.upload, { ...stages.upload.data, ads });
  return { ads, version: saved.version };
}

/** Every ad with numbers, best return first: what the 광고 주제 찾기 shows and the next ad's AI reads. */
export async function adHistory(supabase: RequestActor["supabase"]): Promise<AdHistoryRow[]> {
  const { data, error } = await supabase.from("os_records").select("parent_id,ads:metadata->yp->ads").eq("record_type", "content_package")
    .eq("metadata->>packageKind", "yp_upload").not("metadata->yp->ads", "is", null).is("archived_at", null).limit(300);
  if (error) throw new ApiError(503, "AD_HISTORY_READ_FAILED", "지난 광고 성과를 읽지 못했어요.");
  const rows = (data ?? []).filter(row => Array.isArray(row.ads) && row.ads.length) as unknown as { parent_id: string; ads: AdResult[] }[];
  if (!rows.length) return [];
  const { data: projects } = await supabase.from("os_records").select("id,version,title,assignee_id,owner_id,updated_at,metadata").in("id", rows.map(row => row.parent_id)).is("archived_at", null);
  const titles = new Map((projects ?? []).map(record => { const project = projectFromRecord(record); return [record.id as string, project ? projectName(project) : String(record.title)]; }));
  return rankAds(rows.filter(row => titles.has(row.parent_id)).flatMap(row => row.ads.map(result => ({ projectId: row.parent_id, title: titles.get(row.parent_id)!, result }))));
}
