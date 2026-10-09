import { z } from "zod";
import { ApiError } from "@/lib/http";
import { authenticateRequest, type RequestActor } from "./auth";
import { hrWorkspaceEnabled } from "@/lib/hr/gate";
import { addDays, todayKst } from "@/lib/hr/domain";
import { emptyHrData, type HrData, type Employee } from "@/lib/hr/types";
import { HR_MESSAGES } from "@/lib/hr/messages";
export { HR_MESSAGES };

export function hrDbError(error: { message?: string; code?: string }): never {
  const code = Object.keys(HR_MESSAGES).find((k) => error.message?.includes(k));
  if (code)
    throw new ApiError(
      ["HR_ACCESS_REQUIRED", "ADMIN_REQUIRED"].includes(code)
        ? 403
        : [
              "VERSION_CONFLICT",
              "INSUFFICIENT_LEAVE",
              "ALREADY_DECIDED",
              "ALREADY_IMPORTED",
              "HOLIDAY_EXISTS",
              "MEMBER_ACCOUNT_EXISTS",
            ].includes(code)
          ? 409
          : ["HR_NOT_FOUND", "NOT_EMPLOYEE"].includes(code)
            ? 404
            : 400,
      code,
      HR_MESSAGES[code],
    );
  if (["42P01", "PGRST202", "PGRST205", "42703"].includes(error.code || ""))
    throw new ApiError(
      503,
      "HR_SETUP_REQUIRED",
      "인사 데이터베이스 준비가 필요합니다. 화면을 새로고침해도 같으면 관리자에게 알려 주세요.",
    );
  throw new ApiError(
    400,
    "HR_INVALID_INPUT",
    "저장하지 못했습니다. 입력 내용·첨부·최신 상태를 확인해 주세요.",
  );
}
export async function hrRpc<T = unknown>(
  actor: Pick<RequestActor, "supabase">,
  name: string,
  args: Record<string, unknown> = {},
): Promise<T> {
  const { data, error } = await actor.supabase.rpc(name, args);
  if (error) hrDbError(error);
  return data as T;
}
export function requireHrFlag() {
  if (!hrWorkspaceEnabled())
    throw new ApiError(
      404,
      "HR_DISABLED",
      "인사 노무 관리를 아직 열지 않았습니다.",
    );
}
export async function hrActor(request: Request, operator = false) {
  requireHrFlag();
  const actor = await authenticateRequest(request);
  const allowed = await hrRpc<boolean>(actor, "os_has_hr_access");
  if (operator && !allowed)
    throw new ApiError(
      403,
      "HR_ACCESS_REQUIRED",
      HR_MESSAGES.HR_ACCESS_REQUIRED,
    );
  return { ...actor, hrAccess: allowed };
}
export type HrActor = Awaited<ReturnType<typeof hrActor>>;
export async function readAll<T>(
  actor: Pick<RequestActor, "supabase">,
  table: string,
  columns = "*",
  filter?: { employee?: string; from?: string; to?: string },
) {
  const rows: T[] = [];
  for (let offset = 0; offset < 100000; offset += 1000) {
    let query = actor.supabase
      .from(table)
      .select(columns)
      .order(
        table === "os_hr_holidays"
          ? "day"
          : table === "os_hr_settings"
            ? "key"
            : "id",
      )
      .range(offset, offset + 999);
    if (filter?.employee) query = query.eq("hr_employee_id", filter.employee);
    if (filter?.from)
      query = query.gte(
        table === "os_hr_holidays" ? "day" : "end_date",
        filter.from,
      );
    if (filter?.to)
      query = query.lte(
        table === "os_hr_holidays" ? "day" : "start_date",
        filter.to,
      );
    const { data, error } = await query;
    if (error) hrDbError(error);
    rows.push(...(data as T[]));
    if (data.length < 1000) return rows;
  }
  throw new ApiError(
    413,
    "HR_RANGE_REQUIRED",
    "조회할 자료가 많습니다. 기간을 줄여 주세요.",
  );
}
const profileColumns =
  "id,display_name,email,person_kind,role,is_active,finance_access,is_shared_account,affiliation,roles,onboarding,team,must_change_password,updated_at";
/** The initial workspace read never includes sensitive values or event payloads. */
export async function hrWorkspace(
  actor: HrActor,
  range?: { from: string; to: string },
): Promise<HrData> {
  if (!actor.hrAccess)
    throw new ApiError(
      403,
      "HR_ACCESS_REQUIRED",
      HR_MESSAGES.HR_ACCESS_REQUIRED,
    );
  const today = todayKst(),
    from = range?.from || addDays(today, -366),
    to = range?.to || addDays(today, 366),
    data = emptyHrData();
  const [
    profiles,
    employees,
    contracts,
    credits,
    requests,
    promotions,
    documents,
    forms,
    holidays,
    settings,
  ] = await Promise.all([
    readAll<HrData["profiles"][number]>(actor, "os_profiles", profileColumns),
    hrRpc<Employee[]>(actor, "os_hr_people"),
    readAll<HrData["contracts"][number]>(actor, "os_hr_contracts"),
    readAll<HrData["credits"][number]>(actor, "os_hr_leave_credits"),
    readAll<HrData["requests"][number]>(actor, "os_hr_leave_requests", "*", {
      from,
      to,
    }),
    readAll<HrData["promotions"][number]>(actor, "os_hr_leave_promotions"),
    readAll<HrData["documents"][number]>(actor, "os_hr_documents"),
    readAll<HrData["forms"][number]>(actor, "os_hr_forms"),
    readAll<HrData["holidays"][number]>(actor, "os_hr_holidays"),
    readAll<HrData["settings"][number]>(actor, "os_hr_settings"),
  ]);
  return {
    ...data,
    profiles,
    employees,
    contracts,
    credits,
    requests,
    promotions,
    documents,
    forms,
    holidays,
    settings,
  };
}
export async function hrSelf(actor: HrActor): Promise<HrData> {
  const data = emptyHrData(),
    employee = await hrRpc<Employee>(actor, "os_hr_me");
  data.employees = employee ? [employee] : [];
  if (!employee) return data;
  [data.requests, data.credits, data.promotions, data.holidays] =
    await Promise.all([
      readAll<HrData["requests"][number]>(actor, "os_hr_leave_requests", "*", {
        employee: employee.id,
      }),
      readAll<HrData["credits"][number]>(actor, "os_hr_leave_credits", "*", {
        employee: employee.id,
      }),
      readAll<HrData["promotions"][number]>(
        actor,
        "os_hr_leave_promotions",
        "*",
        { employee: employee.id },
      ),
      readAll<HrData["holidays"][number]>(actor, "os_hr_holidays"),
    ]);
  return data;
}
export async function hrJson(request: Request) {
  const reader = request.body?.getReader();
  if (!reader)
    throw new ApiError(400, "INVALID_JSON", "입력 내용을 확인해 주세요.");
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > 64000) {
      await reader.cancel();
      throw new ApiError(413, "BODY_TOO_LARGE", "입력 내용이 너무 깁니다.");
    }
    chunks.push(value);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new ApiError(400, "INVALID_JSON", "입력 내용을 확인해 주세요.");
  }
}
export function hrError(error: unknown) {
  if (error instanceof ApiError) return error;
  if (error instanceof z.ZodError)
    return new ApiError(
      400,
      "HR_INVALID_INPUT",
      error.issues[0]?.message || "입력 내용을 확인해 주세요.",
    );
  return new ApiError(
    500,
    "HR_INTERNAL_ERROR",
    "요청을 처리하지 못했습니다. 잠시 후 다시 시도해 주세요.",
  );
}
