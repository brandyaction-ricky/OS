"use client";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import {
  activeEmployees,
  missingDocuments,
  daysBetween,
  addMonths,
  addDays,
} from "@/lib/hr/domain";
import { RETIRE_LABELS, DOC_LABELS, type HrEvent } from "@/lib/hr/types";
import { useHr } from "./context";
import { Button, Cards, Drawer, Empty, Panel, Pill, Table, Tabs } from "./ui";
import type { OpenDrawer } from "./people";
import { MissingWorkersMessage } from "./notices";
export function Documents({ open }: { open: OpenDrawer }) {
  const [history, setHistory] = useState<string | null>(null);
  const hr = useHr(),
    params = useSearchParams(),
    tab = params.get("tab") || "checklist",
    [missing, setMissing] = useState(params.get("missing") === "1"),
    people = activeEmployees(hr.data, hr.today),
    filtered = people.filter(
      (e) => !missing || missingDocuments(hr.data, e.id).length,
    );
  return (
    <>
      <div className="hr-head">
        <div>
          <h1>서류·계약</h1>
          <p>사람별 필수 서류와 검토한 양식을 한곳에서 보관합니다.</p>
        </div>
        {tab === "forms" ? (
          <Button primary onClick={() => open({ kind: "form" })}>
            ＋ 양식 올리기
          </Button>
        ) : null}
      </div>
      <Tabs
        current={tab}
        items={[
          ["checklist", "서류 현황"],
          ["retired", "퇴사자 보존"],
          ["forms", "양식 보관함"],
        ]}
      />
      {tab === "checklist" ? (
        <>
          <Cards
            items={[
              {
                label: "대상 근로자",
                value: `${people.length}명`,
                description: "재직 · 휴직",
              },
              {
                label: "서류 완비",
                value: `${people.filter((e) => !missingDocuments(hr.data, e.id).length).length}/${people.length}명`,
                description: "6종 모두 처리",
              },
              {
                label: "빠진 서류",
                value: people.reduce(
                  (n, e) => n + missingDocuments(hr.data, e.id).length,
                  0,
                ),
                description: "눌러서 날짜·파일 등록",
                tone: people.some((e) => missingDocuments(hr.data, e.id).length) ? "danger" : "",
              },
              {
                label: "30일 안 계약 만료",
                value: `${hr.data.contracts.filter((c) => c.is_current && c.end_date && c.end_date >= hr.today && c.end_date <= addDays(hr.today, 30) && people.some((e) => e.id === c.hr_employee_id)).length}명`,
                description: "기간제 계약 확인",
              },
            ]}
          />
          <div className="hr-toolbar">
            <label className="hr-check">
              <input
                type="checkbox"
                checked={missing}
                onChange={(e) => setMissing(e.target.checked)}
              />
              빠진 서류만 보기
            </label>
          </div>
          <Panel>
            {filtered.length ? (
              <Table head={["이름", ...Object.values(DOC_LABELS)]}>
                {filtered.map((e) => (
                  <tr key={e.id}>
                    <td>
                      <Link
                        href={`/hr/employees/${e.profile_id || e.id}?tab=docs`}
                      >
                        {e.display_name}
                      </Link>
                    </td>
                    {Object.entries(DOC_LABELS).map(([kind, label]) => {
                      const d = hr.data.documents.find(
                        (x) => x.hr_employee_id === e.id && x.doc_kind === kind,
                      );
                      return (
                        <td key={kind}>
                          {d ? (
                            <button
                              className="hr-row-button"
                              aria-label={`${e.display_name} ${label} 처리`}
                              onClick={() =>
                                open({
                                  kind: "document",
                                  employee: e,
                                  document: d,
                                })
                              }
                            >
                              <Pill
                                tone={d.status === "done" ? "good" : "danger"}
                              >
                                {d.status === "done" ? "완료" : "빠짐"}
                              </Pill>
                              <small>{d.done_date || "처리하기"}</small>
                            </button>
                          ) : (
                            <Pill tone="danger">등록 정보 없음</Pill>
                          )}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </Table>
            ) : (
              <Empty
                title={
                  missing
                    ? "빠진 서류가 없습니다"
                    : "서류 대상 근로자가 없습니다"
                }
              ><MissingWorkersMessage /></Empty>
            )}
            <div className="hr-foot">
              교부는 근로자에게 계약서 사본을 준 날짜입니다. 계약 조건을 바꾸면
              서명·교부를 다시 확인합니다. 주민등록번호는 OS에 저장하지
              않습니다.
            </div>
          </Panel>
        </>
      ) : null}
      {tab === "retired" ? <Retention /> : null}
      {tab === "forms" ? (
        <Panel title="검토한 양식">
          {hr.data.forms.length ? (
            <Table head={["양식", "쓰는 곳", "버전", "검토일", "파일"]}>
              {hr.data.forms.map((f) => (
                <tr key={f.id}>
                  <td>{f.title}</td>
                  <td className="hr-row-small">{f.usage}</td>
                  <td>{f.version_label || "미등록"}</td>
                  <td>{f.reviewed_at?.slice(0, 10) || "—"}</td>
                  <td>
                    <div className="hr-actions">
                      {f.file_path ? (
                        <Button
                          onClick={() =>
                            void hr
                              .openFile(f.file_path!)
                              .catch((e) => hr.toast(e.message))
                          }
                        >
                          보기·받기
                        </Button>
                      ) : (
                        <Pill>파일 미등록</Pill>
                      )}
                      <Button onClick={() => setHistory(f.id)}>
                        버전 이력
                      </Button>
                      <Button onClick={() => open({ kind: "form", form: f })}>
                        {f.file_path ? "새 버전 올리기" : "파일 올리기"}
                      </Button>
                    </div>
                  </td>
                </tr>
              ))}
            </Table>
          ) : (
            <Empty title="등록된 양식이 없습니다">
              검토한 양식을 올려 주세요.
            </Empty>
          )}
          <div className="hr-foot">
            양식의 적합성은 노무사 검토 후 확인해 주세요. 교체 전 버전과 파일은
            이력에 보관됩니다.
          </div>
        </Panel>
      ) : null}
      {history ? (
        <FormHistory id={history} onClose={() => setHistory(null)} />
      ) : null}
    </>
  );
}

function FormHistory({ id, onClose }: { id: string; onClose: () => void }) {
  const hr = useHr(),
    read = useRef(hr.read);
  read.current = hr.read;
  const [rows, setRows] = useState<HrEvent[]>([]),
    [error, setError] = useState(""),
    [loading, setLoading] = useState(true);
  useEffect(() => {
    let live = true;
    read
      .current<{ rows: HrEvent[] }>(`forms/history?form=${id}`)
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
  }, [id]);
  return (
    <Drawer title="양식 버전 이력" onClose={onClose}>
      <div className="hr-drawer-content">
        {error ? (
          <p role="alert">{error}</p>
        ) : loading ? (
          <p role="status">이력을 불러오는 중…</p>
        ) : rows.length ? (
          rows.map((r) => (
            <div key={r.id} className="hr-letter">
              <b>{String(r.detail.versionLabel || "양식 변경")}</b>
              <p>
                {new Date(r.created_at).toLocaleString("ko-KR", {
                  timeZone: "Asia/Seoul",
                })}
              </p>
              {typeof r.detail.previousPath === "string" ? (
                <Button
                  onClick={() =>
                    void hr
                      .openFile(r.detail.previousPath as string)
                      .catch((e) => setError(e.message))
                  }
                >
                  이전 파일 · {String(r.detail.previousLabel || "이전 버전")}
                </Button>
              ) : (
                <p>이전 파일 없음</p>
              )}
            </div>
          ))
        ) : (
          <Empty title="양식 변경 이력이 없습니다" />
        )}
      </div>
      <footer>
        <Button onClick={onClose}>닫기</Button>
      </footer>
    </Drawer>
  );
}

function Retention() {
  const hr = useHr();
  const rows = hr.data.employees.filter(
    (e) =>
      e.status === "retired" || (e.retire_date && e.retire_date < hr.today),
  );
  return (
    <>
      <Panel title="퇴사자 서류 보존">
        {rows.length ? (
          <Table
            head={["이름", "퇴사일", "사유", "보존 끝", "남은 기간", "기록"]}
          >
            {rows.map((e) => {
              const until =
                e.retention_until ||
                (e.retire_date ? addMonths(e.retire_date, 36) : null);
              const remaining = until ? daysBetween(hr.today, until) : null;
              return (
                <tr key={e.id}>
                  <td>
                    {e.display_name} <Pill>퇴사</Pill>
                  </td>
                  <td>{e.retire_date || "—"}</td>
                  <td>
                    {RETIRE_LABELS[e.retire_reason || ""] ||
                      e.retire_reason ||
                      "—"}
                  </td>
                  <td>{until || "—"}</td>
                  <td>
                    {remaining === null ? (
                      "확인 필요"
                    ) : remaining < 0 ? (
                      <Pill tone="warn">보존 기한 지남 · 파기 검토</Pill>
                    ) : (
                      `${remaining}일`
                    )}
                  </td>
                  <td>
                    <Link
                      href={`/hr/employees/${e.profile_id || e.id}?tab=docs`}
                    >
                      인사카드
                    </Link>
                  </td>
                </tr>
              );
            })}
          </Table>
        ) : (
          <Empty title="보존 중인 퇴사자 서류가 없습니다">
            인사카드에서 퇴사 처리하면 여기 들어오고, 보존 끝나는 날에 파기
            알림이 갑니다.
          </Empty>
        )}
      </Panel>
      <Panel title="보존 규칙">
        <Table head={["자료", "보존 기준", "기한 뒤 처리"]}>
          <tr>
            <td>근로자 명부·계약 서류</td>
            <td>퇴사일로부터 3년</td>
            <td>파기 검토 알림 · 자동 삭제 없음</td>
          </tr>
          <tr>
            <td>지난 계약·교체 전 파일</td>
            <td>변경 이력에서 보관</td>
            <td>인사 담당자 확인 후 별도 처리</td>
          </tr>
        </Table>
      </Panel>
    </>
  );
}
