"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button, Drawer, Field, Pill } from "./ui";
import { useHr } from "./context";
import {
  activeEmployees,
  leavePreview,
  promotion,
  retirement,
  shortDate,
} from "@/lib/hr/domain";
import {
  CONTRACT_LABELS,
  DOC_LABELS,
  KIND_LABELS,
  LEAVE_LABELS,
  type Employee,
  type HrDocument,
  type HrForm,
  type HrProfile,
  type LeaveType,
  type PersonKind,
  type Promotion,
  type PromotionStep,
} from "@/lib/hr/types";
import { HR_MESSAGES } from "@/lib/hr/messages";
export type DrawerState = {
  kind:
    | "new"
    | "edit"
    | "contract"
    | "retire"
    | "leave"
    | "credit"
    | "document"
    | "promotion"
    | "reply"
    | "form";
  employee?: Employee;
  profile?: HrProfile;
  document?: HrDocument;
  form?: HrForm;
  promotion?: Promotion;
  step?: PromotionStep;
  self?: boolean;
  prefill?: Partial<Employee>;
};
const titles = {
  new: "직원 등록",
  edit: "정보 수정",
  contract: "근로 조건 변경",
  retire: "퇴사 처리",
  leave: "휴가 입력",
  credit: "수동 조정",
  document: "서류 처리",
  promotion: "촉진 서면 보내기",
  reply: "사용 계획 회신",
  form: "양식 올리기",
};
const value = (f: FormData, k: string) => String(f.get(k) || "").trim();
const opt = (f: FormData, k: string) => value(f, k) || null;
export function HrFormDrawer({
  state,
  onClose,
}: {
  state: DrawerState;
  onClose: () => void;
}) {
  const hr = useHr(),
    router = useRouter(),
    { employee: e, profile, kind } = state;
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const [personKind, setPersonKind] = useState<PersonKind>(
    profile?.is_shared_account
      ? "shared"
      : profile?.person_kind ||
          (profile?.affiliation?.includes("협업") ? "contractor" : "employee"),
  );
  const [issue, setIssue] = useState(hr.admin && !profile),
    [contractType, setContractType] = useState(
      hr.data.contracts.find((c) => c.hr_employee_id === e?.id && c.is_current)
        ?.contract_type || "permanent",
    ),
    [status, setStatus] = useState(
      e?.status === "on_leave" ? "on_leave" : "active",
    );
  const [who, setWho] = useState(
      e?.id || activeEmployees(hr.data, hr.today)[0]?.id || "",
    ),
    [leaveType, setLeaveType] = useState<LeaveType>("annual"),
    [start, setStart] = useState(hr.today),
    [end, setEnd] = useState(hr.today),
    [retireDate, setRetireDate] = useState(e?.retire_date || hr.today),
    [channel, setChannel] = useState("os_email");
  const chosen = hr.data.employees.find((x) => x.id === who),
    half = ["half_am", "half_pm"].includes(leaveType),
    preview =
      chosen && kind === "leave"
        ? leavePreview(
            hr.data,
            chosen,
            leaveType,
            start,
            half ? start : end,
            hr.today,
          )
        : null;
  const promo =
    e && kind === "promotion" ? promotion(hr.data, e, hr.today) : null;
  const isExtra = state.step?.endsWith("_extra"),
    isDesignation = state.step?.startsWith("designation");
  const promotionDays = promo
    ? isExtra
      ? Math.max(
          0,
          (promo.extra?.days || 0) -
            Number(
              isDesignation
                ? hr.data.promotions.find(
                    (x) =>
                      x.hr_employee_id === e?.id && x.step === "notice_1_extra",
                  )?.reply_days || 0
                : 0,
            ),
        )
      : isDesignation
        ? promo.target
        : promo.unused
    : 0;
  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    const f = new FormData(event.currentTarget);
    setBusy(true);
    setError("");
    try {
      const file = f.get("file");
      let filePath: string | null = null;
      if (file instanceof File && file.size) {
        const purpose =
          kind === "leave"
            ? "leave_proof"
            : kind === "credit"
              ? "credit_evidence"
              : kind === "promotion"
                ? "promotion_paper"
                : kind === "form"
                  ? "form"
                  : "document";
        filePath = await hr.upload(
          file,
          purpose,
          kind === "leave" ? who : e?.id,
        );
      }
      const personId = profile?.id || e?.profile_id || e?.id;
      if (kind === "new" || kind === "edit") {
        const person: Record<string, unknown> = {
          display_name: value(f, "display_name"),
          person_kind: personKind,
          job_roles: value(f, "job_roles")
            .split(",")
            .map((x) => x.trim())
            .filter(Boolean),
          affiliation: value(f, "affiliation"),
        };
        if (profile) person.profile_id = profile.id;
        if (e) person.id = e.id;
        if (kind === "new") {
          person.email = opt(f, "email");
          person.legal_name = value(f, "legal_name") || person.display_name;
          if (personKind === "employee") {
            person.hire_date = value(f, "hire_date");
            person.contract = {
              contract_type: contractType,
              end_date: opt(f, "end_date"),
              probation_end: opt(f, "probation_end"),
              weekly_hours: Number(value(f, "weekly_hours")),
              work_days: "월–금",
            };
          }
        } else {
          if (profile) person.expected_updated_at = profile.updated_at;
          if (personKind === "employee" && !e) {
            person.legal_name = value(f, "legal_name");
            person.hire_date = value(f, "hire_date");
            person.contract = {
              contract_type: contractType,
              end_date: opt(f, "end_date"),
              probation_end: opt(f, "probation_end"),
              weekly_hours: Number(value(f, "weekly_hours")),
              work_days: "월–금",
            };
          }
          for (const field of [
            "phone",
            "address",
            "birth_date",
            "legal_name",
            "email",
          ])
            if (value(f, field)) person[field] = value(f, field);
          if (personKind === "employee") {
            person.emergency_contact = opt(f, "emergency_contact");
            person.career_summary = opt(f, "career_summary");
            person.gender = opt(f, "gender");
            if (!e?.retire_date) {
              person.status = status;
              person.leave_from =
                status === "on_leave" ? value(f, "leave_from") : null;
              person.leave_to =
                status === "on_leave" ? value(f, "leave_to") : null;
            }
            if (
              status === "on_leave" &&
              value(f, "leave_to") < value(f, "leave_from")
            )
              throw new Error(HR_MESSAGES.LEAVE_DATES_REQUIRED);
          }
        }
        if (kind === "new") {
          const result = await hr.save<{ id: string }>("people", {
            person,
            issue,
            role: value(f, "role") || "member",
          });
          onClose();
          router.push(`/hr/employees/${result.id}`);
          hr.toast("직원을 등록했습니다");
          return;
        }
        const previous: Record<string, unknown> = {
          display_name: profile?.display_name || e?.display_name,
          person_kind: profile?.is_shared_account
            ? "shared"
            : profile?.person_kind || (!profile ? "employee" : null),
          job_roles: profile?.roles || e?.job_roles || [],
          affiliation: profile?.affiliation || "",
          email: e?.email,
          gender: e?.gender || null,
          emergency_contact: e?.emergency_contact || null,
          career_summary: e?.career_summary || null,
          status: e?.status,
          leave_from: e?.leave_from || null,
          leave_to: e?.leave_to || null,
        };
        const changed = Object.entries(person).some(
          ([k, v]) =>
            !["id", "profile_id", "expected_updated_at"].includes(k) &&
            JSON.stringify(v) !== JSON.stringify(previous[k]),
        );
        if (!changed) {
          hr.toast("바뀐 내용이 없습니다");
          onClose();
          return;
        }
        await hr.save(
          `people/${personId}`,
          { person, version: e?.version || 0, reason: value(f, "reason") },
          "PATCH",
        );
      }
      if (kind === "contract")
        await hr.save(`people/${personId}/contracts`, {
          current: hr.data.contracts.find(
            (c) => c.hr_employee_id === e?.id && c.is_current,
          )?.id,
          contract: {
            contract_type: contractType,
            start_date: value(f, "start_date"),
            end_date: opt(f, "end_date"),
            probation_end: opt(f, "probation_end"),
            weekly_hours: Number(value(f, "weekly_hours")),
            work_days: value(f, "work_days"),
            work_time: value(f, "work_time"),
            workplace: value(f, "workplace"),
          },
          reason: value(f, "reason"),
        });
      if (kind === "retire")
        await hr.save(`people/${personId}/retire`, {
          version: e?.version,
          date: retireDate,
          reason: value(f, "retire_reason"),
          offboarding: {
            insurance: f.has("insurance"),
            settlement: f.has("settlement"),
            handoff: f.has("handoff"),
          },
        });
      if (kind === "leave") {
        if (preview?.errors.length)
          throw new Error(
            HR_MESSAGES[preview.errors[0]] || "입력 내용을 확인해 주세요.",
          );
        await hr.save("leave-requests", {
          person: who,
          type: leaveType,
          start,
          end: half ? start : end,
          reason: opt(f, "reason"),
          proof: filePath,
          direct: !state.self && f.has("direct"),
        });
      }
      if (kind === "credit")
        await hr.save("leave-credits", {
          employee: e?.id,
          days: Number(value(f, "days")),
          reason: value(f, "reason"),
          kind: "adjustment",
          evidence: filePath,
        });
      if (kind === "document")
        await hr.save(
          "documents",
          {
            employee: e?.id,
            kind: state.document?.doc_kind,
            status: value(f, "doc_status"),
            date: opt(f, "done_date"),
            path: filePath || state.document?.file_path || null,
            version: state.document?.version,
          },
          "PATCH",
        );
      if (kind === "promotion")
        await hr.save("leave-promotions", {
          employee: e?.id,
          step: state.step,
          days: promotionDays,
          dates: value(f, "dates")
            .split(/[\s,]+/)
            .filter(Boolean),
          channel,
          body: value(f, "body"),
          paper: filePath,
        });
      if (kind === "reply")
        await hr.save(`leave-promotions/${state.promotion?.id}/reply`, {
          dates: value(f, "dates")
            .split(/[\s,]+/)
            .filter(Boolean),
        });
      if (kind === "form") {
        const path = filePath || state.form?.file_path;
        if (!path) throw new Error("양식 파일을 골라 주세요.");
        await hr.save("forms", {
          id: state.form?.id || null,
          version: state.form?.version || 0,
          title: value(f, "title"),
          usage: value(f, "usage"),
          kind: state.form?.kind || "custom",
          label: value(f, "version_label"),
          path,
        });
      }
      hr.toast(
        kind === "contract"
          ? "새 계약을 저장했습니다 · 근로계약서 다시 받기"
          : kind === "retire"
            ? "퇴사 처리와 보존 기한을 저장했습니다"
            : kind === "leave"
              ? "휴가를 저장했습니다"
              : kind === "promotion"
                ? "촉진 서면을 기록했습니다"
                : "저장했습니다",
      );
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "저장하지 못했습니다.");
    } finally {
      setBusy(false);
    }
  }
  const contract = hr.data.contracts.find(
    (c) => c.hr_employee_id === e?.id && c.is_current,
  );
  return (
    <Drawer title={titles[kind]} onClose={onClose} busy={busy}>
      <form onSubmit={onSubmit}>
        <div className="hr-drawer-content">
          {error ? (
            <div role="alert" className="hr-banner error">
              {error}
            </div>
          ) : null}
          {kind === "new" || kind === "edit" ? (
            <>
              <Field label="구분" required>
                <select
                  value={personKind}
                  onChange={(x) => setPersonKind(x.target.value as PersonKind)}
                >
                  {Object.entries(KIND_LABELS).map(([v, l]) => (
                    <option
                      key={v}
                      value={v}
                      disabled={!hr.admin && v === "shared"}
                    >
                      {l}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="표시 이름" required>
                <input
                  name="display_name"
                  required
                  maxLength={120}
                  defaultValue={profile?.display_name || e?.display_name || ""}
                />
              </Field>
              <Field label="소속">
                <input
                  name="affiliation"
                  maxLength={120}
                  defaultValue={profile?.affiliation || ""}
                />
              </Field>
              <Field label="맡은 일" hint="여러 개는 쉼표로 나눠 주세요.">
                <input
                  name="job_roles"
                  maxLength={500}
                  defaultValue={(profile?.roles || e?.job_roles || []).join(
                    ", ",
                  )}
                />
              </Field>
              {kind === "new" ? (
                <>
                  <Field label="로그인 이메일" required={issue}>
                    <input
                      name="email"
                      type="email"
                      required={issue}
                      maxLength={320}
                    />
                  </Field>
                  {personKind === "employee" ? (
                    <>
                      <h3 className="hr-subheading">근로자 명부·근로 조건</h3>
                      <Field label="실명" required>
                        <input name="legal_name" required maxLength={120} />
                      </Field>
                      <Field label="입사일" required>
                        <input name="hire_date" type="date" required />
                      </Field>
                      <Field label="고용형태" required>
                        <select
                          value={contractType}
                          onChange={(x) =>
                            setContractType(
                              x.target.value as typeof contractType,
                            )
                          }
                        >
                          {Object.entries(CONTRACT_LABELS).map(([v, l]) => (
                            <option key={v} value={v}>
                              {l}
                            </option>
                          ))}
                        </select>
                      </Field>
                      {contractType === "fixed_term" ? (
                        <Field label="계약 끝" required>
                          <input name="end_date" type="date" required />
                        </Field>
                      ) : null}
                      <Field label="수습 끝">
                        <input name="probation_end" type="date" />
                      </Field>
                      <Field label="주 소정근로시간" required>
                        <input
                          name="weekly_hours"
                          type="number"
                          required
                          min={1}
                          max={40}
                          step={0.5}
                          defaultValue={40}
                        />
                      </Field>
                    </>
                  ) : null}
                  <h3 className="hr-subheading">로그인 계정</h3>
                  <label className="hr-check">
                    <input
                      type="checkbox"
                      checked={issue}
                      disabled={!hr.admin}
                      onChange={(x) => setIssue(x.target.checked)}
                    />
                    로그인 계정 발급
                  </label>
                  {!hr.admin ? (
                    <p className="hr-muted">
                      계정 없이 근로자를 등록하고 관리자에게 발급을 요청하세요.
                    </p>
                  ) : null}
                  {issue ? (
                    <Field label="접근 역할">
                      <select name="role">
                        <option value="member">구성원</option>
                        <option value="lead">리드</option>
                        <option value="admin">관리자</option>
                      </select>
                    </Field>
                  ) : null}
                </>
              ) : personKind === "employee" ? (
                <>
                  {!e ? (
                    <>
                      <Field label="실명" required>
                        <input
                          name="legal_name"
                          required
                          maxLength={120}
                          defaultValue={state.prefill?.legal_name || ""}
                        />
                      </Field>
                      <Field label="입사일" required>
                        <input
                          name="hire_date"
                          type="date"
                          required
                          defaultValue={state.prefill?.hire_date || ""}
                        />
                      </Field>
                      <Field label="고용형태" required>
                        <select
                          value={contractType}
                          onChange={(x) =>
                            setContractType(
                              x.target.value as typeof contractType,
                            )
                          }
                        >
                          {Object.entries(CONTRACT_LABELS).map(([v, l]) => (
                            <option key={v} value={v}>
                              {l}
                            </option>
                          ))}
                        </select>
                      </Field>
                      {contractType === "fixed_term" ? (
                        <Field label="계약 끝" required>
                          <input name="end_date" type="date" required />
                        </Field>
                      ) : null}
                      <Field label="수습 끝">
                        <input name="probation_end" type="date" />
                      </Field>
                      <Field label="주 소정근로시간" required>
                        <input
                          name="weekly_hours"
                          type="number"
                          required
                          min={1}
                          max={40}
                          step={0.5}
                          defaultValue={40}
                        />
                      </Field>
                    </>
                  ) : null}
                  {e?.retire_date ? (
                    <div className="hr-banner">
                      퇴사 상태·날짜는 퇴사 처리 서랍에서 바꿉니다.
                    </div>
                  ) : (
                    <>
                      <Field label="근로 상태">
                        <select
                          value={status}
                          onChange={(x) => setStatus(x.target.value)}
                        >
                          <option value="active">재직</option>
                          <option value="on_leave">휴직</option>
                        </select>
                      </Field>
                      {status === "on_leave" ? (
                        <div className="hr-grid2">
                          <Field label="휴직 시작" required>
                            <input
                              name="leave_from"
                              type="date"
                              required
                              defaultValue={e?.leave_from || ""}
                            />
                          </Field>
                          <Field label="휴직 끝" required>
                            <input
                              name="leave_to"
                              type="date"
                              required
                              defaultValue={e?.leave_to || ""}
                            />
                          </Field>
                        </div>
                      ) : null}
                    </>
                  )}
                  <p className="hr-muted">
                    고용형태는 ‘근로 조건 변경’에서 바꿉니다. 가려진 항목은 새
                    값을 입력한 경우만 변경합니다.
                  </p>
                  {e ? (
                    <Field label="실명 변경">
                      <input name="legal_name" maxLength={120} />
                    </Field>
                  ) : null}
                  <Field label="성별">
                    <select name="gender" defaultValue={e?.gender || ""}>
                      <option value="">미등록</option>
                      <option value="M">남</option>
                      <option value="F">여</option>
                      <option value="X">기타</option>
                    </select>
                  </Field>
                  <Field label="생년월일 변경">
                    <input
                      name="birth_date"
                      type="date"
                      defaultValue={state.prefill?.birth_date || ""}
                    />
                  </Field>
                  <Field label="연락처 변경">
                    <input
                      name="phone"
                      type="tel"
                      maxLength={40}
                      defaultValue={state.prefill?.phone || ""}
                    />
                  </Field>
                  <Field label="주소 변경">
                    <input
                      name="address"
                      maxLength={500}
                      defaultValue={state.prefill?.address || ""}
                    />
                  </Field>
                  <Field label="비상연락처">
                    <input
                      name="emergency_contact"
                      maxLength={120}
                      defaultValue={
                        e?.emergency_contact ||
                        state.prefill?.emergency_contact ||
                        ""
                      }
                    />
                  </Field>
                  <Field label="이력">
                    <textarea
                      name="career_summary"
                      maxLength={2000}
                      defaultValue={e?.career_summary || ""}
                    />
                  </Field>
                  {!profile ? (
                    <Field label="발급할 이메일">
                      <input
                        name="email"
                        type="email"
                        defaultValue={e?.email || ""}
                      />
                    </Field>
                  ) : null}
                </>
              ) : null}
              {kind === "edit" ? (
                <Field label="바꾼 이유" required>
                  <textarea name="reason" required maxLength={500} />
                </Field>
              ) : null}
              <p className="hr-muted">
                주민등록번호는 OS에 저장하지 않습니다. 4대보험 신고는
                세무사·공단 시스템에서 합니다.
              </p>
            </>
          ) : null}
          {kind === "contract" ? (
            <>
              <div className="hr-banner">
                지난 계약은 그대로 두고 새 계약 줄을 더합니다. 근로계약서
                서명·교부가 ‘빠짐’으로 돌아가 다시 받아야 합니다.
              </div>
              <Field label="적용 시작일" required>
                <input
                  name="start_date"
                  type="date"
                  required
                  defaultValue={hr.today}
                />
              </Field>
              <Field label="고용형태" required>
                <select
                  value={contractType}
                  onChange={(x) =>
                    setContractType(x.target.value as typeof contractType)
                  }
                >
                  {Object.entries(CONTRACT_LABELS).map(([v, l]) => (
                    <option key={v} value={v}>
                      {l}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="계약 끝" required={contractType === "fixed_term"}>
                <input
                  name="end_date"
                  type="date"
                  required={contractType === "fixed_term"}
                />
              </Field>
              <Field label="주 소정근로시간" required>
                <input
                  name="weekly_hours"
                  type="number"
                  required
                  min={1}
                  max={40}
                  step={0.5}
                  defaultValue={contract?.weekly_hours || 40}
                />
              </Field>
              <Field label="수습 끝">
                <input name="probation_end" type="date" />
              </Field>
              <Field label="근무일">
                <input
                  name="work_days"
                  defaultValue={contract?.work_days || "월–금"}
                  maxLength={80}
                />
              </Field>
              <Field label="근무 시간">
                <input
                  name="work_time"
                  defaultValue={contract?.work_time || ""}
                  maxLength={80}
                />
              </Field>
              <Field label="근무 장소">
                <input
                  name="workplace"
                  defaultValue={contract?.workplace || ""}
                  maxLength={200}
                />
              </Field>
              <Field label="바꾼 이유" required>
                <textarea name="reason" required maxLength={500} />
              </Field>
            </>
          ) : null}
          {kind === "retire" && e ? (
            <>
              <Field label="퇴사일" required hint="마지막 근무일">
                <input
                  type="date"
                  required
                  value={retireDate}
                  onInput={(x) => setRetireDate(x.currentTarget.value)}
                  min={e.hire_date}
                  onChange={(x) => setRetireDate(x.target.value)}
                />
              </Field>
              <Field label="퇴사 사유" required>
                <select
                  name="retire_reason"
                  defaultValue={e.retire_reason || "voluntary"}
                >
                  {[
                    ["voluntary", "자진 퇴사"],
                    ["contract_end", "계약 만료"],
                    ["recommended", "권고사직"],
                    ["dismissal", "해고"],
                    ["retirement_age", "정년"],
                    ["other", "기타"],
                  ].map(([v, l]) => (
                    <option key={v} value={v}>
                      {l}
                    </option>
                  ))}
                </select>
              </Field>
              {retireDate ? (
                <div className="hr-calc">
                  근속 {retirement(hr.data, e, retireDate, hr.today).tenure}
                  <br />
                  남은 연차{" "}
                  <b>
                    {retirement(hr.data, e, retireDate, hr.today).balance}일
                  </b>
                  <small className="hr-muted"> · 퇴사일까지 발생분 포함</small>
                  <p>
                    이전 기간 소멸분과 금품 청산 기한·금액은 노무사 확인이
                    필요합니다.
                  </p>
                </div>
              ) : null}
              <h3>함께 처리</h3>
              {[
                "퇴사일 다음 날부터 계정 접속 차단",
                "퇴사일 뒤 남은 휴가 신청 정리",
                `명부·계약 서류 ${retireDate ? addRetention(retireDate) : ""}까지 보존 후 파기 알림`,
              ].map((x) => (
                <label className="hr-check" key={x}>
                  <input type="checkbox" checked disabled />
                  {x}
                </label>
              ))}
              {[
                ["insurance", "4대보험 상실 신고"],
                ["settlement", "금품 청산 확인"],
                ["handoff", "업무 넘기기"],
              ].map(([v, l]) => (
                <label className="hr-check" key={v}>
                  <input
                    type="checkbox"
                    name={v}
                    defaultChecked={e.offboarding[v]}
                  />
                  {l}
                </label>
              ))}
            </>
          ) : null}
          {kind === "leave" ? (
            <>
              <Field label="대상" required>
                <select
                  value={who}
                  disabled={!!e || state.self}
                  onChange={(x) => setWho(x.target.value)}
                >
                  {activeEmployees(hr.data, hr.today).map((x) => (
                    <option value={x.id} key={x.id}>
                      {x.display_name}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="구분" required>
                <select
                  value={leaveType}
                  onChange={(x) => setLeaveType(x.target.value as LeaveType)}
                >
                  {Object.entries(LEAVE_LABELS).map(([v, l]) => (
                    <option value={v} key={v}>
                      {l}
                    </option>
                  ))}
                </select>
              </Field>
              <div className="hr-grid2">
                <Field label="시작일" required>
                  <input
                    type="date"
                    required
                    value={start}
                    onInput={(x) => {
                      const day = x.currentTarget.value;
                      setStart(day);
                      if (end < day) setEnd(day);
                    }}
                    onChange={(x) => {
                      setStart(x.target.value);
                      if (end < x.target.value) setEnd(x.target.value);
                    }}
                  />
                </Field>
                <Field label="종료일" required>
                  <input
                    type="date"
                    required
                    disabled={half}
                    value={half ? start : end}
                    onInput={(x) => setEnd(x.currentTarget.value)}
                    onChange={(x) => setEnd(x.target.value)}
                  />
                </Field>
              </div>
              {preview ? (
                <div className="hr-calc">
                  <b>{preview.days}일</b> · 주말 {preview.weekends}일 · 공휴일{" "}
                  {preview.holidays.length}일 제외
                  <br />
                  {preview.balance.future
                    ? `다음 기간(${shortDate(preview.balance.period.start)}~) 발생 예정 연차에서 차감`
                    : `이번 기간 잔여 ${preview.balance.left}일`}
                  <br />
                  저장 후 잔여 <b>{preview.after}일</b>
                  {preview.errors.map((x) => (
                    <p className="hr-danger" key={x}>
                      {x === "CROSSES_PERIOD"
                        ? `연차 기간(${shortDate(preview.balance.period.end)} 끝)을 넘습니다 — 두 건으로 나눠 입력해 주세요.`
                        : HR_MESSAGES[x]}
                    </p>
                  ))}
                  {preview.overlaps.length ? (
                    <p>
                      <Pill tone="warn">
                        같은 날 다른 사람 휴가 {preview.overlaps.length}건
                      </Pill>
                    </p>
                  ) : null}
                </div>
              ) : null}
              <Field label="사유" required={leaveType === "other"}>
                <textarea
                  name="reason"
                  required={leaveType === "other"}
                  maxLength={500}
                />
              </Field>
              {["sick", "family_event", "public_duty"].includes(leaveType) ? (
                <FileInput label="증빙" />
              ) : null}
              {!state.self ? (
                <label className="hr-check">
                  <input type="checkbox" name="direct" />
                  바로 승인으로 저장
                </label>
              ) : (
                <p className="hr-muted">
                  신청 후 인사 담당자의 승인을 기다립니다.
                </p>
              )}
            </>
          ) : null}
          {kind === "credit" ? (
            <>
              <div className="hr-banner">
                지난 줄은 고치지 않고 새 줄을 더합니다. 사유는 인사카드 변경
                이력에도 남습니다.
              </div>
              <Field
                label="조정 일수"
                required
                hint="차감은 음수, 추가는 양수. 0.5일 단위"
              >
                <input
                  name="days"
                  type="number"
                  required
                  step={0.5}
                  min={-999}
                  max={999}
                />
              </Field>
              <Field label="사유" required>
                <textarea name="reason" required maxLength={500} />
              </Field>
              <FileInput label="근거 파일" />
            </>
          ) : null}
          {kind === "document" ? (
            <>
              <p>
                <b>
                  {e?.display_name} ·{" "}
                  {state.document ? DOC_LABELS[state.document.doc_kind] : ""}
                </b>
              </p>
              {state.document?.doc_kind === "contract_given" ? (
                <div className="hr-banner">
                  교부 = 근로자에게 사본을 준 날. 전자 서명 링크로 받았으면 그
                  열람 시각입니다.
                </div>
              ) : null}
              <Field label="상태">
                <select name="doc_status" defaultValue="done">
                  <option value="done">완료</option>
                  <option value="missing">빠짐</option>
                </select>
              </Field>
              <Field label="처리 날짜" required>
                <input
                  name="done_date"
                  type="date"
                  required
                  defaultValue={state.document?.done_date || hr.today}
                />
              </Field>
              <FileInput label="파일" />
              <p className="hr-muted">
                퇴사일로부터 3년 되는 날까지 보존합니다. 파일을 열면 열람 기록이
                남습니다.
              </p>
            </>
          ) : null}
          {kind === "promotion" && promo ? (
            <>
              <div className="hr-calc">
                <b>
                  {e?.display_name} · {isExtra ? "추가분 " : ""}
                  {promotionDays}일
                </b>
                <br />
                사용 기간 {shortDate(promo.period.start)} ~{" "}
                {shortDate(promo.period.end)}
                {isExtra ? (
                  <p>발생일: {promo.extra?.dates.join(", ")}</p>
                ) : null}
              </div>
              {isDesignation ? (
                <Field
                  label="지정일"
                  required
                  hint="YYYY-MM-DD 형식, 여러 날은 쉼표로 나눠 주세요."
                >
                  <textarea
                    name="dates"
                    required
                    placeholder="2026-11-02, 2026-11-03"
                  />
                </Field>
              ) : null}
              <Field
                label="보낼 본문"
                required
                hint="확정된 양식을 참고해 작성하세요. 본문은 발송 시점 그대로 보관됩니다."
              >
                <textarea
                  name="body"
                  required
                  maxLength={16000}
                  rows={9}
                  defaultValue={`${e?.display_name} 님\n연차 사용 기간: ${promo.period.start} ~ ${promo.period.end}\n미사용 연차: ${promotionDays}일\n${isDesignation ? "지정된 날짜에 연차를 사용해 주세요." : "이 서면을 받은 날부터 10일 안에 사용 계획을 회신해 주세요."}\n작성일: ${hr.today}`}
                />
              </Field>
              <Field label="보내는 방법">
                <select
                  value={channel}
                  onChange={(x) => setChannel(x.target.value)}
                >
                  <option value="os_email">OS 알림 · 열람 시각 저장</option>
                  <option value="paper">종이 서면 · 서명본 보관</option>
                </select>
              </Field>
              {channel === "paper" ? (
                <FileInput label="서명본 사진 또는 PDF" required />
              ) : (
                <p className="hr-muted">
                  OS 알림으로 전달하고 열람 시각을 기록합니다.
                </p>
              )}
              <p className="hr-muted">
                서면의 문구와 절차 충족 여부는 노무사 검토가 필요합니다.
              </p>
            </>
          ) : null}
          {kind === "reply" ? (
            <>
              <pre className="hr-note">{state.promotion?.body}</pre>
              <Field
                label="사용 계획 날짜"
                required
                hint="YYYY-MM-DD 형식, 여러 날은 쉼표로 나눠 주세요."
              >
                <textarea
                  name="dates"
                  required
                  placeholder="2026-11-02, 2026-11-03"
                />
              </Field>
              <p className="hr-muted">
                사용 계획 회신은 휴가 승인과 별개입니다. 휴가 신청도 등록해
                주세요.
              </p>
            </>
          ) : null}
          {kind === "form" ? (
            <>
              <Field label="양식 이름" required>
                <input
                  name="title"
                  required
                  maxLength={120}
                  defaultValue={state.form?.title || ""}
                />
              </Field>
              <Field label="쓰는 곳">
                <input
                  name="usage"
                  maxLength={300}
                  defaultValue={state.form?.usage || ""}
                />
              </Field>
              <Field label="버전" required>
                <input
                  name="version_label"
                  required
                  maxLength={60}
                  placeholder="v1.0"
                />
              </Field>
              <FileInput label="양식 파일" required={!state.form?.file_path} />
              <p className="hr-muted">
                검토한 양식을 올려 주세요. 교체 전 파일과 버전은 변경 기록에
                남습니다.
              </p>
            </>
          ) : null}
        </div>
        <footer>
          <Button type="button" disabled={busy} onClick={onClose}>
            취소
          </Button>
          <Button
            type="submit"
            primary
            disabled={
              busy ||
              (kind === "leave" && (!preview || preview.errors.length > 0))
            }
          >
            {busy
              ? "저장 중…"
              : kind === "promotion"
                ? "서면 보내기"
                : kind === "reply"
                  ? "회신 보내기"
                  : "저장"}
          </Button>
        </footer>
      </form>
    </Drawer>
  );
}
function FileInput({
  label,
  required = false,
}: {
  label: string;
  required?: boolean;
}) {
  return (
    <Field label={label} required={required} hint="PDF, JPG, PNG · 10MB 이하">
      <input
        type="file"
        name="file"
        accept="application/pdf,image/jpeg,image/png"
        required={required}
      />
    </Field>
  );
}
function addRetention(date: string) {
  const y = Number(date.slice(0, 4)) + 3;
  const day = date.slice(5) === "02-29" ? "02-28" : date.slice(5);
  return `${y}-${day}`;
}
