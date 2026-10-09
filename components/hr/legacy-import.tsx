"use client";
import Link from "next/link";
import { useState } from "react";
import { useHr } from "./context";
import { Button, Empty, Panel, Pill, Table } from "./ui";
import { LEAVE_LABELS, type Employee, type LeaveType } from "@/lib/hr/types";
import { balance, workDays } from "@/lib/hr/domain";
import type { OpenDrawer } from "./people";
type Preview = {
  employee: string;
  version: number;
  balanceId: string | null;
  balanceVersion: number | null;
  oldBalance: number | null;
  newBalance: number;
  imported: boolean;
  requests: Array<{
    id: string;
    version: number;
    start: string;
    end: string;
    days: number;
    type: string;
    status: string;
    imported: boolean;
  }>;
};
export function LegacyImport({ open }: { open: OpenDrawer }) {
  const hr = useHr(),
    [selected, setSelected] = useState(""),
    [preview, setPreview] = useState<Preview | null>(null),
    [types, setTypes] = useState<Record<string, LeaveType>>({}),
    [checked, setChecked] = useState<string[]>([]),
    [ack, setAck] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  async function load(id: string) {
    setSelected(id);
    setPreview(null);
    setAck(false);
    setBusy(true);
    setError("");
    try {
      let p: Preview;
      if (hr.demo) {
        const e = hr.data.employees.find((e) => e.id === id)!;
        p = {
          employee: id,
          version: e.version,
          balanceId: null,
          balanceVersion: null,
          oldBalance: null,
          newBalance: balance(hr.data, e, hr.today).left,
          requests: [],
          imported: false,
        };
      } else p = await hr.read<Preview>(`legacy-preview?employee=${id}`);
      setPreview(p);
      setChecked(p.requests.filter((x) => !x.imported).map((x) => x.id));
      setTypes(
        Object.fromEntries(
          p.requests.map((x) => [
            x.id,
            (
              {
                연차: "annual",
                경조휴가: "family_event",
                기타: "other",
              } as Record<string, LeaveType>
            )[x.type] || "annual",
          ]),
        ),
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "자료 확인 실패");
    } finally {
      setBusy(false);
    }
  }
  async function importData() {
    if (!preview) return;
    setBusy(true);
    setError("");
    try {
      if (hr.demo) {
        hr.toast("체험 모드에는 이관할 기존 자료가 없습니다.");
        return;
      }
      await hr.save("legacy-import", {
        employee: selected,
        version: preview.version,
        balanceId: preview.balanceId,
        balanceVersion: preview.balanceVersion,
        requests: preview.requests
          .filter((r) => checked.includes(r.id) && !r.imported)
          .map((r) => ({ id: r.id, version: r.version, type: types[r.id] })),
      });
      hr.toast("자료를 이관했습니다 · 기존 기록은 유지됩니다");
      await load(selected);
    } catch (e) {
      setError(e instanceof Error ? e.message : "이관 실패");
    } finally {
      setBusy(false);
    }
  }
  async function prefill(profile: string) {
    setBusy(true);
    setError("");
    try {
      const fields = hr.demo
        ? null
        : await hr.save<Partial<Employee> | null>("legacy-person", { profile });
      open({
        kind: "edit",
        profile: hr.data.profiles.find((p) => p.id === profile),
        prefill: fields || undefined,
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : "자료 확인 실패");
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <p>
        <Link href="/hr/employees">← 직원 명부</Link>
      </p>
      <h1>기존 자료 검토·이관</h1>
      <p className="hr-banner">
        관리자가 확인한 사람만 이관합니다. 기존 팀·일정 메뉴는 유지되며 두
        메뉴의 잔여는 자동 동기화하지 않습니다. 신청을 먼저 옮기고 마지막으로
        현재 잔여에 맞춰 차이를 기초 조정합니다.
      </p>
      {error ? (
        <p className="hr-banner error" role="alert">
          {error}
        </p>
      ) : null}
      <Panel title="1. 계정 구분과 근로 정보 확인">
        <Table head={["사람", "현재 구분", "인사 정보", "검토"]}>
          {hr.data.profiles
            .filter((p) => !p.is_shared_account)
            .map((p) => {
              const e = hr.data.employees.find((e) => e.profile_id === p.id);
              return (
                <tr key={p.id}>
                  <td>{p.display_name}</td>
                  <td>
                    {p.person_kind === "employee"
                      ? "근로자"
                      : p.person_kind === "owner"
                        ? "사업주"
                        : p.person_kind === "contractor"
                          ? "외부 협업"
                          : "미설정"}
                  </td>
                  <td>{e ? "등록됨" : "미등록"}</td>
                  <td>
                    <Button
                      disabled={busy}
                      onClick={() =>
                        e
                          ? open({ kind: "edit", employee: e, profile: p })
                          : void prefill(p.id)
                      }
                    >
                      {e ? "정보 수정" : "구분·정보 입력"}
                    </Button>
                  </td>
                </tr>
              );
            })}
        </Table>
      </Panel>
      <Panel title="2. 기존 휴가와 잔여 검토">
        <div className="hr-body">
          <label>
            대상 근로자{" "}
            <select
              aria-label="이관 대상 근로자"
              value={selected}
              disabled={busy}
              onChange={(e) => void load(e.target.value)}
            >
              <option value="" disabled>
                선택하세요
              </option>
              {hr.data.employees
                .filter((e) => e.profile_id)
                .map((e) => (
                  <option key={e.id} value={e.id}>
                    {e.display_name}
                  </option>
                ))}
            </select>
          </label>
          {busy ? <p role="status">확인 중…</p> : null}
          {preview ? (
            <>
              <p>
                기존 잔여 <b>{preview.oldBalance ?? "기록 없음"}</b> · 새 규칙
                잔여 <b>{preview.newBalance}일</b>
              </p>
              <p>
                휴가 이관 후 차이를 다시 계산해 기초 조정합니다. 이미 이관한
                기간은 다시 실행할 수 없습니다.
              </p>
              {preview.imported ? (
                <Pill tone="good">이번 기간 이관 완료</Pill>
              ) : null}
            </>
          ) : null}
        </div>
        {preview?.requests.length ? (
          <Table
            head={[
              "선택",
              "날짜",
              "기존 구분",
              "옮길 구분",
              "기존 → 재계산",
              "상태",
            ]}
          >
            {preview.requests.map((r) => (
              <tr key={r.id}>
                <td>
                  <input
                    aria-label={`${r.start} 이관 선택`}
                    type="checkbox"
                    checked={checked.includes(r.id)}
                    disabled={r.imported || busy}
                    onChange={(e) =>
                      setChecked((v) =>
                        e.target.checked
                          ? [...v, r.id]
                          : v.filter((id) => id !== r.id),
                      )
                    }
                  />
                </td>
                <td>
                  {r.start} ~ {r.end}
                </td>
                <td>{r.type}</td>
                <td>
                  <select
                    aria-label={`${r.start} 휴가 구분`}
                    value={types[r.id]}
                    onChange={(e) =>
                      setTypes((v) => ({
                        ...v,
                        [r.id]: e.target.value as LeaveType,
                      }))
                    }
                  >
                    {Object.entries(LEAVE_LABELS).map(([v, l]) => (
                      <option key={v} value={v}>
                        {l}
                      </option>
                    ))}
                  </select>
                </td>
                <td>
                  {r.days} →{" "}
                  {types[r.id]?.startsWith("half_")
                    ? workDays(r.start, r.end, hr.data.holidays).days > 0
                      ? 0.5
                      : 0
                    : workDays(r.start, r.end, hr.data.holidays).days}
                  일
                </td>
                <td>
                  {r.imported
                    ? "이관 완료"
                    : r.status === "approved"
                      ? "승인"
                      : "대기"}
                </td>
              </tr>
            ))}
          </Table>
        ) : preview ? (
          <Empty title="이관할 휴가가 없습니다" />
        ) : null}
        {preview && !preview.imported ? (
          <div className="hr-body">
            <label className="hr-check">
              <input
                type="checkbox"
                checked={ack}
                onChange={(e) => setAck(e.target.checked)}
              />
              대상·날짜·일수와 두 메뉴가 자동 동기화되지 않는 점을 확인했습니다.
            </label>
            <Button
              primary
              disabled={!ack || busy || (!preview.balanceId && !checked.length)}
              onClick={importData}
            >
              검토한 자료 이관
            </Button>
          </div>
        ) : null}
      </Panel>
    </>
  );
}
