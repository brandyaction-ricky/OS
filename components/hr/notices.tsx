import Link from "next/link";
import { missingHolidayYears } from "@/lib/hr/domain";
import { useHr } from "./context";

export function MigrationNotice() {
  const { data } = useHr();
  const count = data.profiles.filter(
    (profile) => !profile.is_shared_account && !profile.person_kind,
  ).length;
  if (!count) return null;
  return (
    <p className="hr-banner warning" role="status">
      구분이 정해지지 않은 계정 {count}개 — 이관을 끝내야 연차·서류가 계산됩니다.{" "}
      <Link href="/hr/employees?migrate=1">이관 시작</Link>
    </p>
  );
}

export function MissingWorkersMessage() {
  const { data } = useHr();
  const count = data.profiles.filter(
    (profile) => !profile.is_shared_account && !profile.person_kind,
  ).length;
  return count ? (
    <>구분 미설정 {count}명 — <Link href="/hr/employees?migrate=1">기존 자료 검토·이관</Link>에서 정해 주세요.</>
  ) : (
    <>직원 명부에서 근로자를 등록해 주세요.</>
  );
}

export function MissingHolidayNotice({ start, end }: { start: string; end?: string }) {
  const { data } = useHr();
  const years = missingHolidayYears(data, start, end);
  if (!years.length) return null;
  return (
    <p className="hr-banner error" role="alert">
      {years.join("·")}년 공휴일이 등록되지 않아 일수가 실제보다 많을 수 있습니다.{" "}
      <Link href="/hr/leave-ledger?tab=rules">공휴일 등록</Link>
    </p>
  );
}
