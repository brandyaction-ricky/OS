import {
  DOC_LABELS,
  type HrData,
  type Employee,
  type Contract,
  type HrProfile,
  type HrDocument,
  type HrForm,
  type LeaveType,
  type PersonKind,
} from "./types";
import {
  leavePreview,
  periodOf,
  promotion,
  addMonths,
  maskedEmployee,
  workDays,
} from "./domain";
import { HR_MESSAGES } from "./messages";
function fail(code: string): never {
  throw new Error(HR_MESSAGES[code] || code);
}
/** In-memory demonstration only. Production mutations always use authenticated RPC APIs. */
export function demoCommand(
  source: HrData,
  action: string,
  body: Record<string, unknown>,
  method: string,
  today: string,
) {
  const d = structuredClone(source),
    path = action.split("/"),
    id = crypto.randomUUID();
  let employeeId: string | null = null;
  let eventDetail: Record<string, unknown> = { fields: Object.keys(body) };
  let output: unknown = { saved: true };
  const needsReason = () => {
    if (
      typeof body.reason !== "string" ||
      !body.reason.trim() ||
      body.reason.length > 500
    )
      fail("REASON_REQUIRED");
  };
  const existing = d.employees.find(
    (e) => e.id === path[1] || e.profile_id === path[1],
  );
  if (action === "people" || (path[0] === "people" && path.length === 2)) {
    const p = body.person as Partial<Employee> & {
      person_kind: PersonKind;
      affiliation?: string;
    };
    if (method === "PATCH") needsReason();
    let profile = d.profiles.find((x) => x.id === p.profile_id);
    if (action === "people" && body.issue) {
      if (d.profiles.some((x) => x.email === p.email)) fail("EMAIL_TAKEN");
      profile = {
        id,
        display_name: p.display_name || "",
        email: p.email || "",
        person_kind: p.person_kind === "shared" ? null : p.person_kind,
        role: (body.role || "member") as HrProfile["role"],
        is_active: true,
        is_shared_account: p.person_kind === "shared",
        finance_access: false,
        affiliation: p.affiliation || "",
        roles: p.job_roles || [],
        team: "",
        onboarding: { account: true },
        updated_at: new Date().toISOString(),
      };
      d.profiles.push(profile);
    }
    if (p.person_kind !== "employee" && !profile) fail("ACCOUNT_REQUIRED");
    if (profile) {
      profile.display_name = p.display_name || profile.display_name;
      profile.person_kind = p.person_kind === "shared" ? null : p.person_kind;
      profile.is_shared_account = p.person_kind === "shared";
      profile.roles = p.job_roles || profile.roles;
      profile.affiliation = p.affiliation ?? profile.affiliation;
    }
    if (existing) {
      if (existing.version !== body.version) fail("VERSION_CONFLICT");
      Object.assign(existing, p, {
        id: existing.id,
        profile_id: existing.profile_id,
        version: existing.version + 1,
      });
      employeeId = existing.id;
    } else if (p.person_kind === "employee") {
      if (!p.legal_name || !p.hire_date) fail("LEGAL_NAME_REQUIRED");
      const e: Employee = {
        id: crypto.randomUUID(),
        profile_id: profile?.id || null,
        display_name: p.display_name || "",
        legal_name: p.legal_name,
        email: p.email || null,
        job_roles: p.job_roles || [],
        gender: p.gender || null,
        birth_date: p.birth_date || null,
        address: p.address || null,
        phone: p.phone || null,
        emergency_contact: p.emergency_contact || null,
        career_summary: p.career_summary || null,
        hire_date: p.hire_date,
        status: "active",
        leave_from: null,
        leave_to: null,
        retire_date: null,
        retire_reason: null,
        retention_until: null,
        offboarding: {},
        version: 1,
      };
      d.employees.push(maskedEmployee(e));
      employeeId = e.id;
      d.documents.push(
        ...Object.keys(DOC_LABELS).map((k) => ({
          id: crypto.randomUUID(),
          version: 1,
          hr_employee_id: e.id,
          doc_kind: k as keyof typeof DOC_LABELS,
          status: "missing" as const,
          done_date: null,
          file_path: null,
        })),
      );
      const contract = (body.person as { contract: Partial<Contract> })
        .contract;
      d.contracts.push({
        id: crypto.randomUUID(),
        version: 1,
        hr_employee_id: e.id,
        contract_type: contract.contract_type || "permanent",
        start_date: e.hire_date,
        end_date: contract.end_date || null,
        probation_end: contract.probation_end || null,
        weekly_hours: contract.weekly_hours || 40,
        work_days: contract.work_days || "월–금",
        work_time: contract.work_time || "",
        workplace: contract.workplace || "",
        reason: "최초 등록",
        is_current: true,
      });
    }
    output = { id: profile?.id || employeeId };
  } else if (path[0] === "people" && existing) {
    employeeId = existing.id;
    if (path[2] === "reveal")
      output = Object.fromEntries(
        (body.fields as string[]).map((f) => [
          f,
          (
            {
              legal_name: "가상 직원",
              birth_date: "1995-04-15",
              phone: "010-0000-0000",
              address: "예시 지역 예시 주소",
            } as Record<string, string>
          )[f],
        ]),
      );
    if (path[2] === "contracts") {
      needsReason();
      d.contracts
        .filter((c) => c.hr_employee_id === existing.id)
        .forEach((c) => {
          c.is_current = false;
        });
      d.contracts.push({
        ...(body.contract as Contract),
        id,
        version: 1,
        hr_employee_id: existing.id,
        reason: String(body.reason),
        is_current: true,
      });
      d.documents
        .filter(
          (x) =>
            x.hr_employee_id === existing.id &&
            ["contract_signed", "contract_given"].includes(x.doc_kind),
        )
        .forEach((x) => {
          x.status = "missing";
          x.done_date = null;
          x.file_path = null;
          x.version++;
        });
    }
    if (path[2] === "retire") {
      if (existing.version !== body.version) fail("VERSION_CONFLICT");
      existing.retire_date = String(body.date);
      existing.retire_reason = String(body.reason);
      existing.retention_until = addMonths(existing.retire_date, 36);
      existing.offboarding = body.offboarding as Record<string, boolean>;
      existing.version++;
      existing.status = existing.retire_date < today ? "retired" : "active";
      d.requests
        .filter(
          (r) =>
            r.hr_employee_id === existing.id &&
            r.end_date > existing.retire_date! &&
            ["approved", "pending"].includes(r.status),
        )
        .forEach((r) => {
          r.status = "cancelled";
          r.cancelled_at = new Date().toISOString();
          r.version++;
        });
    }
  }
  if (path[0] === "people" && path[2] === "account") {
    const profile = d.profiles.find(
      (p) => p.id === path[1] || p.id === existing?.profile_id,
    );
    if (method === "PATCH" && profile) {
      Object.assign(profile, body.account, {
        updated_at: new Date().toISOString(),
      });
    } else if (existing && !existing.profile_id) {
      existing.profile_id = id;
      d.profiles.push({
        id,
        display_name: existing.display_name,
        email: existing.email || "",
        person_kind: "employee",
        role: "member",
        is_active: true,
        finance_access: false,
        is_shared_account: false,
        affiliation: "",
        roles: existing.job_roles,
        onboarding: { account: true },
        team: "",
        updated_at: new Date().toISOString(),
      });
    }
  }
  if (action === "leave-requests") {
    const e = d.employees.find((e) => e.id === body.person);
    if (!e) fail("HR_NOT_FOUND");
    const start = String(body.start),
      end = String(body.end),
      type = body.type as LeaveType;
    const preview = leavePreview(d, e, type, start, end, today);
    if (preview.errors.length) fail(preview.errors[0]);
    employeeId = e.id;
    d.requests.push({
      id,
      version: 1,
      hr_employee_id: e.id,
      leave_type: type,
      start_date: start,
      end_date: end,
      days: preview.days,
      deducts: ["annual", "half_am", "half_pm"].includes(type),
      reason: String(body.reason || ""),
      proof_path: body.proof ? String(body.proof) : null,
      status: body.direct ? "approved" : "pending",
      requested_by: e.profile_id,
      requested_at: today + "T00:00:00Z",
      decided_by: body.direct ? "demo" : null,
      decided_at: body.direct ? today + "T00:00:00Z" : null,
      reject_reason: null,
      cancelled_at: null,
    });
    output = { id };
  } else if (path[0] === "leave-requests" && path.length === 3) {
    const r = d.requests.find((r) => r.id === path[1]);
    if (!r) fail("HR_NOT_FOUND");
    if (r.version !== body.version) fail("VERSION_CONFLICT");
    employeeId = r.hr_employee_id;
    if (path[2] === "cancel") {
      if (r.status === "approved" && r.start_date <= today)
        fail("NOT_CANCELLABLE");
      r.status = "cancelled";
      r.cancelled_at = today + "T00:00:00Z";
    } else {
      if (r.status !== "pending") fail("ALREADY_DECIDED");
      if (body.decision === "rejected") needsReason();
      if (body.decision === "approved") {
        const employee = d.employees.find((e) => e.id === r.hr_employee_id)!;
        const check = leavePreview(
          { ...d, requests: d.requests.filter((x) => x.id !== r.id) },
          employee,
          r.leave_type,
          r.start_date,
          r.end_date,
          today,
        );
        if (check.errors.length) fail(check.errors[0]);
        r.days = check.days;
      }
      r.status = body.decision === "approved" ? "approved" : "rejected";
      r.reject_reason = body.reason ? String(body.reason) : null;
      r.decided_at = today + "T00:00:00Z";
      r.decided_by = "demo";
    }
    r.version++;
  }
  if (action === "leave-credits") {
    needsReason();
    const e = d.employees.find((e) => e.id === body.employee);
    if (!e) fail("HR_NOT_FOUND");
    const days = Number(body.days);
    if (!days || days % 0.5) fail("INVALID_DAYS");
    const p = periodOf(e.hire_date, today);
    d.credits.push({
      id,
      hr_employee_id: e.id,
      kind: body.kind === "opening" ? "opening" : "adjustment",
      days,
      entry_date: today,
      period_start: p.start,
      period_end: p.end,
      reason: String(body.reason),
      source: "manual",
    });
    employeeId = e.id;
  }
  if (action === "documents") {
    const doc = d.documents.find(
      (x) => x.hr_employee_id === body.employee && x.doc_kind === body.kind,
    );
    if (!doc) fail("HR_NOT_FOUND");
    if (doc.version !== body.version) fail("VERSION_CONFLICT");
    Object.assign(doc, {
      status: body.status,
      done_date: body.date,
      file_path: body.path,
      version: doc.version + 1,
    } as Partial<HrDocument>);
    employeeId = doc.hr_employee_id;
  }
  if (action === "forms") {
    const form = d.forms.find((f) => f.id === body.id);
    const next = {
      title: String(body.title),
      usage: String(body.usage),
      kind: String(body.kind),
      version_label: String(body.label),
      file_path: String(body.path),
      reviewed_at: today + "T00:00:00Z",
      reviewed_by: "demo",
    };
    eventDetail = {
      form: form?.id || id,
      versionLabel: next.version_label,
      previousPath: form?.file_path || null,
      previousLabel: form?.version_label || null,
    };
    if (form) Object.assign(form, next, { version: form.version + 1 });
    else d.forms.push({ ...next, id, version: 1 } as HrForm);
  }
  if (action === "holidays") {
    if (d.holidays.some((h) => h.day === body.day)) fail("HOLIDAY_EXISTS");
    d.holidays.push({
      day: String(body.day),
      name: String(body.name),
      kind: "manual",
      source: "manual",
    });
  }
  if (path[0] === "holidays" && method === "DELETE")
    d.holidays = d.holidays.filter(
      (h) => h.day !== path[1] || h.source !== "manual",
    );
  if (action === "leave-promotions") {
    const e = d.employees.find((e) => e.id === body.employee);
    if (!e) fail("HR_NOT_FOUND");
    const p = promotion(d, e, today);
    const dates = body.dates as string[];
    const designation = String(body.step).startsWith("designation");
    if (designation) {
      const target = String(body.step).endsWith("_extra")
        ? Math.max(0, (p.extra?.days || 0) - Number(d.promotions.find((row) => row.hr_employee_id === e.id && row.step === "notice_1_extra")?.reply_days || 0))
        : p.target;
      if (Number(body.days) !== target || dates.length !== Math.ceil(target) || new Set(dates).size !== dates.length ||
        (target % 1 !== 0 ? !["am", "pm"].includes(String(body.halfDay)) : body.halfDay != null)) fail("DATES_REQUIRED");
      if (dates.some((day) => day < today || day < p.period.start || day > p.period.end || workDays(day, day, d.holidays).days !== 1)) fail("INVALID_DATES");
    } else if (dates.length || body.halfDay != null) fail("DATES_REQUIRED");
    d.promotions.push({
      id,
      version: 1,
      hr_employee_id: e.id,
      period_start: p.period.start,
      period_end: p.period.end,
      step: body.step as "notice_1",
      due_date: p.due || p.extra?.due || p.period.end,
      sent_at: today + "T00:00:00Z",
      channel: body.channel as "paper",
      days: Number(body.days),
      designated_dates: dates,
      designated_half_day: body.halfDay as "am" | "pm" | null,
      body: String(body.body),
      paper_path: body.paper ? String(body.paper) : null,
      read_at: null,
      reply_at: null,
      reply_days: null,
      reply_dates: [],
      settlement_marked_at: null,
    });
    employeeId = e.id;
  }
  if (action === "leave-promotions/settlement") {
    const e = d.employees.find((e) => e.id === body.employee);
    if (!e) fail("HR_NOT_FOUND");
    const p = promotion(d, e, today);
    d.promotions.push({
      id,
      version: 1,
      hr_employee_id: e.id,
      period_start: p.period.start,
      period_end: p.period.end,
      step: "refusal",
      due_date: p.period.end,
      sent_at: today + "T00:00:00Z",
      channel: "paper",
      days: p.unused,
      designated_dates: [],
      body: "정산 대상",
      paper_path: null,
      read_at: null,
      reply_at: null,
      reply_days: null,
      reply_dates: [],
      settlement_marked_at: today + "T00:00:00Z",
    });
    employeeId = e.id;
  }
  if (path[0] === "leave-promotions" && path.length === 3) {
    const r = d.promotions.find((r) => r.id === path[1]);
    if (!r) fail("HR_NOT_FOUND");
    if (path[2] === "read") r.read_at = today + "T00:00:00Z";
    else {
      r.reply_at = today + "T00:00:00Z";
      r.reply_dates = body.dates as string[];
      r.reply_days = Math.min(r.days, r.reply_dates.length);
    }
    employeeId = r.hr_employee_id;
  }
  if (action === "legacy-menu-state") {
    const hidden = body.hidden === true;
    d.settings = [
      ...d.settings.filter((setting) => setting.key !== "legacy_team_menus"),
      { key: "legacy_team_menus", value: hidden ? "hidden" : "visible" },
    ];
    eventDetail = { to: hidden ? "hidden" : "visible" };
    output = { hidden };
  }
  d.events.unshift({
    id,
    actor: "demo",
    hr_employee_id: employeeId,
    profile_id: existing?.profile_id || null,
    action: action === "forms" ? "form.updated" : action,
    detail: eventDetail,
    reason: body.reason ? String(body.reason) : null,
    created_at: today + "T00:00:00Z",
  });
  return { data: d, result: output };
}
