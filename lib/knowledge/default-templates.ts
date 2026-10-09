import type { Template } from "./model";
const definitions: Array<[string, Template["default_space"], Template["kind"], string[]]> = [
  ["주간 운영 회의", "meeting", "meeting", ["지난 회의에서 넘어온 일", "안건", "메모", "결정", "할 일"]],
  ["프로젝트 회의", "meeting", "meeting", ["프로젝트 현황", "안건", "메모", "결정", "할 일"]],
  ["1:1", "meeting", "meeting", ["이야기할 것", "메모", "다음 행동"]],
  ["외부 미팅", "meeting", "meeting", ["목적", "안건", "메모", "후속 작업"]],
  ["데일리 노트", "mine", "doc", ["오늘 할 일", "메모", "오늘 회의"]],
  ["결정 기록", "team", "doc", ["배경", "선택지", "결정", "근거", "후속 작업"]],
  ["업무 절차 (정본용)", "team", "candidate", ["목적", "적용 범위", "담당", "절차", "확인 기준", "관련 문서"]],
  ["프로젝트 브리프", "team", "doc", ["문제", "목표", "범위", "일정", "완료 기준"]],
  ["캠페인 브리프", "team", "doc", ["목표", "대상", "메시지", "채널", "일정", "성과 기준"]],
  ["콘텐츠 기획안", "team", "doc", ["주제", "독자", "핵심 메시지", "구성", "관련 문서"]],
];
export const DEFAULT_TEMPLATES: Template[] = definitions.map(([name, default_space, kind, headings], index) => ({
  id: `default-${index + 1}`, name, default_space, kind, scope: "company", owner_id: null, sort_order: index,
  description: headings.join("\n"), body_md: headings.map(heading => `## ${heading}\n\n${heading === "오늘 할 일" ? "- [ ] " : ""}`).join("\n\n"),
}));
