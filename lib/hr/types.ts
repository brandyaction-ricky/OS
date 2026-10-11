export type PersonKind = "employee" | "owner" | "contractor" | "shared";
export type LeaveType =
  | "annual"
  | "half_am"
  | "half_pm"
  | "sick"
  | "family_event"
  | "public_duty"
  | "unpaid"
  | "other";
export type LeaveStatus = "pending" | "approved" | "rejected" | "cancelled";
export type DocKind =
  | "contract_signed"
  | "contract_given"
  | "roster"
  | "privacy"
  | "nda"
  | "insurance";
export type PromotionStep =
  | "notice_1"
  | "designation_2"
  | "notice_1_extra"
  | "designation_2_extra"
  | "refusal";
export interface Versioned {
  id: string;
  version: number;
  created_at?: string;
  updated_at?: string;
  updated_by?: string | null;
}
export interface HrProfile {
  id: string;
  display_name: string;
  email: string;
  person_kind: PersonKind | null;
  role: "admin" | "lead" | "member";
  is_active: boolean;
  finance_access: boolean;
  is_shared_account: boolean;
  affiliation: string;
  roles: string[];
  onboarding: Record<string, boolean>;
  team: string;
  must_change_password?: boolean;
  updated_at: string;
}
export interface Employee extends Versioned {
  profile_id: string | null;
  display_name: string;
  legal_name: string;
  email: string | null;
  job_roles: string[];
  gender: "M" | "F" | "X" | null;
  birth_date: string | null;
  address: string | null;
  phone: string | null;
  emergency_contact: string | null;
  career_summary: string | null;
  hire_date: string;
  status: "active" | "on_leave" | "retired";
  leave_from: string | null;
  leave_to: string | null;
  retire_date: string | null;
  retire_reason: string | null;
  retention_until: string | null;
  offboarding: Record<string, boolean>;
}
export interface Contract extends Versioned {
  hr_employee_id: string;
  contract_type: "permanent" | "fixed_term" | "part_time";
  start_date: string;
  end_date: string | null;
  probation_end: string | null;
  weekly_hours: number;
  work_days: string;
  work_time: string;
  workplace: string;
  reason: string;
  is_current: boolean;
}
export interface Credit {
  id: string;
  hr_employee_id: string;
  kind: "accrual_monthly" | "accrual_annual" | "adjustment" | "opening";
  days: number;
  entry_date: string;
  period_start: string;
  period_end: string;
  reason: string | null;
  source: "auto" | "manual" | "migration";
  evidence_path?: string | null;
}
export interface LeaveRequest extends Versioned {
  hr_employee_id: string;
  leave_type: LeaveType;
  start_date: string;
  end_date: string;
  days: number;
  deducts: boolean;
  reason: string | null;
  proof_path: string | null;
  status: LeaveStatus;
  requested_at: string;
  requested_by: string | null;
  decided_by: string | null;
  decided_at: string | null;
  reject_reason: string | null;
  cancelled_at: string | null;
  cancelled_by?: string | null;
  legacy_record_id?: string | null;
}
export interface Promotion extends Versioned {
  hr_employee_id: string;
  period_start: string;
  period_end: string;
  step: PromotionStep;
  due_date: string;
  sent_at: string;
  sent_by?: string | null;
  channel: "os_email" | "paper";
  days: number;
  designated_dates: string[];
  designated_half_day?: "am" | "pm" | null;
  body: string;
  paper_path: string | null;
  read_at: string | null;
  reply_at: string | null;
  reply_days: number | null;
  reply_dates: string[];
  settlement_marked_at: string | null;
}
export interface HrDocument extends Versioned {
  hr_employee_id: string;
  doc_kind: DocKind;
  status: "done" | "missing";
  done_date: string | null;
  file_path: string | null;
}
export interface HrForm extends Versioned {
  kind: string;
  title: string;
  usage: string;
  file_path: string | null;
  version_label: string;
  reviewed_at: string | null;
  reviewed_by: string | null;
}
export interface Holiday {
  day: string;
  name: string;
  kind: string;
  source: "api" | "manual";
}
export interface HrEvent {
  id: string | number;
  actor: string | null;
  hr_employee_id: string | null;
  profile_id: string | null;
  action: string;
  detail: Record<string, unknown>;
  reason: string | null;
  created_at: string;
}
export interface HrData {
  profiles: HrProfile[];
  employees: Employee[];
  contracts: Contract[];
  credits: Credit[];
  requests: LeaveRequest[];
  promotions: Promotion[];
  documents: HrDocument[];
  forms: HrForm[];
  holidays: Holiday[];
  settings: Array<{ key: string; value: unknown }>;
  events: HrEvent[];
}
export const emptyHrData = (): HrData => ({
  profiles: [],
  employees: [],
  contracts: [],
  credits: [],
  requests: [],
  promotions: [],
  documents: [],
  forms: [],
  holidays: [],
  settings: [],
  events: [],
});
export const DOC_LABELS: Record<DocKind, string> = {
  contract_signed: "근로계약서 서명",
  contract_given: "근로계약서 교부",
  roster: "근로자 명부 등록",
  privacy: "개인정보 수집·이용 동의",
  nda: "비밀유지 서약",
  insurance: "4대보험 취득 신고",
};
export const KIND_LABELS: Record<PersonKind, string> = {
  employee: "근로자",
  owner: "사업주",
  contractor: "외부 협업",
  shared: "공용 계정",
};
export const LEAVE_LABELS: Record<LeaveType, string> = {
  annual: "연차",
  half_am: "오전 반차",
  half_pm: "오후 반차",
  sick: "병가",
  family_event: "경조휴가",
  public_duty: "공가",
  unpaid: "무급휴가",
  other: "기타",
};
export const CONTRACT_LABELS = {
  permanent: "정규직",
  fixed_term: "기간제",
  part_time: "단시간",
};
export const STATUS_LABELS: Record<LeaveStatus, string> = {
  pending: "승인 대기",
  approved: "승인",
  rejected: "반려",
  cancelled: "취소",
};

export const RETIRE_LABELS: Record<string, string> = {
  voluntary: "자진 퇴사",
  contract_end: "계약 만료",
  recommended: "권고사직",
  dismissal: "해고",
  retirement_age: "정년",
  other: "기타",
};
