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

/** 운영지침 문서(02_Wiki/{사업}/운영/운영지침)의 위치. 사업당 하나, 계속 누적한다. */
export function guidelineDocumentLocation(business: MeetingBusiness) {
  return { title: `운영지침 (${business.label})`, folder: `02_Wiki/${business.wikiFolderSegment}/운영` };
}

/** 확인된 결정 하나를 운영지침에 한 줄 추가한다. 충돌한 기존 줄은 지우지 않고
 * "대체" 표시만 남긴다(썸네일 지침 문서의 '대체된 지침' 관례와 동일 — 나중에
 * "그때 왜 바꿨더라"를 찾을 수 있게). 문서가 비어 있으면 제목까지 새로 만든다. */
export function appendGuidelineEntry(
  currentContent: string,
  entry: { decision: string; date: string; meetingTitle: string; supersedes: string | null; businessLabel: string },
) {
  const line = [
    `- **${entry.date}** ${entry.decision}`,
    entry.meetingTitle ? ` — 회의: ${entry.meetingTitle}` : "",
    entry.supersedes ? `\n  ↳ 대체: ~~${entry.supersedes}~~` : "",
  ].join("");
  const body = currentContent.trim();
  return body ? `${body}\n${line}` : `# 운영지침 (${entry.businessLabel})\n\n${line}`;
}
