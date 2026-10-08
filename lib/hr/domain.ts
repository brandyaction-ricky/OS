import { DOC_LABELS, LEAVE_LABELS } from "./types.ts";
import type {
  Employee,
  HrData,
  Holiday,
  LeaveType,
  Credit,
  Promotion,
} from "./types.ts";

const DAY = 86_400_000;
const parts = (s: string) => s.split("-").map(Number);
const stamp = (s: string) => {
  const [y, m, d] = parts(s);
  return Date.UTC(y, m - 1, d);
};
const key = (ms: number) => {
  const d = new Date(ms);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
};
// UTC is used only for timezone-free arithmetic on date-only values; wall-clock today is KST.
export function todayKst(now = new Date()) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}
export function eventDate(value: string) {
  return value.length === 10 ? value : todayKst(new Date(value));
}
export function validDate(s: string) {
  return (
    /^\d{4}-\d{2}-\d{2}$/.test(s) &&
    s >= "1900-01-01" &&
    s <= "2199-12-31" &&
    key(stamp(s)) === s
  );
}
export function addDays(s: string, n: number) {
  return key(stamp(s) + n * DAY);
}
export function addMonths(s: string, n: number) {
  const [y, m, d] = parts(s);
  const first = new Date(Date.UTC(y, m - 1 + n, 1));
  const last = new Date(
    Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0),
  ).getUTCDate();
  return key(
    Date.UTC(first.getUTCFullYear(), first.getUTCMonth(), Math.min(d, last)),
  );
}
export function daysBetween(a: string, b: string) {
  return Math.round((stamp(b) - stamp(a)) / DAY);
}
export function weekday(s: string) {
  return new Date(stamp(s)).getUTCDay();
}
export function md(s: string) {
  const [, m, d] = parts(s);
  return `${m}/${d}`;
}
export function shortDate(s: string) {
  return s.slice(2).replaceAll("-", ".");
}
export function dlabel(s: string, today: string) {
  const n = daysBetween(today, s);
  return n === 0 ? "오늘" : n > 0 ? `D-${n}` : `D+${-n}`;
}
export function tenure(hire: string, at: string) {
  if (at < hire) return "입사 전";
  const [y, m, d] = parts(hire),
    [ay, am, ad] = parts(at);
  let months = (ay - y) * 12 + am - m;
  if (ad < d) months--;
  return `${months >= 12 ? `${Math.floor(months / 12)}년 ` : ""}${months % 12}개월`;
}
export function workDays(start: string, end: string, holidays: Holiday[] = []) {
  if (
    !validDate(start) ||
    !validDate(end) ||
    end < start ||
    daysBetween(start, end) > 3660
  )
    return { days: 0, weekends: 0, holidays: [] as Holiday[] };
  const map = new Map(holidays.map((h) => [h.day, h]));
  let days = 0,
    weekends = 0;
  const excluded: Holiday[] = [];
  for (let day = start; day <= end; day = addDays(day, 1)) {
    if ([0, 6].includes(weekday(day))) weekends++;
    else if (map.has(day)) excluded.push(map.get(day)!);
    else days++;
  }
  return { days, weekends, holidays: excluded };
}
export function deducts(type: LeaveType) {
  return ["annual", "half_am", "half_pm"].includes(type);
}
export function periodOf(hire: string, at: string) {
  let year = Math.max(0, Number(at.slice(0, 4)) - Number(hire.slice(0, 4)));
  if (addMonths(hire, year * 12) > at) year = Math.max(0, year - 1);
  return {
    start: addMonths(hire, year * 12),
    end: addDays(addMonths(hire, (year + 1) * 12), -1),
    first: year === 0,
    year,
  };
}
export function accruals(
  employee: Pick<Employee, "id" | "hire_date" | "retire_date">,
  through: string,
): Credit[] {
  const { id, hire_date: hire } = employee;
  const end =
    employee.retire_date && employee.retire_date < through
      ? employee.retire_date
      : through;
  const rows: Credit[] = [];
  for (let month = 1; month <= 11; month++) {
    const date = addMonths(hire, month);
    if (date > end) break;
    const p = periodOf(hire, date);
    rows.push({
      id: `monthly:${id}:${date}`,
      hr_employee_id: id,
      kind: "accrual_monthly",
      days: 1,
      entry_date: date,
      period_start: p.start,
      period_end: p.end,
      reason: `입사 ${month}개월 개근 · 출근율 확인 필요`,
      source: "auto",
    });
  }
  for (let year = 1; year <= 200; year++) {
    const date = addMonths(hire, year * 12);
    if (date > end) break;
    const p = periodOf(hire, date);
    rows.push({
      id: `annual:${id}:${date}`,
      hr_employee_id: id,
      kind: "accrual_annual",
      days: Math.min(25, 15 + Math.floor((year - 1) / 2)),
      entry_date: date,
      period_start: p.start,
      period_end: p.end,
      reason: `근속 ${year}년 · 출근율 80% 이상 가정`,
      source: "auto",
    });
  }
  return rows;
}
export function creditsOf(data: HrData, employee: Employee, through: string) {
  const stored = data.credits.filter((c) => c.hr_employee_id === employee.id);
  const keys = new Set(
    stored
      .filter((c) => c.source === "auto")
      .map((c) => `${c.kind}:${c.entry_date}`),
  );
  return [
    ...stored,
    ...accruals(employee, through).filter(
      (c) => !keys.has(`${c.kind}:${c.entry_date}`),
    ),
  ];
}
export function balance(
  data: HrData,
  employee: Employee,
  today: string,
  at = today,
  excludeRequest?: string,
) {
  const period = periodOf(employee.hire_date, at),
    through = at > today ? at : today;
  const credits = creditsOf(data, employee, through).filter(
    (c) => c.period_start === period.start && c.entry_date <= through,
  );
  const sum = (xs: { days: number }[]) =>
    xs.reduce((a, c) => a + Number(c.days), 0);
  const accrued = sum(credits.filter((c) => c.kind.startsWith("accrual_")));
  const adjustment = sum(
    credits.filter((c) => ["adjustment", "opening"].includes(c.kind)),
  );
  const requests = data.requests.filter(
    (r) =>
      r.id !== excludeRequest &&
      r.hr_employee_id === employee.id &&
      r.deducts &&
      r.start_date >= period.start &&
      r.start_date <= period.end,
  );
  const used = sum(
    requests.filter((r) => r.status === "approved" && r.start_date <= today),
  );
  const scheduled = sum(
    requests.filter((r) => r.status === "approved" && r.start_date > today),
  );
  const pending = sum(requests.filter((r) => r.status === "pending"));
  return {
    period,
    accrued,
    adjustment,
    used,
    scheduled,
    pending,
    left: accrued + adjustment - used - scheduled,
    future: period.start > today,
  };
}
export function leavePreview(
  data: HrData,
  employee: Employee,
  type: LeaveType,
  start: string,
  end: string,
  today: string,
) {
  const calc = workDays(start, end, data.holidays),
    half = type === "half_am" || type === "half_pm";
  const days = half ? (calc.days > 0 ? 0.5 : 0) : calc.days;
  const b = balance(data, employee, today, start);
  const overlap = data.requests.filter(
    (r) =>
      ["pending", "approved"].includes(r.status) &&
      r.start_date <= end &&
      r.end_date >= start,
  );
  const errors: string[] = [];
  if (
    !validDate(start) ||
    !validDate(end) ||
    end < start ||
    daysBetween(start, end) > 366 ||
    (half && start !== end)
  )
    errors.push("INVALID_DATES");
  if (
    start < employee.hire_date ||
    employee.status === "retired" ||
    (employee.retire_date && end > employee.retire_date)
  )
    errors.push("NOT_ELIGIBLE");
  if (!days) errors.push("NO_WORKDAYS");
  if (deducts(type) && end > b.period.end) errors.push("CROSSES_PERIOD");
  if (overlap.some((r) => r.hr_employee_id === employee.id))
    errors.push("OVERLAP_SELF");
  if (deducts(type) && days > b.left) errors.push("INSUFFICIENT_LEAVE");
  return {
    ...calc,
    days,
    balance: b,
    after: b.left - (deducts(type) ? days : 0),
    errors,
    overlaps: overlap.filter((r) => r.hr_employee_id !== employee.id),
  };
}
export function promotion(data: HrData, employee: Employee, today: string) {
  const b = balance(data, employee, today),
    p = b.period,
    after = addDays(p.end, 1);
  const firstStart = addMonths(after, p.first ? -3 : -6),
    firstEnd = addDays(firstStart, 9),
    secondDue = addDays(addMonths(after, p.first ? -1 : -2), -1);
  const rows = data.promotions.filter(
    (r) => r.hr_employee_id === employee.id && r.period_start === p.start,
  );
  const one = rows.find((r) => r.step === "notice_1"),
    two = rows.find((r) => r.step === "designation_2");
  const unused = Math.max(0, b.left),
    target = Math.max(0, unused - Number(one?.reply_days || 0));
  const replyDue = one ? addDays(eventDate(one.sent_at), 10) : null;
  let rank: number,
    text: string,
    due: string | null = null,
    action: Promotion["step"] | null = null;
  if (!unused && !two) {
    rank = 7;
    text = "미사용 없음 · 촉진 불필요";
  } else if (!one) {
    if (today < firstStart) {
      rank = 4;
      due = firstStart;
      text = `1차 ${md(firstStart)} 시작 · ${dlabel(due, today)}`;
    } else if (today <= firstEnd) {
      rank = 0;
      due = firstEnd;
      text = `1차 촉구 마감 ${dlabel(due, today)}`;
      action = "notice_1";
    } else {
      rank = 1;
      text = "기한 지남 · 미사용분 수당";
    }
  } else if (two) {
    rank = 5;
    text = `지정 통보 완료 · ${md(eventDate(two.sent_at))}`;
  } else if (!one.reply_at && replyDue && today <= replyDue) {
    rank = 3;
    due = replyDue;
    text = `회신 대기 ${dlabel(due, today)}`;
  } else if (target <= 0) {
    rank = 6;
    text = "사용 계획 회신 완료";
  } else if (today <= secondDue) {
    rank = 2;
    due = secondDue;
    text = `2차 지정 통보 ${dlabel(due, today)}`;
    action = "designation_2";
  } else {
    rank = 1;
    text = "2차 기한 지남 · 미사용분 수당";
  }
  let extra: null | {
    days: number;
    dates: string[];
    start: string;
    end: string;
    due: string;
    state: string;
    text: string;
    action: Promotion["step"] | null;
  } = null;
  if (p.first && one) {
    const later = accruals(employee, p.end).filter(
      (c) =>
        c.kind === "accrual_monthly" && c.entry_date > eventDate(one.sent_at),
    );
    if (later.length) {
      const x1 = rows.find((r) => r.step === "notice_1_extra"),
        x2 = rows.find((r) => r.step === "designation_2_extra");
      const start = addMonths(after, -1),
        end = addDays(start, 4),
        due = addDays(p.end, -10);
      let state = "wait",
        label = "",
        act: Promotion["step"] | null = null;
      if (x2) {
        state = "done";
        label = `추가 지정 통보 완료 · ${md(eventDate(x2.sent_at))}`;
      } else if (x1) {
        const rd = addDays(eventDate(x1.sent_at), 10);
        if (Number(x1.reply_days || 0) >= later.length) {
          state = "done";
          label = "추가 사용 계획 회신 완료";
        } else if (today <= rd) {
          label = `추가 회신 대기 ${dlabel(rd, today)}`;
        } else if (today <= due) {
          state = "now";
          label = `추가 지정 통보 ${dlabel(due, today)}`;
          act = "designation_2_extra";
        } else {
          state = "miss";
          label = "추가분 기한 지남 · 수당";
        }
      } else if (today < start) {
        label = `추가 촉구 ${md(start)} 시작 · ${dlabel(start, today)}`;
      } else if (today <= end) {
        state = "now";
        label = `추가 촉구 마감 ${dlabel(end, today)}`;
        act = "notice_1_extra";
      } else {
        state = "miss";
        label = "추가분 기한 지남 · 수당";
      }
      extra = {
        days: later.length,
        dates: later.map((c) => c.entry_date),
        start,
        end,
        due,
        state,
        text: label,
        action: act,
      };
    }
  }
  return {
    period: p,
    unused,
    target,
    firstStart,
    firstEnd,
    secondDue,
    replyDue,
    rank,
    text,
    due,
    action,
    extra,
    one,
    two,
    settled: rows.some((r) => r.settlement_marked_at),
  };
}
export function worker(data: HrData, e: Employee) {
  const p = data.profiles.find((p) => p.id === e.profile_id);
  return !p || (!p.is_shared_account && p.person_kind === "employee");
}
export function activeEmployees(data: HrData, today: string) {
  return data.employees.filter(
    (e) =>
      worker(data, e) &&
      e.status !== "retired" &&
      (!e.retire_date || e.retire_date >= today),
  );
}
export function missingDocuments(data: HrData, id: string) {
  return (Object.keys(DOC_LABELS) as Array<keyof typeof DOC_LABELS>).filter(
    (kind) =>
      !data.documents.some(
        (d) =>
          d.hr_employee_id === id && d.doc_kind === kind && d.status === "done",
      ),
  );
}
export function todos(data: HrData, e: Employee, today: string) {
  const result: Array<{ text: string; tone: "danger" | "warn" | "muted" }> = [],
    p = promotion(data, e, today);
  if (p.rank <= 2)
    result.push({
      text: `연차 ${p.text}`,
      tone: p.rank < 2 ? "danger" : "warn",
    });
  for (const kind of missingDocuments(data, e.id))
    result.push({ text: `${DOC_LABELS[kind]} 빠짐`, tone: "danger" });
  const c = data.contracts.find(
    (c) => c.hr_employee_id === e.id && c.is_current,
  );
  for (const [date, label] of [
    [c?.probation_end, "수습 끝"],
    [c?.end_date, "계약 만료"],
  ])
    if (date && date >= today && daysBetween(today, date) <= 30)
      result.push({ text: `${label} ${dlabel(date, today)}`, tone: "warn" });
  const anniversary = addMonths(e.hire_date, 12);
  if (anniversary > today && daysBetween(today, anniversary) <= 60)
    result.push({
      text: `근속 1년 ${md(anniversary)} · 15일 발생`,
      tone: "muted",
    });
  if (e.retire_date && e.retire_date >= today)
    result.push({ text: `퇴사 ${md(e.retire_date)} · 정산`, tone: "warn" });
  if (e.status === "on_leave")
    result.push({
      text: `휴직 ~${e.leave_to ? md(e.leave_to) : ""} · 출근율 확인`,
      tone: "muted",
    });
  if (!result.length && p.rank === 4)
    result.push({ text: `연차 ${p.text}`, tone: "muted" });
  return result;
}
export function headcount(data: HrData, today: string) {
  const count = activeEmployees(data, today).length;
  return {
    count,
    label: count >= 5 ? "5인 이상 (추정)" : "5인 미만 (추정)",
    boundary: count === 5,
  };
}
export function retirement(
  data: HrData,
  e: Employee,
  date: string,
  today: string,
) {
  const b = balance(data, e, today, date > today ? date : today);
  const returned = data.requests
    .filter(
      (r) =>
        r.hr_employee_id === e.id &&
        r.status === "approved" &&
        r.deducts &&
        r.start_date > date &&
        r.start_date >= b.period.start &&
        r.start_date <= b.period.end,
    )
    .reduce((s, r) => s + r.days, 0);
  return {
    balance: Math.max(0, b.left + returned),
    tenure: tenure(e.hire_date, date),
    retentionUntil: addMonths(date, 36),
  };
}
export function ledger(data: HrData, e: Employee, today: string) {
  const p = periodOf(e.hire_date, today);
  const rows: Array<{
    id: string;
    date: string;
    kind: string;
    days: number | null;
    reason: string;
    future: boolean;
    running?: number;
  }> = creditsOf(data, e, addDays(p.end, 1))
    .filter((c) => c.period_start === p.start || c.entry_date > today)
    .map((c) => ({
      id: c.id,
      date: c.entry_date,
      kind:
        c.source === "auto"
          ? "자동 발생"
          : c.kind === "opening"
            ? "기초 조정"
            : "수동 조정",
      days: c.days,
      reason: c.reason || "",
      future: c.entry_date > today,
    }));
  for (const r of data.requests.filter(
    (r) =>
      r.hr_employee_id === e.id &&
      r.deducts &&
      r.start_date >= p.start &&
      r.start_date <= p.end,
  )) {
    if (r.status === "approved")
      rows.push({
        id: r.id,
        date: r.start_date,
        kind: r.start_date > today ? "사용 예정" : "사용",
        days: -r.days,
        reason: LEAVE_LABELS[r.leave_type],
        future: r.start_date > today,
      });
    if (r.status === "cancelled" && r.decided_at)
      rows.push({
        id: r.id,
        date: r.cancelled_at ? eventDate(r.cancelled_at) : today,
        kind: "사용 취소",
        days: 0,
        reason: `${LEAVE_LABELS[r.leave_type]} ${r.start_date} 승인 취소`,
        future: false,
      });
  }
  rows.push({
    id: "expiry",
    date: p.end,
    kind: "소멸",
    days: null,
    reason: "이번 기간 사용 기한",
    future: true,
  });
  rows.sort(
    (a, b) =>
      a.date.localeCompare(b.date) ||
      (a.days === null ? 1 : 0) - (b.days === null ? 1 : 0),
  );
  let running = 0;
  return rows.map((r) => {
    if (!r.future) running += r.days || 0;
    return { ...r, running: r.future ? undefined : running };
  });
}
export function maskedEmployee(e: Employee): Employee {
  return {
    ...e,
    legal_name: e.legal_name ? e.legal_name.slice(0, 1) + "••" : "",
    birth_date: e.birth_date ? e.birth_date.slice(0, 7) + "-••" : null,
    phone: e.phone ? e.phone.slice(0, 3) + "-••••-" + e.phone.slice(-4) : null,
    address: e.address
      ? e.address.split(" ").slice(0, 2).join(" ") + " •••"
      : null,
  };
}

