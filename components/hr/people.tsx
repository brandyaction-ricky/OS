"use client";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { apiRequest } from "@/lib/api-client";
import { useSession } from "../session-provider";
import {
  activeEmployees,
  balance,
  dlabel,
  headcount,
  missingDocuments,
  promotion,
  tenure,
  todos,
  worker,
} from "@/lib/hr/domain";
import {
  CONTRACT_LABELS,
  DOC_LABELS,
  RETIRE_LABELS,
  KIND_LABELS,
  type Employee,
  type HrEvent,
  type HrProfile,
} from "@/lib/hr/types";
import { HR_EVENT_LABELS } from "@/lib/hr/messages";
import { useHr } from "./context";
import { Button, Cards, Empty, Panel, Pill, Table, Tabs } from "./ui";
import type { DrawerState } from "./forms";
import { LedgerRows } from "./ledger";
export type OpenDrawer = (state: DrawerState) => void;
export function EmployeeStatus({ employee }: { employee: Employee }) {
  const { today } = useHr();
  return (
    <Pill
      tone={
        employee.status === "retired" ||
        (employee.retire_date && employee.retire_date < today)
          ? "muted"
          : employee.retire_date || employee.status === "on_leave"
            ? "warn"
            : "good"
      }
    >
      {employee.status === "retired" ||
      (employee.retire_date && employee.retire_date < today)
        ? "퇴사"
        : employee.retire_date
          ? `퇴사 예정 ${employee.retire_date}`
          : employee.status === "on_leave"
            ? "휴직"
            : "재직"}
    </Pill>
  );
}
export function Employees({ open }: { open: OpenDrawer }) {
  const hr = useHr(),
    params = useSearchParams(),
    router = useRouter(),
    path = usePathname();
  const [q, setQ] = useState(params.get("q") || ""),
    [exporting, setExporting] = useState(false),
    [error, setError] = useState("");
  const session = useSession();
  const status = params.get("status") || "active",
    kind = params.get("kind") || "all";
  useEffect(() => {
    setQ(params.get("q") || "");
  }, [params]);
  const change = (key: string, value: string) => {
    const next = new URLSearchParams(params.toString());
    next.set(key, value);
    router.replace(`${path}?${next}`, { scroll: false });
  };
  const count = headcount(hr.data, hr.today),
    employees = activeEmployees(hr.data, hr.today),
    missing = employees.reduce(
      (s, e) => s + missingDocuments(hr.data, e.id).length,
      0,
    ),
    urgent = employees
      .flatMap((e) => todos(hr.data, e, hr.today))
      .filter((x) => x.tone === "danger").length;
  const people = [
    ...hr.data.profiles.map((p) => ({
      id: p.id,
      profile: p,
      employee: hr.data.employees.find((e) => e.profile_id === p.id),
      name: p.display_name,
      kind: p.is_shared_account ? "shared" : p.person_kind || "unset",
    })),
    ...hr.data.employees
      .filter((e) => !e.profile_id)
      .map((e) => ({
        id: e.id,
        profile: undefined,
        employee: e,
        name: e.display_name,
        kind: "employee",
      })),
  ];
  const stateOf = (e?: Employee) =>
    !e
      ? "active"
      : e.status === "retired" || (e.retire_date && e.retire_date < hr.today)
        ? "retired"
        : e.status;
  const withinStatus = people.filter((p) => stateOf(p.employee) === status),
    filtered = withinStatus
      .filter(
        (p) =>
          (kind === "all" || p.kind === kind) &&
          `${p.name} ${(p.profile?.roles || p.employee?.job_roles || []).join(" ")} ${p.profile?.email || p.employee?.email || ""}`
            .toLocaleLowerCase()
            .includes(q.toLocaleLowerCase()),
      )
      .sort(
        (a, b) =>
          ["owner", "employee", "contractor", "shared", "unset"].indexOf(
            a.kind,
          ) -
            ["owner", "employee", "contractor", "shared", "unset"].indexOf(
              b.kind,
            ) || a.name.localeCompare(b.name, "ko"),
      );
  async function exportPeople() {
    setExporting(true);
    setError("");
    try {
      const ids = filtered.flatMap((p) =>
        p.employee && p.kind === "employee" ? [p.employee.id] : [],
      );
      if (hr.demo) {
        hr.toast("체험 모드에서는 실제 명부를 내보내지 않습니다.");
        return;
      }
      const response = await fetch(`/api/v1/hr/export?ids=${ids.join(",")}`, {
        headers: { authorization: `Bearer ${session.accessToken}` },
      });
      if (!response.ok)
        throw new Error(
          "명부를 내보내지 못했습니다. 권한과 연결을 확인해 주세요.",
        );
      const url = URL.createObjectURL(await response.blob()),
        a = document.createElement("a");
      a.href = url;
      a.download = `hr-register-${hr.today}.xlsx`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      hr.toast("명부를 내보냈습니다 · 열람 기록 남음");
    } catch (e) {
      setError(e instanceof Error ? e.message : "내보내기 실패");
    } finally {
      setExporting(false);
    }
  }
  return (
    <>
      <div className="hr-head">
        <div>
          <h1>직원 명부</h1>
          <p>
            OS 계정이 있는 사람과 근로자의 인사 정보를 관리합니다. 퇴사한 기록도
            보존합니다.
          </p>
        </div>
        <div className="hr-actions">
          <Button onClick={exportPeople} disabled={exporting}>
            엑셀로 내보내기
          </Button>
          <Button primary disabled={hr.loading} onClick={() => open({ kind: "new" })}>
            {hr.loading ? "불러오는 중…" : "＋ 직원 등록"}
          </Button>
        </div>
      </div>
      {error ? (
        <div className="hr-banner error" role="alert">
          {error}
        </div>
      ) : null}
      <Cards
        items={[
          {
            label: "재직 근로자",
            value: `${count.count}명`,
            description: "연차·명부 대상",
          },
          {
            label: "상시근로자 판단",
            value: count.label,
            description: `${count.boundary ? "경계선 · " : ""}법정 산정은 노무사 확인`,
            tone: count.unset ? "warn" : "",
          },
          {
            label: "급한 할 일",
            value: urgent,
            description: "촉진 기한 · 빠진 서류",
            tone: urgent ? "danger" : "",
          },
          {
            label: "빠진 서류",
            value: missing,
            description: <Link href="/hr/documents">서류·계약에서 보기</Link>,
          },
        ]}
      />
      <div className="hr-toolbar">
        <div className="hr-filter-chips">
          {[
            ["active", "재직"],
            ["on_leave", "휴직"],
            ["retired", "퇴사"],
          ].map(([v, l]) => (
            <Button
              key={v}
              aria-pressed={status === v}
              onClick={() => change("status", v)}
            >
              {l} {people.filter((p) => stateOf(p.employee) === v).length}
            </Button>
          ))}
        </div>
        <div className="hr-filter-chips">
          {[
            ["all", "전체"],
            ...Object.entries(KIND_LABELS),
            ["unset", "구분 미설정"],
          ].map(([v, l]) => (
            <Button
              key={v}
              aria-pressed={kind === v}
              onClick={() => change("kind", v)}
            >
              {l}{" "}
              {withinStatus.filter((p) => v === "all" || p.kind === v).length}
            </Button>
          ))}
        </div>
        <input
          aria-label="이름·맡은 일·이메일 찾기"
          placeholder="이름·맡은 일·이메일"
          value={q}
          onChange={(x) => {
            setQ(x.target.value);
            change("q", x.target.value);
          }}
        />
      </div>
      <Panel>
        {filtered.length ? (
          <Table
            head={[
              "이름",
              "고용형태",
              "맡은 일",
              "입사일",
              "근속",
              "연차 잔여",
              "서류",
              "계정",
              "다음 할 일",
            ]}
          >
            {filtered.map(({ id, profile: p, employee: e, name, kind }) => {
              const c = hr.data.contracts.find(
                  (c) => c.hr_employee_id === e?.id && c.is_current,
                ),
                isWorker = e && worker(hr.data, e),
                miss = isWorker ? missingDocuments(hr.data, e.id) : [];
              return (
                <tr
                  key={id}
                  className="hr-clickable-row"
                  onClick={(event) => {
                    if ((event.target as HTMLElement).closest("a, button")) return;
                    router.push(`/hr/employees/${id}`);
                  }}
                >
                  <td>
                    <Link href={`/hr/employees/${id}`} className="hr-name">
                      <span className="hr-avatar">{name.slice(0, 1)}</span>
                      <span>
                        {name}
                        <small>
                          {KIND_LABELS[kind as keyof typeof KIND_LABELS] ||
                            "구분 미설정"}
                          {p?.affiliation ? ` · ${p.affiliation}` : ""}
                        </small>
                        {e && e.status !== "active" ? (
                          <EmployeeStatus employee={e} />
                        ) : null}
                      </span>
                    </Link>
                  </td>
                  <td>
                    {isWorker && c ? (
                      <>
                        {CONTRACT_LABELS[c.contract_type]}
                        <small>{c.end_date || "기간 정함 없음"}</small>
                      </>
                    ) : (
                      "—"
                    )}
                  </td>
                  <td>
                    {(p?.roles || e?.job_roles || []).slice(0, 2).map((r) => (
                      <Pill key={r}>{r}</Pill>
                    ))}
                  </td>
                  <td>{isWorker ? e.hire_date : "—"}</td>
                  <td>{isWorker ? tenure(e.hire_date, hr.today) : "—"}</td>
                  <td>
                    {isWorker ? (
                      <b>
                        {e.hire_date > hr.today
                          ? "입사 전"
                          : `${balance(hr.data, e, hr.today).left}일`}
                      </b>
                    ) : (
                      "비대상"
                    )}
                  </td>
                  <td>
                    {isWorker ? (
                      <Pill tone={miss.length ? "danger" : "good"}>
                        {miss.length ? `${miss.length}개 빠짐` : "완비"}
                      </Pill>
                    ) : (
                      "—"
                    )}
                  </td>
                  <td>
                    <Pill tone={p?.is_active ? "good" : "muted"}>
                      {!p ? "계정 없음" : p.is_active ? "사용 중" : "중지"}
                    </Pill>
                    {p ? (
                      <small>
                        {p.role === "admin"
                          ? "관리자"
                          : p.role === "lead"
                            ? "리드"
                            : "구성원"}
                        {p.finance_access ? " · 민감정보" : ""}
                      </small>
                    ) : null}
                  </td>
                  <td>
                    <div className="hr-todos vertical">
                      {isWorker
                        ? todos(hr.data, e, hr.today)
                            .slice(0, 2)
                            .map((x) => (
                              <Pill key={x.text} tone={x.tone}>
                                {x.text}
                              </Pill>
                            ))
                        : "—"}
                    </div>
                  </td>
                </tr>
              );
            })}
          </Table>
        ) : (
          <Empty
            title={
              q
                ? "찾는 사람이 없습니다"
                : status === "retired"
                  ? "퇴사한 사람이 없습니다"
                  : status === "on_leave"
                    ? "휴직 중인 사람이 없습니다"
                    : "재직 중인 사람이 없습니다"
            }
          >
            {q
              ? "이름이나 맡은 일을 다르게 적어 보세요."
              : status === "retired"
                ? "퇴사 처리한 사람은 여기 남고, 퇴사일로부터 3년 되는 날 파기 알림이 옵니다."
                : status === "on_leave"
                  ? "인사카드 › 정보 수정에서 휴직 기간을 넣으면 여기 보입니다."
                  : "직원 등록으로 사람을 추가해 주세요."}
          </Empty>
        )}
      </Panel>
      <p className="hr-muted">
        상시근로자 수는 현재 근로자 인원으로 추정합니다. 사업주·외부 협업·공용
        계정은 연차·명부 대상에서 빠집니다.
      </p>
      {hr.admin ? (
        <p>
          <Link href="/hr/employees?migrate=1">기존 자료 검토·이관</Link>
        </p>
      ) : null}
    </>
  );
}
export function PersonCard({ id, open }: { id: string; open: OpenDrawer }) {
  const hr = useHr(),
    params = useSearchParams(),
    e = hr.data.employees.find((e) => e.id === id || e.profile_id === id),
    p = hr.data.profiles.find((p) => p.id === id || p.id === e?.profile_id),
    isWorker = e && worker(hr.data, e),
    tab = params.get("tab") || "basic";
  const [revealed, setRevealed] = useState<Record<string, string>>({}),
    [error, setError] = useState(""),
    [revealing, setRevealing] = useState("");
  const name = p?.display_name || e?.display_name || "",
    kind = p?.is_shared_account
      ? "shared"
      : p?.person_kind || (p ? null : "employee"),
    c = hr.data.contracts.find(
      (c) => c.hr_employee_id === e?.id && c.is_current,
    );
  useEffect(() => {
    if (!name) return;
    document.title = `${name} · 직원 명부 | 브랜디 OS`;
  }, [name]);
  if (!e && !p)
    return (
      <Empty title="사람을 찾지 못했습니다">
        <Link href="/hr/employees">직원 명부로 돌아가기</Link>
      </Empty>
    );
  async function reveal(field: string) {
    if (!e) return;
    setRevealing(field);
    setError("");
    try {
      const values = await hr.save<Record<string, string>>(
        `people/${id}/reveal`,
        { fields: [field] },
      );
      setRevealed((x) => ({ ...x, ...values }));
    } catch (e) {
      setError(e instanceof Error ? e.message : "열람하지 못했습니다.");
    } finally {
      setRevealing("");
    }
  }
  const sensitive = (field: string, current: string | null) =>
    revealed[field] || (
      <>
        {current || "미등록"}{" "}
        {current ? (
          <Button
            disabled={!!revealing}
            onClick={() => reveal(field)}
            aria-label={`${({ legal_name: "실명", birth_date: "생년월일", phone: "연락처", address: "주소" } as Record<string, string>)[field]} 보기`}
          >
            보기
          </Button>
        ) : null}
        {current ? <small className="hr-muted"> 열람 기록 남음</small> : null}
      </>
    );
  return (
    <>
      <p>
        <Link href="/hr/employees">인사 노무 관리 › 직원 명부</Link> › {name}
      </p>
      <div className="hr-head">
        <div>
          <h1>
            <span className="hr-avatar">{name.slice(0, 1)}</span> {name}{" "}
            {e ? <EmployeeStatus employee={e} /> : null}{" "}
            <Pill>{(kind ? KIND_LABELS[kind] : null) || "구분 미설정"}</Pill>
          </h1>
          <p>
            {(p?.roles || e?.job_roles || []).join(" · ")}
            {isWorker
              ? `${(p?.roles || e?.job_roles || []).length ? " · " : ""}입사 ${e.hire_date} · ${tenure(e.hire_date, hr.today)}`
              : ""}
          </p>
        </div>
        <div className="hr-actions">
          <Button
            onClick={() => open({ kind: "edit", employee: e, profile: p })}
          >
            정보 수정
          </Button>
          {isWorker && e.status !== "retired" ? (
            <Button
              danger
              onClick={() => open({ kind: "retire", employee: e, profile: p })}
            >
              {e.retire_date ? "퇴사 처리 보기" : "퇴사 처리"}
            </Button>
          ) : null}
        </div>
      </div>
      <Tabs
        current={tab}
        items={
          isWorker
            ? [
                ["basic", "기본 정보"],
                ["work", "근로 조건"],
                ["account", "계정·권한"],
                ["leave", "연차"],
                ["docs", "서류"],
                ["log", "변경 이력"],
              ]
            : [
                ["basic", "기본 정보"],
                ["account", "계정·권한"],
                ["log", "변경 이력"],
              ]
        }
      />
      {error ? (
        <div role="alert" className="hr-banner error">
          {error}
        </div>
      ) : null}
      {tab === "basic" ? (
        <div className="hr-grid2">
          <Panel title={isWorker ? "근로자 명부 항목" : "기본 정보"}>
            <div className="hr-body">
              <dl className="hr-detail-list">
                {isWorker ? (
                  <>
                    <dt>성명 (실명)</dt>
                    <dd>{sensitive("legal_name", e.legal_name)}</dd>
                  </>
                ) : null}
                <dt>표시 이름</dt>
                <dd>{name}</dd>
                <dt>구분</dt>
                <dd>{(kind ? KIND_LABELS[kind] : null) || "구분 미설정"}</dd>
                {isWorker ? (
                  <>
                    <dt>성별</dt>
                    <dd>
                      {e.gender === "M"
                        ? "남"
                        : e.gender === "F"
                          ? "여"
                          : e.gender === "X"
                            ? "기타"
                            : "미등록"}
                    </dd>
                    <dt>생년월일</dt>
                    <dd>{sensitive("birth_date", e.birth_date)}</dd>
                    <dt>주소</dt>
                    <dd>{sensitive("address", e.address)}</dd>
                    <dt>이력</dt>
                    <dd>{e.career_summary || "미등록"}</dd>
                    <dt>업무 종류</dt>
                    <dd>{e.job_roles.join(", ") || "미등록"}</dd>
                    <dt>고용일</dt>
                    <dd>{e.hire_date}</dd>
                    <dt>계약 기간</dt>
                    <dd>
                      {c
                        ? `${c.start_date} ~ ${c.end_date || "기간 정함 없음"}`
                        : "미등록"}
                    </dd>
                    <dt>퇴직일·사유</dt>
                    <dd>
                      {e.retire_date
                        ? `${e.retire_date} · ${RETIRE_LABELS[e.retire_reason || ""] || e.retire_reason || "—"}`
                        : "—"}
                    </dd>
                  </>
                ) : (
                  <>
                    <dt>소속</dt>
                    <dd>{p?.affiliation || "—"}</dd>
                    <dt>맡은 일</dt>
                    <dd>{p?.roles.join(", ") || "—"}</dd>
                  </>
                )}
              </dl>
            </div>
            <div className="hr-foot">
              {kind === null ? (
                <span className="hr-banner warning">
                  구분이 정해지지 않았습니다 — 근로자면 입사일·근로 조건을 입력해 주세요.{" "}
                  <Button onClick={() => open({ kind: "edit", employee: e, profile: p })}>
                    구분 정하기
                  </Button>
                </span>
              ) : isWorker
                ? "주민등록번호는 OS에 저장하지 않습니다. 4대보험 신고는 세무사·공단 시스템에서 합니다."
                : kind === "shared"
                  ? "공용 계정은 사람이 아니어서 인원·연차·명부에서 빠집니다."
                  : kind === "owner"
                    ? "사업주는 근로자 명부·연차 대상이 아닙니다."
                    : "외부 협업은 근로계약이 아니므로 명부·연차 대상이 아닙니다."}
            </div>
          </Panel>
          <div>
            <Panel title="연락">
              <div className="hr-body">
                <dl className="hr-detail-list">
                  {isWorker ? (
                    <>
                      <dt>연락처</dt>
                      <dd>{sensitive("phone", e.phone)}</dd>
                      <dt>비상연락처</dt>
                      <dd className={!e.emergency_contact ? "hr-danger" : ""}>
                        {e.emergency_contact || "미등록"}
                      </dd>
                    </>
                  ) : null}
                  <dt>로그인 이메일</dt>
                  <dd>{p?.email || e?.email || "계정 없음"}</dd>
                </dl>
              </div>
            </Panel>
            {isWorker ? (
              <Panel title="다음 할 일">
                <div className="hr-body hr-todos vertical">
                  {todos(hr.data, e, hr.today).map((t) => (
                    <Pill key={t.text} tone={t.tone}>
                      {t.text}
                    </Pill>
                  ))}
                </div>
              </Panel>
            ) : null}
          </div>
        </div>
      ) : null}
      {tab === "work" && isWorker ? (
        <>
          <Panel
            title="현재 계약"
            extra={
              <Button
                onClick={() =>
                  open({ kind: "contract", employee: e, profile: p })
                }
              >
                근로 조건 변경
              </Button>
            }
          >
            <div className="hr-body">
              <dl className="hr-detail-list">
                <dt>고용형태</dt>
                <dd>{c ? CONTRACT_LABELS[c.contract_type] : "미등록"}</dd>
                <dt>계약 기간</dt>
                <dd>
                  {c
                    ? `${c.start_date} ~ ${c.end_date || "기간 정함 없음"}`
                    : "—"}
                </dd>
                <dt>수습</dt>
                <dd>
                  {c?.probation_end
                    ? c.probation_end < hr.today
                      ? "끝남"
                      : `${c.probation_end} · ${dlabel(c.probation_end, hr.today)}`
                    : "없음"}
                </dd>
                <dt>소정근로시간</dt>
                <dd>
                  주 {c?.weekly_hours || 0}시간 · {c?.work_days}
                </dd>
                <dt>근무 시간·장소</dt>
                <dd>
                  {c?.work_time || "미등록"} · {c?.workplace || "미등록"}
                </dd>
                <dt>휴일</dt>
                <dd>주휴일 일요일 · 등록된 관공서 공휴일</dd>
                <dt>연차 기준</dt>
                <dd>
                  입사일 기준 ·{" "}
                  <Link href="/hr/leave-ledger?tab=rules">부여 규칙</Link>
                </dd>
              </dl>
              <p className="hr-banner">급여·수당은 재무관리에서 확인합니다.</p>
            </div>
          </Panel>
          <Panel title="계약 이력">
            <Table
              head={[
                "적용 시작",
                "계약 끝",
                "고용형태",
                "근로시간",
                "수습 끝",
                "상태",
                "이유",
              ]}
            >
              {hr.data.contracts
                .filter((c) => c.hr_employee_id === e.id)
                .sort((a, b) => b.start_date.localeCompare(a.start_date))
                .map((c) => (
                  <tr key={c.id}>
                    <td>{c.start_date}</td>
                    <td>{c.end_date || "기간 정함 없음"}</td>
                    <td>{CONTRACT_LABELS[c.contract_type]}</td>
                    <td>주 {c.weekly_hours}시간</td>
                    <td>{c.probation_end || "—"}</td>
                    <td>
                      <Pill tone={c.is_current ? "good" : "muted"}>
                        {c.is_current ? "유효" : "지난 계약"}
                      </Pill>
                    </td>
                    <td>{c.reason}</td>
                  </tr>
                ))}
            </Table>
          </Panel>
        </>
      ) : null}
      {tab === "account" ? <AccountPanel employee={e} profile={p} /> : null}
      {tab === "leave" && isWorker ? (
        <>
          <Cards
            items={[
              {
                label: "이번 기간",
                value: balance(hr.data, e, hr.today).period.first
                  ? "1년 미만"
                  : "입사일 기준",
                description: `${balance(hr.data, e, hr.today).period.start} ~ ${balance(hr.data, e, hr.today).period.end}`,
              },
              {
                label: "발생 + 조정",
                value: `${balance(hr.data, e, hr.today).accrued + balance(hr.data, e, hr.today).adjustment}일`,
                description: "자동 발생 · 수동 조정",
              },
              {
                label: "남은 연차",
                value: `${balance(hr.data, e, hr.today).left}일`,
                description: `사용 ${balance(hr.data, e, hr.today).used} · 승인 예정 ${balance(hr.data, e, hr.today).scheduled} · 대기 ${balance(hr.data, e, hr.today).pending}`,
              },
              {
                label: "사용 촉진",
                value: (
                  <Pill tone="warn">
                    {promotion(hr.data, e, hr.today).text}
                  </Pill>
                ),
                description: (
                  <Link href="/hr/leave-ledger?tab=promo">촉진 보기</Link>
                ),
              },
            ]}
          />
          <div className="hr-toolbar">
            <Button
              primary
              onClick={() => open({ kind: "leave", employee: e })}
            >
              ＋ 휴가 입력
            </Button>
            <Link href="/hr/leave-ledger">연차 원장 →</Link>
          </div>
          <LedgerRows employee={e} open={open} />
        </>
      ) : null}
      {tab === "docs" && isWorker ? (
        <PersonDocuments employee={e} open={open} />
      ) : null}
      {tab === "log" ? <History id={id} /> : null}
    </>
  );
}
export function PersonDocuments({
  employee: e,
  open,
}: {
  employee: Employee;
  open: OpenDrawer;
}) {
  const hr = useHr();
  return (
    <Panel title="서류 6종">
      <Table head={["서류", "상태", "날짜", "처리한 사람", "처리"]}>
        {hr.data.documents
          .filter((d) => d.hr_employee_id === e.id)
          .map((d) => (
            <tr key={d.id}>
              <td>{DOC_LABELS[d.doc_kind]}</td>
              <td>
                <Pill tone={d.status === "done" ? "good" : "danger"}>
                  {d.status === "done" ? "완료" : "빠짐"}
                </Pill>
              </td>
              <td>{d.done_date || "—"}</td>
              <td>
                {hr.data.profiles.find((p) => p.id === d.updated_by)
                  ?.display_name || "—"}
              </td>
              <td>
                <div className="hr-actions">
                  {d.file_path ? (
                    <Button
                      onClick={() =>
                        void hr
                          .openFile(d.file_path!)
                          .catch((e) => hr.toast(e.message))
                      }
                    >
                      보기
                    </Button>
                  ) : null}
                  <Button
                    onClick={() =>
                      open({ kind: "document", employee: e, document: d })
                    }
                  >
                    처리
                  </Button>
                </div>
              </td>
            </tr>
          ))}
      </Table>
    </Panel>
  );
}
function AccountPanel({
  employee: e,
  profile: p,
}: {
  employee?: Employee;
  profile?: HrProfile;
}) {
  const hr = useHr(),
    session = useSession();
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [reset, setReset] = useState(false);
  async function change(account: Record<string, unknown>) {
    if (!p) return;
    setBusy(true);
    setError("");
    try {
      await hr.save(
        `people/${p.id}/account`,
        { account, updated_at: p.updated_at },
        "PATCH",
      );
      hr.toast("계정 설정을 저장했습니다");
    } catch (e) {
      setError(e instanceof Error ? e.message : "저장 실패");
    } finally {
      setBusy(false);
    }
  }
  async function issue() {
    if (!e) return;
    setBusy(true);
    setError("");
    try {
      await hr.save(`people/${e.id}/account`, { version: e.version });
      hr.toast("로그인 계정을 발급했습니다");
    } catch (e) {
      setError(e instanceof Error ? e.message : "발급 실패");
    } finally {
      setBusy(false);
    }
  }
  async function passwordReset() {
    if (!p) return;
    setBusy(true);
    setError("");
    try {
      if (!hr.demo)
        await apiRequest(`/api/v1/members/${p.id}/password-reset`, {
          method: "POST",
          token: session.accessToken,
          body: JSON.stringify({}),
        });
      hr.toast(
        hr.demo
          ? "체험 모드 · 비밀번호는 바뀌지 않았습니다"
          : "비밀번호를 초기화했습니다",
      );
      setReset(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : "초기화 실패");
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <div role="alert">
        {error ? <p className="hr-banner error">{error}</p> : null}
      </div>
      {!hr.admin ? (
        <p className="hr-banner">계정·권한은 관리자만 바꿉니다.</p>
      ) : null}
      <div className="hr-grid2">
        <Panel title="계정·권한">
          <div className="hr-body">
            {p ? (
              <>
                <dl className="hr-detail-list">
                  <dt>로그인 이메일</dt>
                  <dd>{p.email}</dd>
                  <dt>접근 역할</dt>
                  <dd>
                    <select
                      aria-label="접근 역할"
                      value={p.role}
                      disabled={!hr.admin || busy || p.id === hr.actorId}
                      onChange={(x) => change({ role: x.target.value })}
                    >
                      <option value="member">구성원</option>
                      <option value="lead">리드</option>
                      <option value="admin">관리자</option>
                    </select>
                  </dd>
                  <dt>민감정보 접근</dt>
                  <dd>
                    <label>
                      <input
                        type="checkbox"
                        checked={p.finance_access}
                        disabled={!hr.admin || busy}
                        onChange={(x) =>
                          change({ finance_access: x.target.checked })
                        }
                      />{" "}
                      경영지원 민감정보 접근
                    </label>
                  </dd>
                  <dt>공용 계정</dt>
                  <dd>
                    {p.is_shared_account ? "공용 계정" : "개인 계정"} · 구분에서
                    관리
                  </dd>
                  <dt>계정 사용</dt>
                  <dd>
                    <label>
                      <input
                        type="checkbox"
                        checked={p.is_active}
                        disabled={!hr.admin || busy || p.id === hr.actorId}
                        onChange={(x) =>
                          change({ is_active: x.target.checked })
                        }
                      />{" "}
                      사용 허용
                    </label>
                  </dd>
                  <dt>비밀번호</dt>
                  <dd>
                    {p.id === hr.actorId ? (
                      "본인은 상단 프로필에서 변경"
                    ) : (
                      <Button
                        disabled={!hr.admin || busy}
                        onClick={() => setReset(true)}
                      >
                        처음 비밀번호로 초기화
                      </Button>
                    )}
                  </dd>
                  <dt>메뉴 권한</dt>
                  <dd>
                    <Link href="/settings/access">권한·접근 키에서 관리 →</Link>
                  </dd>
                </dl>
                {reset ? (
                  <div className="hr-banner">
                    <p>
                      이 계정의 비밀번호를 처음 비밀번호로 초기화합니다. 다음
                      로그인 때 변경해야 합니다.
                    </p>
                    <Button danger disabled={busy} onClick={passwordReset}>
                      초기화 확인
                    </Button>{" "}
                    <Button onClick={() => setReset(false)}>취소</Button>
                  </div>
                ) : null}
              </>
            ) : (
              <>
                <p className="hr-banner">
                  로그인 계정이 없습니다. 실명과 이메일로 처음 비밀번호 계정을
                  발급합니다.
                </p>
                <p>
                  {e?.email || "정보 수정에서 발급할 이메일을 먼저 등록하세요."}
                </p>
                <Button
                  primary
                  disabled={!hr.admin || busy || !e?.email}
                  onClick={issue}
                >
                  계정 발급
                </Button>
              </>
            )}
          </div>
        </Panel>
        <Panel title="온보딩 체크">
          <div className="hr-body">
            {[
              ["account", "OS 계정"],
              ["role", "역할·권한"],
              ["knowledge", "정본 검색"],
              ["workflow", "업무 흐름"],
            ].map(([k, l]) => (
              <label className="hr-check" key={k}>
                <input
                  type="checkbox"
                  checked={!!p?.onboarding[k]}
                  disabled={!p || !hr.admin || busy}
                  onChange={(x) =>
                    change({
                      onboarding: { ...p?.onboarding, [k]: x.target.checked },
                    })
                  }
                />
                {l}
              </label>
            ))}
          </div>
        </Panel>
      </div>
    </>
  );
}
function History({ id }: { id: string }) {
  const hr = useHr(),
    read = useRef(hr.read);
  read.current = hr.read;
  const [rows, setRows] = useState<HrEvent[]>([]),
    [error, setError] = useState("");
  useEffect(() => {
    let current = true;
    read
      .current<{ rows: HrEvent[] }>(`people/${id}/history`)
      .then((x) => {
        if (current) setRows(x.rows);
      })
      .catch((e) => {
        if (current) setError(e.message);
      });
    return () => {
      current = false;
    };
  }, [id, hr.data.events]);
  return (
    <Panel title="변경 이력">
      {error ? (
        <p className="hr-banner error" role="alert">
          {error}
        </p>
      ) : rows.length ? (
        <Table head={["날짜", "누가", "무엇", "사유"]}>
          {rows.map((r) => (
            <tr key={r.id}>
              <td>
                {new Date(r.created_at).toLocaleString("ko-KR", {
                  timeZone: "Asia/Seoul",
                })}
              </td>
              <td>
                {hr.data.profiles.find((p) => p.id === r.actor)?.display_name ||
                  "시스템"}
              </td>
              <td>
                {HR_EVENT_LABELS[r.action] || "인사 기록"}
                {typeof r.detail.previousPath === "string" ? (
                  <Button
                    onClick={() =>
                      void hr
                        .openFile(r.detail.previousPath as string)
                        .catch((e) => hr.toast(e.message))
                    }
                  >
                    이전 파일
                  </Button>
                ) : null}
                {Array.isArray(r.detail.documents)
                  ? r.detail.documents.map(
                      (doc: {
                        id: string;
                        file_path?: string;
                        doc_kind: string;
                      }) =>
                        doc.file_path ? (
                          <Button
                            key={doc.id}
                            onClick={() =>
                              void hr
                                .openFile(doc.file_path!)
                                .catch((e) => hr.toast(e.message))
                            }
                          >
                            {DOC_LABELS[
                              doc.doc_kind as keyof typeof DOC_LABELS
                            ] || "이전 서류"}{" "}
                            보기
                          </Button>
                        ) : null,
                    )
                  : null}
              </td>
              <td>{r.reason || "—"}</td>
            </tr>
          ))}
        </Table>
      ) : (
        <Empty title="변경 이력이 없습니다">정보를 바꾸면 여기 쌓입니다.</Empty>
      )}
    </Panel>
  );
}
