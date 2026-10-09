import { emptyHrData, DOC_LABELS, type Employee, type HrData } from "./types";
export const DEMO_TODAY = "2026-10-09";
export const demoId = (n: number) =>
  `10000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
/** Synthetic fixtures, loaded only for the existing credential-free demo mode. */
export function hrDemo(): HrData {
  const d = emptyHrData(),
    hires = [
      "2023-03-02",
      "2023-05-15",
      "2023-01-09",
      "2025-12-01",
      "2023-04-03",
    ];
  for (let n = 1; n <= 10; n++) {
    const worker = n >= 3 && n <= 7;
    const kind =
      n <= 2
        ? "owner"
        : worker
          ? "employee"
          : n === 10
            ? "shared"
            : "contractor";
    d.profiles.push({
      id: demoId(n),
      display_name: worker
        ? `직원 ${String.fromCharCode(62 + n)}`
        : n <= 2
          ? `사업주 ${n}`
          : n === 10
            ? "공용 계정"
            : `협업 ${n - 7}`,
      email: `person${n}@example.test`,
      person_kind: kind === "shared" ? null : kind,
      role: n <= 2 ? "admin" : "member",
      is_active: true,
      finance_access: n === 7,
      is_shared_account: n === 10,
      affiliation: "예시 회사",
      roles: worker ? ["담당 업무", "협업"] : [],
      onboarding: { account: true, role: true },
      team: "",
      updated_at: "2026-10-09T00:00:00Z",
    });
    if (!worker) continue;
    const profile = d.profiles.at(-1)!;
    const e: Employee = {
      id: demoId(n + 100),
      version: 1,
      profile_id: profile.id,
      display_name: profile.display_name,
      legal_name: "가••",
      email: profile.email,
      job_roles: profile.roles,
      gender: null,
      birth_date: "1995-04-••",
      address: "예시 지역 •••",
      phone: "010-••••-0000",
      emergency_contact: null,
      career_summary: "",
      hire_date: hires[n - 3],
      status: "active",
      leave_from: null,
      leave_to: null,
      retire_date: null,
      retire_reason: null,
      retention_until: null,
      offboarding: {},
    };
    d.employees.push(e);
    d.contracts.push({
      id: demoId(n + 200),
      version: 1,
      hr_employee_id: e.id,
      contract_type: "permanent",
      start_date: e.hire_date,
      end_date: null,
      probation_end: null,
      weekly_hours: 40,
      work_days: "월–금",
      work_time: "09:00–18:00",
      workplace: "사무실",
      reason: "최초 등록",
      is_current: true,
    });
    Object.keys(DOC_LABELS).forEach((kind, i) => {
      const missing = (n === 3 && i === 1) || (n === 5 && i === 3);
      d.documents.push({
        id: demoId(1000 + n * 10 + i),
        version: 1,
        hr_employee_id: e.id,
        doc_kind: kind as keyof typeof DOC_LABELS,
        status: missing ? "missing" : "done",
        done_date: missing ? null : e.hire_date,
        file_path: null,
      });
    });
  }
  const req = (
    n: number,
    who: number,
    start: string,
    end: string,
    days: number,
    status: "pending" | "approved",
    type: "annual" | "half_am" = "annual",
  ) => ({
    id: demoId(300 + n),
    version: 1,
    hr_employee_id: demoId(who + 100),
    leave_type: type,
    start_date: start,
    end_date: end,
    days,
    deducts: true,
    reason: "가상 신청 사례",
    proof_path: null,
    status,
    requested_by: demoId(who),
    requested_at: "2026-10-07T00:00:00Z",
    decided_by: status === "approved" ? demoId(1) : null,
    decided_at: status === "approved" ? "2026-10-08T00:00:00Z" : null,
    reject_reason: null,
    cancelled_at: null,
  });
  d.requests = [
    req(1, 3, "2026-10-19", "2026-10-20", 2, "pending"),
    req(2, 4, "2026-10-23", "2026-10-23", 1, "approved"),
    req(3, 5, "2026-10-14", "2026-10-14", 0.5, "pending", "half_am"),
    req(4, 6, "2026-10-08", "2026-10-08", 0.5, "approved", "half_am"),
    req(5, 7, "2026-09-30", "2026-09-30", 1, "approved"),
  ];
  for (const [who, period, sent, reply] of [
    [6, "2025-12-01", "2026-09-02", 6],
    [5, "2026-01-09", "2026-07-10", null],
  ] as const)
    d.promotions.push({
      id: demoId(400 + who),
      version: 1,
      hr_employee_id: demoId(who + 100),
      period_start: period,
      period_end: who === 6 ? "2026-11-30" : "2027-01-08",
      step: "notice_1",
      due_date: who === 6 ? "2026-09-10" : "2026-07-18",
      sent_at: sent + "T00:00:00Z",
      channel: "os_email",
      days: 10,
      designated_dates: [],
      body: "가상 연차 사용 촉구 서면입니다.",
      paper_path: null,
      read_at: null,
      reply_at: reply ? "2026-09-08T00:00:00Z" : null,
      reply_days: reply,
      reply_dates: [],
      settlement_marked_at: null,
    });
  d.holidays = [
    ["2026-10-03", "가상 개천절"],
    ["2026-10-05", "가상 대체공휴일"],
    ["2026-10-09", "가상 한글날"],
    ["2026-12-25", "가상 성탄절"],
    ["2027-01-01", "가상 신정"],
  ].map(([day, name]) => ({ day, name, source: "manual", kind: "manual" }));
  d.forms = [
    "표준 근로계약서 · 정규직",
    "표준 근로계약서 · 기간제",
    "표준 근로계약서 · 단시간",
    "개인정보 수집·이용 동의서",
    "비밀유지 서약서",
    "연차 사용 촉구서",
    "연차 사용 시기 지정 통보서",
  ].map((title, i) => ({
    id: demoId(500 + i),
    version: 1,
    kind: `form_${i}`,
    title,
    usage: i < 3 ? "근로계약" : i > 4 ? "사용 촉진" : "입사 서류",
    file_path: null,
    version_label: "검토 전",
    reviewed_at: null,
    reviewed_by: null,
  }));
  return d;
}
