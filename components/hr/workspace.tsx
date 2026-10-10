"use client";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { useState } from "react";
import { useHr } from "./context";
import { Button, Empty } from "./ui";
import { Employees, PersonCard } from "./people";
import { Leave } from "./leave";
import { LeaveLedger } from "./ledger";
import { Documents } from "./documents";
import { HrFormDrawer, type DrawerState } from "./forms";
import { LegacyImport } from "./legacy-import";
import { MigrationNotice } from "./notices";
export function HrWorkspace() {
  const hr = useHr(),
    path = usePathname(),
    params = useSearchParams(),
    section = path.split("/")[2] || "employees",
    person = path.split("/")[3],
    self = section === "my-leave";
  const [drawer, setDrawer] = useState<DrawerState | null>(null);
  return (
    <div className="hr-workspace">
      {hr.demo ? (
        <div className="hr-banner">
          인사 체험 모드 · 가상 자료 / 기준일 {hr.today}. 변경은 이 화면에서만
          유지되며 새로고침하면 초기화됩니다.
        </div>
      ) : null}
      {hr.loading ? (
        <p role="status">인사 정보를 불러오는 중…</p>
      ) : hr.error ? (
        <Empty title="인사 정보를 불러오지 못했습니다">
          <span role="alert">{hr.error}</span>
          <p>
            <Button onClick={() => void hr.refresh()}>다시 시도</Button>
          </p>
        </Empty>
      ) : !hr.allowed && !self ? (
        <Empty title="인사·노무 관리에 접근할 수 없습니다">
          관리자 또는 경영지원 민감정보 접근 권한이 필요합니다.
          <p>
            <Link href="/hr/my-leave">내 휴가·연차로 이동</Link>
          </p>
        </Empty>
      ) : (
        <>
          {!self && hr.allowed ? <MigrationNotice /> : null}
          <nav className="hr-self-links" aria-label="인사·노무 메뉴">
            {(hr.allowed
              ? [
                  ["employees", "직원 명부"],
                  ["leave", "휴가 관리"],
                  ["leave-ledger", "연차 원장·촉진"],
                  ["documents", "서류·계약"],
                ]
              : [["my-leave", "내 휴가·연차"]]
            ).map(([key, label]) => (
              <Link
                key={key}
                href={`/hr/${key}`}
                aria-current={section === key ? "page" : undefined}
              >
                {label}
              </Link>
            ))}
          </nav>
          {section === "employees" &&
          params.get("migrate") === "1" &&
          hr.admin ? (
            <LegacyImport open={setDrawer} />
          ) : section === "employees" ? (
            person ? (
              <PersonCard key={person} id={person} open={setDrawer} />
            ) : (
              <Employees open={setDrawer} />
            )
          ) : null}
          {section === "leave" || self ? (
            <Leave key={self ? "self" : "team"} open={setDrawer} self={self} />
          ) : null}
          {section === "leave-ledger" ? <LeaveLedger open={setDrawer} /> : null}
          {section === "documents" ? <Documents open={setDrawer} /> : null}
        </>
      )}
      {drawer ? (
        <HrFormDrawer state={drawer} onClose={() => setDrawer(null)} />
      ) : null}
    </div>
  );
}
