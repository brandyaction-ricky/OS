import { randomUUID } from "node:crypto";
import { z } from "zod";
import { ApiError } from "@/lib/http";
import { IMAGE_CREATIVE_KIND } from "@/lib/image-creative/storage";
import { cancelImageRenders, IMAGE_TRASH_REASON } from "@/lib/image-creative/project-trash";
import { createServiceSupabase } from "@/lib/supabase/server";
import type { OsRecord } from "@/lib/record-types";
import type { RequestActor } from "./auth";
import { imageMeta } from "./image-creatives";

export const imageTrashActionSchema = z.object({action:z.enum(["trash","restore"]),version:z.number().int().positive()}).strict();
const notFound = () => new ApiError(404,"IMAGE_PROJECT_NOT_FOUND","이 프로젝트를 찾을 수 없어요.");
function owner(actor:RequestActor) {
  if (actor.type !== "user") throw new ApiError(403,"IMAGE_TRASH_USER_REQUIRED","로그인한 담당자가 프로젝트를 정리해 주세요.");
}
export async function listImageTrash(actor:RequestActor) {
  owner(actor);
  const {data,error}=await createServiceSupabase().from("os_records").select("id,title,version,archived_at")
    .eq("record_type","content_package").eq("metadata->>kind",IMAGE_CREATIVE_KIND).eq("owner_id",actor.ownerId)
    .not("archived_at","is",null).order("archived_at",{ascending:false}).limit(200);
  if(error) throw new ApiError(503,"IMAGE_TRASH_READ","휴지통을 불러오지 못했어요.");
  return (data??[]).map(row=>({id:row.id,title:row.title,version:row.version,archivedAt:row.archived_at}));
}
export async function actOnImageTrash(actor:RequestActor,id:string,input:z.infer<typeof imageTrashActionSchema>) {
  owner(actor);
  const service=createServiceSupabase();
  const {data,error}=await service.from("os_records").select("*").eq("id",id).eq("owner_id",actor.ownerId)
    .eq("record_type","content_package").eq("metadata->>kind",IMAGE_CREATIVE_KIND).maybeSingle();
  if(error) throw new ApiError(503,"IMAGE_TRASH_READ","프로젝트를 불러오지 못했어요.");
  if(!data) throw notFound();
  const record=data as OsRecord;
  if(record.version!==input.version) throw new ApiError(409,"IMAGE_VERSION_CONFLICT","다른 곳에서 바뀌었어요. 목록을 새로고침해 주세요.");
  const trash=input.action==="trash";
  if(trash===Boolean(record.archived_at)) throw new ApiError(409,"IMAGE_TRASH_STATE","프로젝트 상태가 바뀌었어요. 목록을 새로고침해 주세요.");
  // Capture this generation's jobs before archiving. A restore may immediately create another job.
  const pending=trash ? await service.from("os_records").select("id,version")
    .eq("parent_id",id).eq("owner_id",actor.ownerId).eq("record_type","ai_job")
    .eq("metadata->>kind","youtube_staff_ai_v1").eq("metadata->>task","image-creative")
    .in("status",["backlog","active"]).is("archived_at",null) : {data:[],error:null};
  if(pending.error) throw new ApiError(503,"IMAGE_TRASH_READ","진행 중인 작업을 확인하지 못했어요. 프로젝트는 그대로 유지됩니다.");
  const meta=imageMeta(record);
  const archivedAt=trash ? new Date().toISOString() : null;
  const next=trash ? {...meta,lifecycleRevision:randomUUID(),renders:cancelImageRenders(meta.renders),
    ...(meta.referenceRun?.status==="active" && {referenceRun:{...meta.referenceRun,status:"failed" as const,expiresAt:0,failure:IMAGE_TRASH_REASON}}),
    ...(meta.promptEditRun?.status==="active" && {promptEditRun:{...meta.promptEditRun,status:"failed" as const,expiresAt:0,failure:IMAGE_TRASH_REASON}})} : meta;
  let update=service.from("os_records").update({archived_at:archivedAt,metadata:next,updated_by:actor.ownerId})
    .eq("id",id).eq("owner_id",actor.ownerId).eq("record_type","content_package").eq("metadata->>kind",IMAGE_CREATIVE_KIND).eq("version",input.version);
  update=trash ? update.is("archived_at",null) : update.not("archived_at","is",null);
  const saved=await update.select("id,title,version,archived_at").maybeSingle();
  if(saved.error) throw new ApiError(503,"IMAGE_TRASH_SAVE","프로젝트 상태를 저장하지 못했어요.");
  if(!saved.data) throw new ApiError(409,"IMAGE_VERSION_CONFLICT","다른 곳에서 바뀌었어요. 목록을 새로고침해 주세요.");
  // The parent revision invalidates late completions even when this status cleanup loses a race.
  let jobsCancelled=true;
  if(trash) {
    for(const job of pending.data??[]) {
      const stopped=await service.from("os_records").update({status:"cancelled",updated_by:actor.ownerId})
        .eq("id",job.id).eq("version",job.version).eq("parent_id",id).eq("owner_id",actor.ownerId).eq("record_type","ai_job")
        .eq("metadata->>kind","youtube_staff_ai_v1").eq("metadata->>task","image-creative")
        .in("status",["backlog","active"]).is("archived_at",null).select("id").maybeSingle();
      if(stopped.error) jobsCancelled=false;
    }
  }
  return {project:{id:saved.data.id,title:saved.data.title,version:saved.data.version,archivedAt:saved.data.archived_at},jobsCancelled};
}
