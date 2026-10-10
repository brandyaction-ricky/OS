import { ApiError } from "@/lib/http";
import { hrWorkspaceEnabled } from "@/lib/hr/gate";
import { createServiceSupabase } from "@/lib/supabase/server";
import type { RequestActor } from "./auth";

/** Read the setting without changing any legacy record. */
export async function legacyTeamMenusHidden() {
  if (!hrWorkspaceEnabled()) return false;
  const { data, error } = await createServiceSupabase().rpc("os_hr_legacy_team_menus_hidden");
  if (error) throw new ApiError(503, "HR_LEGACY_STATE_UNAVAILABLE", "옛 팀 메뉴 상태를 확인하지 못했습니다.");
  return data === true;
}

export async function assertLegacyLeaveWritable(supabase: RequestActor["supabase"], recordType: string) {
  if (!hrWorkspaceEnabled() || !["leave_balance", "leave_request"].includes(recordType)) return;
  const { data, error } = await supabase.rpc("os_hr_legacy_team_menus_hidden");
  if (error) throw new ApiError(503, "HR_LEGACY_STATE_UNAVAILABLE", "옛 휴가 화면 상태를 확인하지 못했습니다.");
  if (data === true)
    throw new ApiError(409, "LEGACY_LEAVE_CLOSED", "옛 팀 휴가 입력이 종료됐습니다. 인사 노무 관리에서 처리해 주세요.");
}
