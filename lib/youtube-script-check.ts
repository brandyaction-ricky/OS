// 원고 검수 정본 관문 1 (형식): the OS counts these when a script is submitted, and its count wins over the writer's own.
// The manuscript is the 원고 공정 정본 §8 format: "# 제목", a "<!-- 축: … -->" head line, an optional "<!-- 출처: … -->" line,
// then "## 섹션" headings over blank-line-separated paragraphs. 도입 length is left to the separate review: where 도입 ends
// and the main body starts is a judgement, and each paragraph is already capped at 300 characters here.

export interface ManuscriptCheck { narration: string; sections: string[]; paragraphs: string[]; chars: number; issues: string[] }

const BANNED: [string, string[]][] = [
  ["2인칭", ["당신", "여러분"]],
  ["결핍 소거 동사", ["채워진다", "사라진다", "해결된다", "비로소 만족", "비교가 없어진다"]],
  ["공포어", ["놓치면", "뒤처진다", "망한다", "꼬인다", "늦었다"]],
  ["작업어", ["목록", "대표 시청자상", "전환 명제", "소실점", "층위", "마디"]],
  ["AI 말버릇", ["라고 보면 돼요", "쉽게 말하면", "하지 마세요"]],
];
// ponytail: keyword heuristic for "수치·연구·후기·인용" paragraphs; the separate fact review (관문 5) is the real check.
const NEEDS_SOURCE = /%|연구|논문|조사|후기|에 따르면/;
const MAX_ISSUES = 30;
export const CHARS_PER_MINUTE = 600;

/** Body rules that also apply when a staff member edits the narration text directly (no headings left to check). */
export function checkScriptBody(paragraphs: string[], targetMinutes: number | null, sourced: Set<number> | null = null) {
  const issues: string[] = [];
  const chars = paragraphs.reduce((sum, paragraph) => sum + paragraph.length, 0);
  if (targetMinutes) {
    const target = targetMinutes * CHARS_PER_MINUTE;
    if (Math.abs(chars - target) > target * 0.15) issues.push(`총 ${chars}자 — 목표 ${targetMinutes}분(${target}자)의 ±15% 밖입니다.`);
  }
  let subscribe = 0;
  paragraphs.forEach((paragraph, index) => {
    const n = index + 1;
    if (paragraph.includes("\n")) issues.push(`${n}번 문단 안에 줄바꿈이 있습니다.`);
    if (paragraph.length < 80 || paragraph.length > 300) issues.push(`${n}번 문단 ${paragraph.length}자 — 80~300자여야 합니다.`);
    for (const [kind, words] of BANNED) for (const word of words) if (paragraph.includes(word)) issues.push(`${n}번 문단 ${kind} "${word}"`);
    const cue = paragraph.match(/\([^)]*\)/);
    if (cue) issues.push(`${n}번 문단 괄호 지시 "${cue[0]}"`);
    subscribe += paragraph.split("구독").length - 1;
    if (sourced && NEEDS_SOURCE.test(paragraph) && !sourced.has(n)) issues.push(`${n}번 문단에 수치·연구·후기가 있는데 출처 줄에 ${n}번이 없습니다.`);
  });
  if (subscribe >= 3) issues.push(`구독 요청이 ${subscribe}회입니다(2회까지).`);
  return { chars, issues };
}

export function checkManuscript(text: string, options: { title: string; targetMinutes: number }): ManuscriptCheck {
  const lines = text.replace(/\r\n?/g, "\n").trim().split("\n");
  const issues: string[] = [];
  const heading = lines[0]?.match(/^#\s+(.+)$/);
  if (!heading) issues.push("첫 줄은 \"# 채택 제목\"이어야 합니다.");
  else if (heading[1].trim() !== options.title.trim()) issues.push(`첫 줄 제목이 채택 제목과 다릅니다: "${options.title.trim()}"`);
  if (!/^<!--\s*축:.*-->\s*$/.test(lines[1] ?? "")) issues.push("둘째 줄에 머리 블록 \"<!-- 축: … | 중심 근거: … | 역할: … | 길이: … | 가상 인물: … -->\"이 없습니다.");
  let bodyStart = 2;
  const sourced = new Set<number>();
  const sourceLine = (lines[2] ?? "").match(/^<!--\s*출처:(.*)-->\s*$/);
  if (sourceLine) {
    bodyStart = 3;
    for (const match of sourceLine[1].matchAll(/(\d+)\s*→/g)) sourced.add(Number(match[1]));
  }
  const sections: string[] = [];
  const paragraphs: string[] = [];
  const perSection: number[] = [];
  let orphan = false;
  for (const block of lines.slice(bodyStart).join("\n").split(/\n\s*\n/).map((part) => part.trim()).filter(Boolean)) {
    const section = block.match(/^##\s+(.+)$/);
    if (section) {
      sections.push(section[1].trim());
      perSection.push(0);
      continue;
    }
    if (/^#|<!--/m.test(block)) { issues.push("본문에는 머리 블록 두 줄 외에 주석·제목·메모를 넣지 않습니다."); continue; }
    if (!sections.length) orphan = true;
    else perSection[perSection.length - 1]++;
    paragraphs.push(block);
  }
  if (orphan) issues.push("첫 문단 앞에 \"## 섹션 제목\"이 있어야 합니다.");
  if (perSection.includes(0)) issues.push("문단이 없는 섹션이 있습니다.");
  if (sections.length < 2 || sections.length > 5) issues.push(`섹션(##)이 ${sections.length}개입니다. 2~5개여야 합니다.`);
  for (const name of sections) if (name.length > 8) issues.push(`섹션 제목 "${name}"이 ${name.length}자입니다(8자 이내).`);
  const body = checkScriptBody(paragraphs, options.targetMinutes, sourced);
  const all = [...issues, ...body.issues];
  return { narration: paragraphs.join("\n\n"), sections, paragraphs, chars: body.chars,
    issues: all.length > MAX_ISSUES ? [...all.slice(0, MAX_ISSUES), `외 ${all.length - MAX_ISSUES}건`] : all };
}
