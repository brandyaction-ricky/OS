// 회의 원문·요약을 지식 문서함 문서(01_Raw/주간회의, 02_Wiki/{사업}/운영/주간회의요약)
// 모양으로 만드는 순수 함수. 웹 회의 워크스페이스의 저장과 텔레그램 /회의기록이
// 정확히 같은 문서를 만들도록 여기 하나만 고친다. 외부 의존성 없음(클라이언트 안전).

import type { MeetingBusiness } from "./meeting-business";

export interface MeetingTodoLike { title: string; assignee: string; dueDate: string; dueLabel: string }
export interface MeetingExtractionLike { summary: string; decisions: string[]; pending: string[]; todos: MeetingTodoLike[] }

/** 기한별로 묶은 업무 체크리스트 — 옛 봇의 "## To-do (기한별)" 절과 같은 모양(요일
 * 표기는 생략해 간소화). 기한 없는 항목은 "기한 미정"으로 모은다. */
export function formatTodosMd(todos: MeetingTodoLike[]) {
  if (!todos.length) return "- (없음)";
  const groups = new Map<string, MeetingTodoLike[]>();
  for (const todo of todos) {
    const key = todo.dueDate || todo.dueLabel || "기한 미정";
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(todo);
  }
  return [...groups.entries()].map(([key, items]) =>
    [`### ${key}`, ...items.map((item) => `- [ ] ${item.title}${item.assignee ? ` — ${item.assignee}` : ""}`)].join("\n"),
  ).join("\n\n");
}

/** 회의 원문을 01_Raw/주간회의/{YYYY-MM}에 올릴 문서 모양으로 만든다. */
export function buildMeetingRawDocument(business: MeetingBusiness, date: string, content: string) {
  const title = `주간 회의 (${business.label}) — ${date}`;
  const content_md = [`# ${title}`, "", content].join("\n");
  return { title, content_md, folder: `01_Raw/주간회의/${date.slice(0, 7)}` };
}

/** 회의 요약을 02_Wiki/{사업}/운영/주간회의요약/{YYYY-MM}에 올릴 문서 모양으로 만든다.
 * 기존에 실제로 쌓여 있는 문서(핵심 요약/결정사항/미결사항/To-do)와 같은 절 구성. */
export function buildMeetingSummaryDocument(business: MeetingBusiness, date: string, result: MeetingExtractionLike) {
  const title = `주간 회의 요약 (${business.label}) — ${date}`;
  const content_md = [
    `# ${title}`, "",
    "## 핵심 요약", result.summary || "(요약 없음)", "",
    "## 결정사항", result.decisions.length ? result.decisions.map((item) => `- ${item}`).join("\n") : "- (없음)", "",
    "## 미결사항", result.pending.length ? result.pending.map((item) => `- ${item}`).join("\n") : "- (없음)", "",
    "## To-do (기한별)", formatTodosMd(result.todos),
  ].join("\n");
  return { title, content_md, folder: `02_Wiki/${business.wikiFolderSegment}/운영/주간회의요약/${date.slice(0, 7)}` };
}
