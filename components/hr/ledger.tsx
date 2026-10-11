"use client";
import Link from "next/link";
import { useState } from "react";
import { useSearchParams } from "next/navigation";
import {
  activeEmployees,
  balance,
  dlabel,
  ledger,
  promotion,
  shortDate,
} from "@/lib/hr/domain";
import type { Employee } from "@/lib/hr/types";
import { useHr } from "./context";
import { Button, Cards, Empty, Field, Panel, Pill, Table, Tabs } from "./ui";
import type { OpenDrawer } from "./people";
import { MissingWorkersMessage } from "./notices";

export function LedgerRows({
  employee,
  open,
}: {
  employee: Employee;
  open?: OpenDrawer;
}) {
  const hr = useHr(),
    rows = ledger(hr.data, employee, hr.today);
  return (
    <Panel
      title="연차 원장"
      extra={
        open ? (
          <Button onClick={() => open({ kind: "credit", employee })}>
            ＋ 수동 조정
          </Button>
        ) : undefined
      }
    >
      <Table head={["날짜", "구분", "일수", "잔여", "사유"]}>
        {rows.map((r) => (
          <tr key={r.id}>
            <td>{r.date}</td>
            <td>
              <Pill
                tone={
                  r.future ? "muted" : r.days && r.days < 0 ? "warn" : "good"
                }
              >
                {r.future ? "예정 · " : ""}
                {r.kind}
              </Pill>
            </td>
            <td>
              {r.days === null ? "—" : `${r.days > 0 ? "+" : ""}${r.days}`}
            </td>
            <td>{r.running ?? "—"}</td>
            <td className="hr-row-small">{r.reason}</td>
          </tr>
        ))}
      </Table>
      <div className="hr-foot">
        자동 발생은 출근율을 충족했다고 가정합니다. 출근율 확인 후 필요한 차이는
        수동 조정으로 남겨 주세요. 승인 대기는 잔여에서 차감하지 않습니다.
      </div>
    </Panel>
  );
}
export function LeaveLedger({ open }: { open: OpenDrawer }) {
  const hr = useHr(),
    params = useSearchParams(),
    tab = params.get("tab") || "balances",
    people = activeEmployees(hr.data, hr.today);
  const [selected, setSelected] = useState(""),
    [settle, setSettle] = useState(""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const rows = people.map((e) => ({
    e,
    b: balance(hr.data, e, hr.today),
    p: promotion(hr.data, e, hr.today),
  }));
  const monthDay = (day: string) => `${Number(day.slice(5, 7))}/${Number(day.slice(8, 10))}`;
  const chosen = people.find((e) => e.id === selected);
  async function markSettlement(id: string) {
    setBusy(true);
    setError("");
    try {
      await hr.save("leave-promotions/settlement", { employee: id });
      setSettle("");
      hr.toast("수당 정산 확인을 기록했습니다");
    } catch (e) {
      setError(e instanceof Error ? e.message : "저장 실패");
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <div className="hr-head">
        <div>
          <h1>연차 원장·촉진</h1>
          <p>입사일 기준 잔여·원장과 사용 촉진 기한을 확인합니다.</p>
        </div>
        <Button
          primary
          onClick={() => open({ kind: "leave" })}
          disabled={!people.length}
        >
          ＋ 휴가 입력
        </Button>
      </div>
      <Tabs
        current={tab}
        items={[
          ["balances", "잔여·원장"],
          ["promo", "사용 촉진"],
          ["rules", "부여 규칙·공휴일"],
        ]}
      />
      {error ? (
        <p role="alert" className="hr-banner error">
          {error}
        </p>
      ) : null}
      {tab === "balances" ? (
        <>
          <Cards
            items={[
              {
                label: "연차 대상",
                value: `${people.length}명`,
                description: "재직 · 휴직 근로자",
              },
              {
                label: "이번 달 소멸 예정",
                value: `${rows.filter((r) => r.b.left > 0 && r.b.period.end.slice(0, 7) === hr.today.slice(0, 7)).length}명`,
                description: "남은 연차가 있는 사람",
              },
              {
                label: "촉진 서면 보낼 사람",
                value: `${rows.filter((r) => r.p.action || r.p.extra?.action).length}명`,
                description: <Link href="/hr/leave-ledger?tab=promo">사용 촉진에서 보기</Link>,
              },
              {
                label: "승인 대기",
                value: `${rows.reduce((s, r) => s + r.b.pending, 0)}일`,
                description: "아직 차감하지 않음",
              },
            ]}
          />
          <Panel title="이번 연차 기간">
            {rows.length ? (
              <Table
                head={[
                  "이름",
                  "사용 기간",
                  "발생",
                  "조정",
                  "사용",
                  "예정",
                  "대기",
                  "잔여",
                  "소멸",
                  "촉진",
                  "원장",
                ]}
              >
                {rows.map(({ e, b, p }) => (
                  <tr
                    key={e.id}
                    className={selected === e.id ? "selected" : ""}
                  >
                    <td>
                      <Link
                        href={`/hr/employees/${e.profile_id || e.id}?tab=leave`}
                      >
                        {e.display_name}
                      </Link>
                    </td>
                    <td>
                      {shortDate(b.period.start)} ~ {shortDate(b.period.end)}
                      <small>
                        {b.period.first ? "1년 미만 · 월 개근" : "입사일 기준"}
                      </small>
                    </td>
                    <td>{b.accrued}</td>
                    <td>
                      {b.adjustment > 0 ? "+" : ""}
                      {b.adjustment}
                    </td>
                    <td>{b.used}</td>
                    <td>{b.scheduled}</td>
                    <td>{b.pending}</td>
                    <td>
                      <b>{b.left}일</b>
                    </td>
                    <td>{b.left > 0 ? <Pill tone={b.period.end.slice(0, 7) === hr.today.slice(0, 7) ? "warn" : "muted"}>{dlabel(b.period.end, hr.today)}</Pill> : "—"}</td>
                    <td><Pill tone={p.rank <= 1 ? "danger" : p.action || p.extra?.action ? "warn" : "muted"}>{p.text}</Pill></td>
                    <td>
                      <Button
                        aria-expanded={selected === e.id}
                        onClick={() =>
                          setSelected(selected === e.id ? "" : e.id)
                        }
                      >
                        {selected === e.id ? "접기" : "원장 보기"}
                      </Button>
                    </td>
                  </tr>
                ))}
              </Table>
            ) : (
              <Empty title="연차 대상 근로자가 없습니다">
                <MissingWorkersMessage />
              </Empty>
            )}
          </Panel>
          {chosen ? <LedgerRows employee={chosen} open={open} /> : null}
        </>
      ) : null}
      {tab === "promo" ? (
        <>
          <Cards
            items={[
              {
                label: "지금 보낼 서면",
                value: rows.filter((r) => r.p.action || r.p.extra?.action)
                  .length,
                description: "1차 촉구 · 2차 지정",
              },
              {
                label: "회신 대기",
                value: rows.filter((r) => r.p.rank === 3).length,
                description: "서면 받은 날부터 10일",
              },
              {
                label: "기한 지남",
                value: rows.filter((r) => r.p.rank === 1 && !r.p.settled)
                  .length,
                description: "노무사 확인 · 수당 정산",
                tone: "danger",
              },
              {
                label: "지정 통보 완료",
                value: rows.filter((r) => r.p.rank === 5).length,
                description: "사용일에 노무수령 거부 확인",
              },
            ]}
          />
          <div className="hr-banner">
            촉진 기한은 자동 계산합니다. 적법한 서면·전달·노무수령 거부 여부는
            별도 확인해야 합니다. 알림이나 계획 회신만으로 휴가가 승인되지는
            않습니다.
          </div>
          <Panel title="할 일 순서">
            {rows.length ? (
              <Table
                head={[
                  "이름 · 기간",
                  "잔여",
                  "1차 촉구",
                  "회신",
                  "2차 지정",
                  "지금 할 일",
                ]}
              >
                {[...rows]
                  .sort(
                    (a, b) =>
                      a.p.rank - b.p.rank ||
                      (a.p.due || "9999").localeCompare(b.p.due || "9999"),
                  )
                  .map(({ e, b, p }) => (
                    <tr key={e.id}>
                      <td>
                        <Link
                          href={`/hr/employees/${e.profile_id || e.id}?tab=leave`}
                        >
                          {e.display_name}
                        </Link>
                        <small>
                          {shortDate(b.period.start)} ~{" "}
                          {shortDate(b.period.end)}
                        </small>
                        {p.extra ? (
                          <small>
                            추가 발생 {p.extra.days}일 ·{" "}
                            {p.extra.dates.map(shortDate).join(", ")}
                          </small>
                        ) : null}
                      </td>
                      <td>
                        <b>{b.left}일</b>
                      </td>
                      <td>
                        {p.one ? (
                          <Pill tone="good">서면 기록</Pill>
                        ) : (
                          <>
                            {shortDate(p.firstStart)} ~ {shortDate(p.firstEnd)}
                          </>
                        )}
                        {p.one ? (
                          <small>
                            {p.one.read_at ? "열람 확인" : "미열람"} ·{" "}
                            {p.one.channel === "paper"
                              ? "종이 서면"
                              : "OS 알림"}
                          </small>
                        ) : null}
                      </td>
                      <td>
                        {p.one?.reply_at ? (
                          <Pill tone="good">{p.one.reply_days}일 회신 · {monthDay(p.one.reply_at.slice(0, 10))}</Pill>
                        ) : p.replyDue && p.replyDue < hr.today ? (
                          <Pill tone="danger">회신 없음 · {monthDay(p.replyDue)} 기한 지남</Pill>
                        ) : p.replyDue ? (
                          <>
                            {shortDate(p.replyDue)}까지
                            <small>{dlabel(p.replyDue, hr.today)}</small>
                          </>
                        ) : (
                          "—"
                        )}
                      </td>
                      <td>
                        {p.two ? (
                          <Pill tone="good">지정 완료</Pill>
                        ) : (
                          <>
                            {shortDate(p.secondDue)}까지
                            <small>지정 대상 {p.target}일</small>
                          </>
                        )}
                      </td>
                      <td>
                        <div className="hr-todos vertical">
                          <Pill
                            tone={
                              p.rank < 2
                                ? "danger"
                                : p.action
                                  ? "warn"
                                  : "muted"
                            }
                          >
                            {p.text}
                          </Pill>
                          {p.action ? (
                            <Button
                              primary
                              onClick={() =>
                                open({
                                  kind: "promotion",
                                  employee: e,
                                  step: p.action!,
                                })
                              }
                            >
                              {p.action === "notice_1"
                                ? "1차 촉구 보내기"
                                : "2차 지정 보내기"}
                            </Button>
                          ) : null}
                          {p.extra ? (
                            <>
                              <span className="hr-row-small">
                                {p.extra.text}
                              </span>
                              {p.extra.action ? (
                                <Button
                                  onClick={() =>
                                    open({
                                      kind: "promotion",
                                      employee: e,
                                      step: p.extra!.action!,
                                    })
                                  }
                                >
                                  추가분 서면 보내기
                                </Button>
                              ) : null}
                            </>
                          ) : null}
                          {p.rank === 1 && !p.settled ? (
                            <Button onClick={() => setSettle(e.id)}>
                              수당 정산 확인
                            </Button>
                          ) : p.settled ? (
                            <Pill tone="good">수당 정산 확인됨</Pill>
                          ) : null}
                          {settle === e.id ? (
                            <div className="hr-banner">
                              <p>
                                미사용 수당 정산을 확인했습니까? 금액
                                계산·지급은 별도입니다.
                              </p>
                              <Button
                                disabled={busy}
                                onClick={() => markSettlement(e.id)}
                              >
                                확인 기록
                              </Button>{" "}
                              <Button
                                disabled={busy}
                                onClick={() => setSettle("")}
                              >
                                취소
                              </Button>
                            </div>
                          ) : null}
                        </div>
                      </td>
                    </tr>
                  ))}
              </Table>
            ) : (
              <Empty title="촉진 대상자가 없습니다" />
            )}
          </Panel>
        </>
      ) : null}
      {tab === "rules" ? <Rules /> : null}
    </>
  );
}
function Rules() {
  const [basis, setBasis] = useState("anniversary");
  const hr = useHr(),
    [year, setYear] = useState(hr.today.slice(0, 4)),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [remove, setRemove] = useState("");
  async function add(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget,
      f = new FormData(form);
    setBusy(true);
    setError("");
    try {
      await hr.save("holidays", {
        day: String(f.get("day")),
        name: String(f.get("name")).trim(),
      });
      form.reset();
      hr.toast(
        "휴일을 저장했습니다 · 대기 중 휴가는 승인할 때 다시 계산됩니다",
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "저장 실패");
    } finally {
      setBusy(false);
    }
  }
  async function del(day: string) {
    setBusy(true);
    setError("");
    try {
      await hr.save(`holidays/${day}`, {}, "DELETE");
      setRemove("");
      hr.toast("직접 등록한 휴일을 지웠습니다");
    } catch (e) {
      setError(e instanceof Error ? e.message : "삭제 실패");
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <Panel title="입사일 기준 부여 규칙">
        <div className="hr-body">
          <div className="hr-toolbar" role="group" aria-label="연차 부여 기준">
            <Button
              aria-pressed={basis === "anniversary"}
              onClick={() => setBasis("anniversary")}
            >
              입사일
            </Button>
            <Button
              aria-pressed={basis === "calendar"}
              onClick={() => setBasis("calendar")}
            >
              회계연도 (1/1)
            </Button>
          </div>
          {basis === "calendar" ? (
            <p className="hr-banner" role="status">
              회계연도 기준은 아직 지원하지 않습니다. 입사 첫해 비례 계산과 퇴사
              정산 재계산이 필요하며, 현재 입사일 기준은 유지됩니다.
            </p>
          ) : null}
          <dl className="hr-detail-list">
            <dt>1년 미만</dt>
            <dd>한 달 개근할 때마다 1일 · 최대 11일</dd>
            <dt>1년 이상</dt>
            <dd>
              1년 80% 이상 출근하면 15일 · 3년차부터 2년마다 1일 가산, 최대 25일
            </dd>
            <dt>사용 기한</dt>
            <dd>
              입사일의 다음 주년 전날 · 2월 29일 입사는 해당 연도의 말일로 조정
            </dd>
            <dt>차감</dt>
            <dd>
              승인 연차·반차만 차감 · 토·일 및 등록 휴일 제외 · 반차 0.5일
            </dd>
            <dt>자동 발생</dt>
            <dd>
              매일 03:10 (한국 시각). 출근율을 충족했다고 가정하며 차이는 사유를
              남겨 수동 조정합니다.
            </dd>
          </dl>
          <p className="hr-muted">
            근로시간·휴직·출근율 등에 따른 법적 적용은 노무사와 확인해 주세요.
          </p>
        </div>
      </Panel>
      <Panel
        title="공휴일·회사 휴일"
        extra={
          <input
            aria-label="휴일 연도"
            type="number"
            min="1900"
            max="2199"
            value={year}
            onChange={(e) => setYear(e.target.value)}
          />
        }
      >
        {error ? (
          <p className="hr-banner error" role="alert">
            {error}
          </p>
        ) : null}
        <div className="hr-body">
          <div className="hr-actions" aria-label="공휴일 등록 현황">
            {[Number(hr.today.slice(0, 4)), Number(hr.today.slice(0, 4)) + 1].map((value) => {
              const count = hr.data.holidays.filter((holiday) => holiday.day.startsWith(`${value}-`)).length;
              return <span key={value} className={count ? "hr-muted" : "hr-danger"}>{value}년 등록 {count}건{count ? "" : " · 등록 필요"}</span>;
            })}
          </div>
          <form onSubmit={add} className="hr-actions">
            <Field label="날짜" required>
              <input name="day" type="date" required />
            </Field>
            <Field label="휴일 이름" required>
              <input name="name" maxLength={40} required />
            </Field>
            <Button type="submit" disabled={busy} primary>
              ＋ 휴일 등록
            </Button>
          </form>
          <p className="hr-muted">
            자동 공휴일 연결을 설정하면 매주 현재·다음 연도를 갱신합니다. 직접
            입력한 날짜는 자동 갱신으로 덮어쓰지 않습니다. 이미 승인한 휴가의
            일수는 유지됩니다.
          </p>
        </div>
        {hr.data.holidays.some((h) => h.day.startsWith(year)) ? (
          <Table head={["날짜", "이름", "출처", "관리"]}>
            {hr.data.holidays
              .filter((h) => h.day.startsWith(year))
              .sort((a, b) => a.day.localeCompare(b.day))
              .map((h) => (
                <tr key={h.day}>
                  <td>{h.day}</td>
                  <td>{h.name}</td>
                  <td>{h.source === "manual" ? "직접 입력" : "공공데이터"}</td>
                  <td>
                    {h.source === "manual" ? (
                      remove === h.day ? (
                        <>
                          <span>지울까요? </span>
                          <Button
                            disabled={busy}
                            danger
                            onClick={() => del(h.day)}
                          >
                            삭제 확인
                          </Button>{" "}
                          <Button onClick={() => setRemove("")}>취소</Button>
                        </>
                      ) : (
                        <Button onClick={() => setRemove(h.day)}>삭제</Button>
                      )
                    ) : (
                      "자동 관리"
                    )}
                  </td>
                </tr>
              ))}
          </Table>
        ) : (
          <Empty title="등록된 휴일이 없습니다">
            공휴일 연결을 설정하거나 직접 등록해 주세요. 휴가 일수는 등록된
            휴일을 기준으로 계산합니다.
          </Empty>
        )}
      </Panel>
    </>
  );
}
