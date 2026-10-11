"use client";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import {
  activeEmployees,
  addDays,
  addMonths,
  balance,
  calendarRange,
  leavePreview,
  leaveMetrics,
  missingHolidayYears,
  weekday,
} from "@/lib/hr/domain";
import { LEAVE_LABELS, STATUS_LABELS, type LeaveRequest } from "@/lib/hr/types";
import { HR_MESSAGES } from "@/lib/hr/messages";
import { useHr } from "./context";
import {
  Button,
  Cards,
  Drawer,
  Empty,
  Field,
  Panel,
  Pill,
  Table,
  Tabs,
} from "./ui";
import { LedgerRows } from "./ledger";
import type { OpenDrawer } from "./people";
import { MissingHolidayNotice, MissingWorkersMessage } from "./notices";
import { useSession } from "../session-provider";
export function Leave({
  open,
  self = false,
}: {
  open: OpenDrawer;
  self?: boolean;
}) {
  const hr = useHr(),
    session = useSession(),
    params = useSearchParams(),
    tab = params.get("tab") || "requests";
  const [detail, setDetail] = useState<LeaveRequest | null>(null),
    [decisionMode, setDecisionMode] = useState(""),
    [status, setStatus] = useState(params.get("status") || "all"),
    [person, setPerson] = useState(params.get("person") || ""),
    [demoPerson, setDemoPerson] = useState(hr.data.employees[0]?.id || ""),
    [notice, setNotice] = useState("");
  const me = self
    ? hr.data.employees.find((e) =>
        hr.demo ? e.id === demoPerson : e.profile_id === hr.actorId,
      )
    : undefined;
  const all = hr.data.requests.filter(
      (r) => !self || r.hr_employee_id === me?.id,
    ),
    rows = all
      .filter(
        (r) =>
          (status === "all" || r.status === status) &&
          (!person || r.hr_employee_id === person),
      )
      .sort(
        (a, b) =>
          (a.status === "pending" ? 0 : 1) - (b.status === "pending" ? 0 : 1) ||
          (a.status === "pending" && b.status === "pending"
            ? (a.created_at || a.start_date).localeCompare(
                b.created_at || b.start_date,
              )
            : b.start_date.localeCompare(a.start_date)),
      );
  const metrics = leaveMetrics(hr.data, hr.today);
  const b = me ? balance(hr.data, me, hr.today) : null,
    letters = me
      ? hr.data.promotions.filter(
          (p) => p.hr_employee_id === me.id && p.step !== "refusal",
        )
      : [];
  async function readLetter(id: string) {
    try {
      await hr.save(`leave-promotions/${id}/read`, {});
      setNotice(id);
    } catch (e) {
      hr.toast(e instanceof Error ? e.message : "열람 실패");
    }
  }
  return (
    <>
      <div className="hr-head">
        <div>
          <h1>{self ? "내 휴가" : "휴가 관리"}</h1>
          <p>
            {self
              ? "내 연차와 신청 결과를 확인하고 사용 계획을 회신합니다."
              : "휴가 신청을 확인·승인하고 캘린더로 누가 쉬는지 봅니다."}
          </p>
        </div>
        <Button
          primary
          disabled={self ? !me : !activeEmployees(hr.data, hr.today).length}
          onClick={() => open({ kind: "leave", employee: me, self })}
        >
          ＋ {self ? "휴가 신청" : "휴가 입력"}
        </Button>
      </div>
      {!self && !activeEmployees(hr.data, hr.today).length ? (
        <p className="hr-muted">
          {hr.data.profiles.some((p) => !p.person_kind && !p.is_shared_account)
            ? <>근로자 구분이 없어 입력할 수 없습니다 · <Link href="/hr/employees?migrate=1">이관하기</Link></>
            : "근로자가 없어 입력할 수 없습니다."}
        </p>
      ) : self && !me ? <p className="hr-muted">휴가 신청은 근로자 인사 정보가 연결된 뒤 사용할 수 있습니다.</p> : null}
      {self && hr.demo ? (
        <label className="hr-check">
          체험할 근로자{" "}
          <select
            aria-label="체험할 근로자"
            value={demoPerson}
            onChange={(e) => {
              setDemoPerson(e.target.value);
              setNotice("");
            }}
          >
            {hr.data.employees.map((e) => (
              <option key={e.id} value={e.id}>
                {e.display_name}
              </option>
            ))}
          </select>
        </label>
      ) : null}
      {self && !me ? (
        session.profile?.isSharedAccount || ["owner", "contractor"].includes(session.profile?.personKind || "") ? (
          <Empty title="연차 비대상">{session.profile?.isSharedAccount ? "공용 계정" : session.profile?.personKind === "owner" ? "사업주" : "외부 협업"}은 근로자 연차를 쓰지 않습니다.</Empty>
        ) : !session.profile?.personKind ? (
          <Empty title="구분이 정해지지 않았습니다">관리자에게 계정 구분을 요청해 주세요.</Empty>
        ) : (
          <Empty title="인사 정보가 연결되지 않았습니다">인사 담당자에게 계정과 근로자 정보 연결을 요청해 주세요.</Empty>
        )
      ) : (
        <>
          {b ? (
            <Cards
              items={[
                {
                  label: "남은 연차",
                  value: `${b.left}일`,
                  description: `${b.period.start} ~ ${b.period.end}`,
                },
                {
                  label: "발생·조정",
                  value: `${b.accrued + b.adjustment}일`,
                  description: "입사일 기준",
                },
                {
                  label: "사용·예정",
                  value: `${b.used + b.scheduled}일`,
                  description: `사용 ${b.used} · 사용 예정 ${b.scheduled}`,
                },
                {
                  label: "승인 대기",
                  value: `${b.pending}일`,
                  description: "승인 전에는 차감되지 않음",
                },
              ]}
            />
          ) : (
            <Cards
              items={[
                {
                  label: "승인 대기",
                  value: all.filter((r) => r.status === "pending").length,
                  description: "승인 시 휴일·잔여 다시 확인",
                },
                {
                  label: "오늘 휴가",
                  value: `${metrics.today}명`,
                  description: `${hr.today} ${hr.data.holidays.find((h) => h.day === hr.today)?.name || ""}`,
                },
                {
                  label: "이번 달 휴가자",
                  value: `${metrics.month.length}명`,
                  description:
                    metrics.month
                      .map(
                        (id) =>
                          hr.data.employees.find((e) => e.id === id)
                            ?.display_name,
                      )
                      .filter(Boolean)
                      .join(" · ") || "승인된 일정 없음",
                },
                {
                  label: "휴가 대상",
                  value: `${activeEmployees(hr.data, hr.today).length}명`,
                  description: (
                    <Link href="/hr/leave-ledger">
                      재직 근로자 · 잔여·원장 →
                    </Link>
                  ),
                },
              ]}
            />
          )}
          {!self && !activeEmployees(hr.data, hr.today).length ? (
            <Empty title="휴가 대상 근로자가 없습니다"><MissingWorkersMessage /></Empty>
          ) : null}
          <Tabs
            current={tab}
            items={
              self
                ? [
                    ["requests", "신청 내역"],
                    ["ledger", "연차 원장"],
                    [
                      "letters",
                      `촉진 서면 ${letters.filter((p) => !p.read_at).length || ""}`,
                    ],
                  ]
                : [
                    ["requests", "신청·승인"],
                    ["calendar", "휴가 캘린더"],
                  ]
            }
          />
          {tab === "requests" ? (
            <>
              <div className="hr-toolbar">
                <div className="hr-filter-chips" role="group" aria-label="휴가 상태">
                  {[["all", "전체"], ...Object.entries(STATUS_LABELS)].map(([value, label]) => (
                    <Button key={value} aria-pressed={status === value} onClick={() => setStatus(value)}>
                      {label} {all.filter((r) => value === "all" || r.status === value).length}
                    </Button>
                  ))}
                </div>
                {!self ? (
                  <select
                    aria-label="휴가 대상"
                    value={person}
                    onChange={(e) => setPerson(e.target.value)}
                  >
                    <option value="">모든 사람</option>
                    {hr.data.employees.map((e) => (
                      <option key={e.id} value={e.id}>
                        {e.display_name}
                      </option>
                    ))}
                  </select>
                ) : null}
              </div>
              {!self && all.some((r) => r.status === "pending" && (!person || r.hr_employee_id === person)) ? (
                <PendingApprovals
                  rows={all.filter((r) => r.status === "pending" && (!person || r.hr_employee_id === person))}
                  onSelect={(request, mode) => { setDecisionMode(mode); setDetail(request); }}
                />
              ) : null}
              <RequestTable rows={rows} onSelect={(request) => { setDecisionMode(""); setDetail(request); }} />
            </>
          ) : null}
          {tab === "calendar" && !self ? (
            <Calendar onSelect={(request) => { setDecisionMode(""); setDetail(request); }} />
          ) : null}
          {tab === "ledger" && me ? <LedgerRows employee={me} /> : null}
          {tab === "letters" && me ? (
            <Panel title="받은 촉진 서면">
              {letters.length ? (
                <div className="hr-body">
                  {letters.map((p) => (
                    <article className="hr-letter" key={p.id}>
                      <h3>
                        {p.step.startsWith("notice")
                          ? "사용 계획 촉구"
                          : "사용일 지정 통보"}
                        {p.step.endsWith("extra") ? " · 추가분" : ""}{" "}
                        <Pill tone={p.read_at ? "good" : "warn"}>
                          {p.read_at ? "읽음" : "새 서면"}
                        </Pill>
                      </h3>
                      <p>
                        {p.period_start} ~ {p.period_end} · {p.days}일 ·{" "}
                        {p.sent_at.slice(0, 10)}
                      </p>
                      <div className="hr-actions">
                        <Button onClick={() => void readLetter(p.id)}>
                          서면 보기
                        </Button>
                        {p.step.startsWith("notice") ? (
                          <Button
                            primary
                            disabled={!!p.reply_at}
                            onClick={() => {
                              void readLetter(p.id);
                              open({
                                kind: "reply",
                                employee: me,
                                promotion: p,
                                self: true,
                              });
                            }}
                          >
                            {p.reply_at
                              ? `${p.reply_days}일 회신 완료`
                              : "사용 계획 회신"}
                          </Button>
                        ) : null}
                      </div>
                      {notice === p.id ? (
                        <>
                          <pre className="hr-note">{p.body}</pre>
                          {p.paper_path ? (
                            <Button
                              onClick={() =>
                                void hr
                                  .openFile(p.paper_path!)
                                  .catch((e) => hr.toast(e.message))
                              }
                            >
                              서면 파일 보기
                            </Button>
                          ) : null}
                          <p>
                            지정일: {p.designated_dates.join(", ") || "없음"}
                          </p>
                          <p>
                            회신한 날짜:{" "}
                            {p.reply_dates.join(", ") || "아직 회신하지 않음"}
                          </p>
                        </>
                      ) : null}
                    </article>
                  ))}
                </div>
              ) : (
                <Empty title="받은 촉진 서면이 없습니다" />
              )}
            </Panel>
          ) : null}
        </>
      )}
      {detail ? (
        <RequestDrawer
          key={detail.id}
          request={detail}
          self={self}
          initialMode={decisionMode}
          onClose={() => setDetail(null)}
        />
      ) : null}
    </>
  );
}
function PendingApprovals({
  rows,
  onSelect,
}: {
  rows: LeaveRequest[];
  onSelect: (request: LeaveRequest, mode: string) => void;
}) {
  const hr = useHr();
  const ordered = [...rows].sort((a, b) =>
    (a.requested_at || a.created_at || a.start_date).localeCompare(
      b.requested_at || b.created_at || b.start_date,
    ),
  );
  return (
    <Panel title={`승인 대기 ${ordered.length}`}>
      <Table head={["신청자", "구분·기간", "일수", "남은 연차", "같은 날 휴가", "처리"]}>
        {ordered.map((request) => {
          const employee = hr.data.employees.find((e) => e.id === request.hr_employee_id);
          const preview = employee && leavePreview(
            { ...hr.data, requests: hr.data.requests.filter((r) => r.id !== request.id) },
            employee, request.leave_type, request.start_date, request.end_date, hr.today,
          );
          return (
            <tr key={request.id}>
              <td>{employee?.display_name || "근로자"}</td>
              <td>{LEAVE_LABELS[request.leave_type]}<small>
                {request.start_date} ({"일월화수목금토"[weekday(request.start_date)]}) ~ {request.end_date} ({"일월화수목금토"[weekday(request.end_date)]})
              </small></td>
              <td>{request.days}일</td>
              <td className={preview && preview.after < 0 ? "hr-danger" : ""}>
                {preview ? `${preview.balance.left} → ${preview.after}일` : "—"}
              </td>
              <td>{preview?.overlaps.length ? preview.overlaps.map((overlap) => {
                const name = hr.data.employees.find((e) => e.id === overlap.hr_employee_id)?.display_name || "근로자";
                return <Pill key={overlap.id} tone="warn">{name} {overlap.start_date}~{overlap.end_date}{overlap.status === "pending" ? " (대기)" : ""}</Pill>;
              }) : "—"}</td>
              <td><div className="hr-actions">
                <Button onClick={() => onSelect(request, "reject")}>반려</Button>
                <Button primary onClick={() => onSelect(request, "approve")}>승인</Button>
              </div></td>
            </tr>
          );
        })}
      </Table>
    </Panel>
  );
}