export function hrBadges(data: HrData, today: string): Record<string, number> {
  const people = activeEmployees(data, today);
  return {
    "/hr/leave": data.requests.filter((r) => r.status === "pending").length,
    "/hr/leave-ledger": people.filter((e) => {
      const p = promotion(data, e, today);
      return !!p.action || !!p.extra?.action;
    }).length,
    "/hr/documents": people.reduce(
      (n, e) => n + missingDocuments(data, e.id).length,
      0,
    ),
  };
}

export function calendarRange(anchor: string, mode: "month" | "week") {
  const first = mode === "month" ? `${anchor.slice(0, 7)}-01` : anchor;
  const from = addDays(first, -weekday(first));
  const count = mode === "month" ? 42 : 7;
  return { from, to: addDays(from, count - 1), count };
}

export function leaveMetrics(data: HrData, today: string) {
  const approved = data.requests.filter((r) => r.status === "approved");
  const first = `${today.slice(0, 7)}-01`,
    last = addDays(addMonths(first, 1), -1);
  const isWorkday = workDays(today, today, data.holidays).days > 0;
  return {
    today: isWorkday
      ? new Set(
          approved
            .filter((r) => r.start_date <= today && r.end_date >= today)
            .map((r) => r.hr_employee_id),
        ).size
      : 0,
    month: [
      ...new Set(
        approved
          .filter((r) => r.start_date <= last && r.end_date >= first)
          .map((r) => r.hr_employee_id),
      ),
    ],
  };
}
