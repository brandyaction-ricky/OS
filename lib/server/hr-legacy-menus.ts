import { ApiError } from "@/lib/http";
import { hrWorkspaceEnabled } from "@/lib/hr/gate";
import { createServiceSupabase } from "@/lib/supabase/server";
import type { RequestActor } from "./auth";

/** Read the setting without changing any legacy record. */
export async function readLegacyTeamMenusHidden(supabase: RequestActor["supabase"]) {
  const { data, error } = await supabase.rpc("os_hr_legacy_team_menus_hidden");
  // During a code-first Preview, keep the old menu visible until the additive
  // migration has been applied. Other DB errors must remain visible.
  if (error?.code === "PGRST202" || error?.code === "42883") return false;
  if (error) throw new ApiError(503, "HR_LEGACY_STATE_UNAVAILABLE", "옛 팀 메뉴 상태를 확인하지 못했습니다.");
  return data === true;
}

export async function legacyTeamMenusHidden() {
  if (!hrWorkspaceEnabled()) return false;
  return readLegacyTeamMenusHidden(createServiceSupabase());
}

export async function assertLegacyLeaveWritable(supabase: RequestActor["supabase"], recordType: string) {
  if (!hrWorkspaceEnabled() || !["leave_balance", "leave_request"].includes(recordType)) return;
  if (await readLegacyTeamMenusHidden(supabase))
    throw new ApiError(409, "LEGACY_LEAVE_CLOSED", "옛 팀 휴가 입력이 종료됐습니다. 인사 노무 관리에서 처리해 주세요.");
}
