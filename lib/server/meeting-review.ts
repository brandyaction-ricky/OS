import { ApiError } from "@/lib/http";
import { validWorkDate } from "@/lib/task-management";
import type { RequestActor } from "./auth";
/** Additional contract only for explicitly reviewed meeting tasks; legacy writes stay unchanged. */
export async function assertReviewedMeetingTask(actor:RequestActor,input:Record<string,unknown>,current?:Record<string,unknown>) {
 const metadata=input.metadata as Record<string,unknown>|undefined;
 if(metadata?.extractionReviewed!==true||(input.recordType??current?.record_type)!=="task")return;
 const assignee=input.assigneeId!==undefined?input.assigneeId:current?.assignee_id;
 const due=input.dueDate!==undefined?input.dueDate:current?.due_date;
 const parent=metadata.meetingId || (input.parentId!==undefined?input.parentId:current?.parent_id);
 if(typeof assignee!=="string"||typeof due!=="string"||!validWorkDate(due)||typeof parent!=="string")throw new ApiError(400,"MEETING_TASK_REVIEW_REQUIRED","검수한 업무의 담당자·기한·회의 연결을 확인해 주세요.");
 const [member,meeting]=await Promise.all([
  actor.supabase.from("os_profiles").select("id").eq("id",assignee).eq("is_active",true).maybeSingle(),
  actor.supabase.from("os_records").select("id").eq("id",parent).eq("record_type","meeting").is("archived_at",null).maybeSingle(),
 ]);
 if(member.error||meeting.error)throw new ApiError(503,"MEETING_TASK_CHECK_FAILED","업무 담당자와 회의 연결을 확인하지 못했습니다.");
 if(!member.data||!meeting.data)throw new ApiError(400,"MEETING_TASK_TARGET_INVALID","활성 구성원과 접근 가능한 회의를 선택해 주세요.");
}
