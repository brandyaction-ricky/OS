import type { SearchResult } from "@/lib/types";

export type TelegramActionKind = "task" | "decision" | "hold";

export interface TelegramActionDraft {
  kind: TelegramActionKind;
  title: string;
  assigneeUsername: string;
  dueDate: string | null;
  recordType: "task" | "decision";
  status: "backlog" | "decided" | "on_hold";
}

function localDate(date: Date) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul", year: "numeric", month: "2-digit", day: "2-digit" }).format(date);
}

export function parseTelegramAction(text: string, now = new Date()): TelegramActionDraft | null {
  const match = text.trim().match(/^\/(업무|결정|보류)(?:@\w+)?\s+([\s\S]+)$/);
  if (!match) return null;
  const kind = match[1] === "업무" ? "task" : match[1] === "결정" ? "decision" : "hold";
  let body = match[2].trim();
  const assignee = body.match(/(?:^|\s)@([A-Za-z0-9_]{3,32})(?=\s|$)/);
  const assigneeUsername = assignee?.[1] ?? "";
  if (assignee) body = body.replace(assignee[0], " ").trim();

  let dueDate: string | null = null;
  const iso = body.match(/(?:^|\s)(20\d{2}-\d{2}-\d{2})(?=\s|$)/);
  if (iso) {
    dueDate = iso[1];
    body = body.replace(iso[0], " ").trim();
  } else if (/(?:^|\s)오늘(?=\s|$)/.test(body)) {
    dueDate = localDate(now);
    body = body.replace(/(?:^|\s)오늘(?=\s|$)/, " ").trim();
  } else if (/(?:^|\s)내일(?=\s|$)/.test(body)) {
    dueDate = localDate(new Date(now.getTime() + 86_400_000));
    body = body.replace(/(?:^|\s)내일(?=\s|$)/, " ").trim();
  }
  if (!body) return null;
  return {
    kind,
    title: body.slice(0, 240),
    assigneeUsername,
    dueDate,
    recordType: kind === "task" ? "task" : "decision",
    status: kind === "task" ? "backlog" : kind === "decision" ? "decided" : "on_hold",
  };
}

export function actionPreview(draft: TelegramActionDraft) {
  const label = draft.kind === "task" ? "업무" : draft.kind === "decision" ? "결정" : "보류";
  return [
    `OS에 ${label} 기록을 만들까요?`,
    `제목: ${draft.title}`,
    draft.assigneeUsername ? `담당: @${draft.assigneeUsername}` : "담당: 작성자",
    draft.dueDate ? `기한: ${draft.dueDate}` : "",
    "확인 전에는 저장되지 않습니다.",
  ].filter(Boolean).join("\n");
}

const OLD_MARKERS = /대체된 지침|더 이상 따르지|폐기|철회|과거 기준|구버전|deprecated/i;

export function isOutdatedEvidence(result: SearchResult) {
  return OLD_MARKERS.test(`${result.heading}\n${result.text}`);
}

function numericFacts(text: string) {
  return [...text.matchAll(/(주|월|일)?\s*(\d+(?:\.\d+)?)\s*(편|회|개|명|시간|분|%|퍼센트)/g)]
    .map((match) => `${match[1] ?? ""}${match[3]}:${match[2]}`);
}

export function knowledgeConflictNotice(question: string, results: SearchResult[]) {
  const active = results.filter((result) => !isOutdatedEvidence(result));
  const outdated = results.filter(isOutdatedEvidence);
  if (active.length && outdated.length) return "⚠️ 과거·철회 표기가 있는 근거는 제외하고 현행 정본을 우선했습니다.";
  if (!active.length && outdated.length) return "⚠️ 검색된 근거가 모두 과거·철회 지침이라 답변 근거에서 제외했습니다. 현행 정본을 확인해 주세요.";
  if (!/(몇|얼마|하한|상한|수치|비율|%)/.test(question)) return "";
  const values = new Map<string, Set<string>>();
  for (const result of active) {
    for (const fact of numericFacts(result.text)) {
      const [unit, value] = fact.split(":");
      const set = values.get(unit) ?? new Set<string>();
      set.add(value); values.set(unit, set);
    }
  }
  const conflict = [...values.entries()].find(([, set]) => set.size > 1);
  if (!conflict) return "";
  return `⚠️ 정본 간 수치가 충돌합니다(${conflict[0]}: ${[...conflict[1]].join(", ")}). 아래 출처를 확인해 최신 기준을 확정해 주세요.`;
}

export function digestFingerprintParts(rows: Array<Record<string, unknown>>) {
  return rows.map((row) => [row.id, row.status, row.due_date, row.updated_at, row.current_version].join(":"));
}