export function RequestTable({
  rows,
  onSelect,
}: {
  rows: LeaveRequest[];
  onSelect: (r: LeaveRequest) => void;
}) {
  const hr = useHr();
  return (
    <Panel>
      {rows.length ? (
        <Table head={["사람", "휴가", "날짜", "일수", "상태", "사유", "확인"]}>
          {rows.map((r) => (
            <tr key={r.id}>
              <td>
                {hr.data.employees.find((e) => e.id === r.hr_employee_id)
                  ?.display_name || "근로자"}
              </td>
              <td>{LEAVE_LABELS[r.leave_type]}</td>
              <td>
                {r.start_date} ~ {r.end_date}
              </td>
              <td>
                {r.days}일{!r.deducts ? <small>연차 차감 없음</small> : null}
              </td>
              <td>
                <Pill
                  tone={
                    r.status === "pending"
                      ? "warn"
                      : r.status === "approved"
                        ? "good"
                        : r.status === "rejected"
                          ? "danger"
                          : "muted"
                  }
                >
                  {STATUS_LABELS[r.status]}
                </Pill>
              </td>
              <td className="hr-row-small">
                {r.status === "rejected" ? r.reject_reason : r.reason || "—"}
              </td>
              <td>
                <Button onClick={() => onSelect(r)}>
                  {r.status === "pending" ? "확인" : "상세"}
                </Button>
              </td>
            </tr>
          ))}
        </Table>
      ) : (
        <Empty title="휴가 내역이 없습니다">
          휴가를 입력하거나 다른 조건으로 찾아보세요.
        </Empty>
      )}
    </Panel>
  );
}
function RequestDrawer({
  request: r,
  self,
  initialMode,
  onClose,
}: {
  request: LeaveRequest;
  self: boolean;
  initialMode: string;
  onClose: () => void;
}) {
  const hr = useHr(),
    [mode, setMode] = useState(initialMode),
    [holidayAcknowledged, setHolidayAcknowledged] = useState(false),
    [reason, setReason] = useState(""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    e = hr.data.employees.find((e) => e.id === r.hr_employee_id);
  const preview =
    e && r.status === "pending"
      ? leavePreview(
          {
            ...hr.data,
            requests: hr.data.requests.filter((x) => x.id !== r.id),
          },
          e,
          r.leave_type,
          r.start_date,
          r.end_date,
          hr.today,
        )
      : null;
  async function act(action: string) {
    if (busy) return;
    if (action === "approved" && missingHolidayYears(hr.data, r.start_date, r.end_date).length && !holidayAcknowledged) {
      setError("공휴일 미등록 안내를 확인해 주세요.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      await hr.save(
        `leave-requests/${r.id}/${action === "cancel" ? "cancel" : "decision"}`,
        action === "cancel"
          ? { version: r.version }
          : {
              version: r.version,
              decision: action,
              reason: action === "rejected" ? reason : null,
            },
      );
      hr.toast(
        action === "cancel"
          ? "휴가를 취소했습니다"
          : action === "approved"
            ? "휴가를 승인했습니다"
            : "휴가를 반려했습니다",
      );
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "저장 실패");
    } finally {
      setBusy(false);
    }
  }
  return (
    <Drawer title="휴가 확인" busy={busy} onClose={onClose}>
      <div className="hr-drawer-content">
        {error ? (
          <p role="alert" className="hr-banner error">
            {error}
          </p>
        ) : null}
        <h3>
          {e?.display_name} · {LEAVE_LABELS[r.leave_type]}{" "}
          <Pill>{STATUS_LABELS[r.status]}</Pill>
        </h3>
        <dl className="hr-detail-list">
          <dt>기간</dt>
          <dd>
            {r.start_date} ~ {r.end_date}
          </dd>
          <dt>신청 일수</dt>
          <dd>
            {r.days}일 · {r.deducts ? "연차 차감" : "연차 차감 없음"}
          </dd>
          <dt>사유</dt>
          <dd>{r.reason || "없음"}</dd>
          <dt>반려 사유</dt>
          <dd>{r.reject_reason || "—"}</dd>
        </dl>
        {r.proof_path ? (
          <p>
            <Button
              onClick={() =>
                void hr
                  .openFile(r.proof_path!)
                  .catch((e) => setError(e.message))
              }
            >
              증빙 보기
            </Button>
          </p>
        ) : null}
        {preview ? (
          <div className="hr-calc">
            현재 휴일 기준 <b>{preview.days}일</b> · 승인 후 잔여{" "}
            <b>{preview.after}일</b>
            {preview.days !== r.days ? (
              <p>
                휴일이 바뀌어 신청 때와 일수가 다릅니다. 승인하면 현재
                계산값으로 저장합니다.
              </p>
            ) : null}
            {preview.errors.map((x) => (
              <p className="hr-danger" key={x}>
                {HR_MESSAGES[x]}
              </p>
            ))}
            {preview.overlaps.length ? <p>같은 날 다른 사람 휴가: {preview.overlaps.map((overlap) => {
              const name = hr.data.employees.find((employee) => employee.id === overlap.hr_employee_id)?.display_name || "근로자";
              return `${name} ${overlap.start_date}~${overlap.end_date}${overlap.status === "pending" ? " (대기)" : ""}`;
            }).join(", ")}</p> : null}
          </div>
        ) : null}
        <MissingHolidayNotice start={r.start_date} end={r.end_date} />
        {missingHolidayYears(hr.data, r.start_date, r.end_date).length ? (
          <label className="hr-check"><input type="checkbox" checked={holidayAcknowledged} onChange={(event) => setHolidayAcknowledged(event.target.checked)} /> 공휴일 미등록으로 일수가 달라질 수 있음을 확인했습니다.</label>
        ) : null}
        {mode === "reject" ? (
          <Field label="반려 사유" required>
            <textarea
              maxLength={500}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            />
          </Field>
        ) : null}
        {mode === "cancel" ? (
          <div className="hr-banner">
            휴가를 취소할까요? 승인된 연차라면 잔여가 복원됩니다.
          </div>
        ) : null}
      </div>
      <footer>
        {mode ? (
          <>
            <Button disabled={busy} onClick={() => setMode("")}>
              돌아가기
            </Button>
            <Button
              danger={mode !== "approve"}
              primary={mode === "approve"}
              disabled={busy || (mode === "reject" && !reason.trim()) || (mode === "approve" && !!preview?.errors.length)}
              onClick={() => act(mode === "cancel" ? "cancel" : mode === "approve" ? "approved" : "rejected")}
            >
              {mode === "cancel" ? "취소 확인" : mode === "approve" ? "승인 확인" : "반려 확인"}
            </Button>
          </>
        ) : (
          <>
            {(r.status === "pending" ||
              (r.status === "approved" && r.start_date > hr.today)) &&
            (!self || r.status === "pending") ? (
              <Button danger disabled={busy} onClick={() => setMode("cancel")}>
                휴가 취소
              </Button>
            ) : null}
            {r.status === "pending" && !self ? (
              <>
                <Button disabled={busy} onClick={() => setMode("reject")}>
                  반려
                </Button>
                <Button
                  primary
                  disabled={busy || !!preview?.errors.length}
                  onClick={() => act("approved")}
                >
                  승인
                </Button>
              </>
            ) : (
              <Button onClick={onClose}>닫기</Button>
            )}
          </>
        )}
      </footer>
    </Drawer>
  );
}
function Calendar({ onSelect }: { onSelect: (r: LeaveRequest) => void }) {
  const hr = useHr(),
    [anchor, setAnchor] = useState(hr.today),
    [mode, setMode] = useState<"month" | "week">("month"),
    [person, setPerson] = useState(""),
    [expanded, setExpanded] = useState<Record<string, boolean>>({}),
    [rows, setRows] = useState(hr.data.requests),
    [loading, setLoading] = useState(false),
    [error, setError] = useState(""),
    read = useRef(hr.read);
  read.current = hr.read;
  const month = anchor.slice(0, 7),
    { from, to, count: n } = calendarRange(anchor, mode);
  useEffect(() => {
    if (hr.demo) {
      setRows(hr.data.requests);
      return;
    }
    let live = true;
    setLoading(true);
    setError("");
    read
      .current<{ rows: LeaveRequest[] }>(
        `leave-requests?calendar=true&from=${from}&to=${to}`,
      )
      .then((x) => {
        if (live) setRows(x.rows);
      })
      .catch((e) => {
        if (live) setError(e.message);
      })
      .finally(() => {
        if (live) setLoading(false);
      });
    return () => {
      live = false;
    };
  }, [from, to, hr.demo, hr.data.requests]);
  const names = new Map(hr.data.employees.map((e) => [e.id, e.display_name])),
    holidays = new Map(hr.data.holidays.map((h) => [h.day, h.name]));
  return (
    <>
      <div className="hr-toolbar">
        <Button
          aria-label={mode === "month" ? "이전 달" : "이전 주"}
          onClick={() =>
            setAnchor(
              mode === "month" ? addMonths(anchor, -1) : addDays(anchor, -7),
            )
          }
        >
          ←
        </Button>
        <Button onClick={() => setAnchor(hr.today)}>오늘</Button>
        <Button
          aria-label={mode === "month" ? "다음 달" : "다음 주"}
          onClick={() =>
            setAnchor(
              mode === "month" ? addMonths(anchor, 1) : addDays(anchor, 7),
            )
          }
        >
          →
        </Button>
        <b>
          {mode === "month"
            ? `${month.replace("-", "년 ")}월`
            : `${from} ~ ${to}`}
        </b>
        <Button
          aria-pressed={mode === "month"}
          onClick={() => setMode("month")}
        >
          월
        </Button>
        <Button aria-pressed={mode === "week"} onClick={() => setMode("week")}>
          주
        </Button>
        <select
          aria-label="캘린더 사람"
          value={person}
          onChange={(e) => setPerson(e.target.value)}
        >
          <option value="">모든 사람</option>
          {hr.data.employees.map((e) => (
            <option key={e.id} value={e.id}>
              {e.display_name}
            </option>
          ))}
        </select>
        {loading ? <span role="status">일정을 불러오는 중…</span> : null}
      </div>
      {error ? (
        <p className="hr-banner error" role="alert">
          {error}
        </p>
      ) : null}
      <MissingHolidayNotice start={from} end={to} />
      <Panel>
        <div
          className="hr-table-scroll"
          role="region"
          aria-label={
            mode === "month" ? "월간 휴가 캘린더" : "주간 휴가 캘린더"
          }
          tabIndex={0}
        >
          <div className={`hr-calendar ${mode}`}>
            {["월", "화", "수", "목", "금", "토", "일"].map((x) => (
              <div key={x} className="hr-calendar-weekday">
                {x}
              </div>
            ))}
            {Array.from({ length: n }, (_, i) => {
              const day = addDays(from, i),
                weekend = [0, 6].includes(weekday(day)),
                holiday = holidays.get(day),
                leaves = rows.filter(
                  (r) =>
                    ["pending", "approved"].includes(r.status) &&
                    (!person || r.hr_employee_id === person) &&
                    r.start_date <= day &&
                    r.end_date >= day &&
                    !weekend &&
                    !holiday,
                );
              return (
                <div
                  key={day}
                  className={`hr-day${mode === "month" && day.slice(0, 7) !== month ? " other" : ""}${day === hr.today ? " today" : ""}${holiday ? " holiday" : weekend ? " weekend" : ""}`}
                >
                  <header>
                    <time dateTime={day}>{Number(day.slice(-2))}</time>
                    {holiday ? <small title={holiday}>{holiday}</small> : null}
                  </header>
                  {(mode === "week" || expanded[day]
                    ? leaves
                    : leaves.slice(0, 3)
                  ).map((r) => (
                    <button
                      key={r.id}
                      className={`hr-leave-chip ${r.status}`}
                      onClick={() => onSelect(r)}
                      title={`${names.get(r.hr_employee_id)} ${LEAVE_LABELS[r.leave_type]} ${STATUS_LABELS[r.status]}`}
                    >
                      {names.get(r.hr_employee_id)} ·{" "}
                      {LEAVE_LABELS[r.leave_type]}
                      {r.status === "pending" ? " (대기)" : ""}
                    </button>
                  ))}
                  {mode === "month" && leaves.length > 3 && !expanded[day] ? (
                    <Button
                      onClick={() =>
                        setExpanded((x) => ({ ...x, [day]: true }))
                      }
                    >
                      +{leaves.length - 3}개 더 보기
                    </Button>
                  ) : null}
                  {mode === "week" && !leaves.length ? (
                    <span className="hr-row-small">
                      {holiday ? "쉬는 날" : weekend ? "" : "휴가 없음"}
                    </span>
                  ) : null}
                </div>
              );
            })}
          </div>
        </div>
        <div className="hr-legend">
          <span>실선 = 승인</span>
          <span>점선 = 승인 대기</span>
          <span>공휴일 · 쉬는 날</span>
          <span>반려·취소는 숨김</span>
          <span>주말·공휴일은 차감·휴가 표시 제외</span>
        </div>
      </Panel>
    </>
  );
}
