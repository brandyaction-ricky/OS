// 원고 검수 정본 관문 1 (형식): the OS counts these when a script is submitted, and its count wins over the writer's own.
// The manuscript is the 원고 공정 정본 §8 format: "# 제목", a "<!-- 축: … -->" head line, an optional "<!-- 출처: … -->" line,
// then "## 섹션" headings over blank-line-separated paragraphs. 도입 length is left to the separate review: where 도입 ends
// and the main body starts is a judgement, and each paragraph is already capped at 300 characters here.

/**
 * Paragraph numbers the 출처 line covers: one number, a range (9~15, 9-15) or a group (8, 9) before each "→"
 * (로건 피드백 A-4: only one number per arrow was read, and ranges and groups failed with no hint).
 */
export function sourcedParagraphs(line: string) {
  const numbers = new Set<number>();
  for (const match of line.matchAll(/((?:\d+\s*(?:[~\-–]\s*\d+)?\s*[,，·]\s*)*\d+\s*(?:[~\-–]\s*\d+)?)\s*→/g))
    for (const part of match[1].split(/[,，·]/)) {
      const [from, to = from] = part.split(/[~\-–]/).map(text => Number(text.trim()));
      for (let n = from; n <= Math.min(to, from + 200); n += 1) numbers.add(n);
    }
  return numbers;
}

export interface ManuscriptCheck { narration: string; sections: string[]; paragraphs: string[]; chars: number; issues: string[] }

const BANNED: [string, string[]][] = [
  ["2인칭", ["당신", "여러분"]],
  ["결핍 소거 동사", ["채워진다", "사라진다", "해결된다", "비로소 만족", "비교가 없어진다"]],
  ["공포어", ["놓치면", "뒤처진다", "망한다", "꼬인다", "늦었다"]],
  ["작업어", ["목록", "대표 시청자상", "전환 명제", "소실점", "층위", "마디", "판정", "관문", "연타", "설득 재료", "재정의", "관통"]],
  ["AI 말버릇", ["라고 보면 돼요", "쉽게 말하면", "하지 마세요"]],
];
// ponytail: keyword heuristic for "수치·연구·후기·인용" paragraphs; the separate fact review (관문 5) is the real check.
const NEEDS_SOURCE = /%|연구|논문|조사|후기|에 따르면/;
const MAX_ISSUES = 30;
// A banned word counts only where a word starts: "마디" (the outline unit) is banned, "첫마디" and "한마디" are ordinary speech.
const bannedAt = (text: string, word: string) => new RegExp(`(^|[^가-힣])${word}`).test(text);
// A one-syllable noun ('축'·'결'·'업') counts only standing alone, so 결국·결과·축하·사업 stay ordinary words.
const ALONE = "(?:이라고|이라는|이에요|입니다|이죠|으로|에서|은|이|을|에|로|도|만)?(?![가-힣])";
// '축'·'결' as a concept name inside the video: "이 영상의 축", "결이라고 불러요", "서른 개의 결".
const CONCEPT_NAME = new RegExp(`(?:영상|오늘|이번|편|이야기)의\\s*[축결]${ALONE}|(?:개|가지)의?\\s+[축결]${ALONE}|(?<![가-힣])[축결]이?라고\\s*(?:불러|부르|부릅|하|해|할)[가-힣]*`);
// 사슬 낭독: four or more links of the IP chain (결핍 → 욕구 → 행동 → 강점 → 정체성 → 업) in one paragraph.
const CHAIN = [/결핍/, /욕구/, /행동/, /강점/, /정체성/, new RegExp(`(?<![가-힣])업${ALONE}`)];
// 정본 겹침: 10 characters in a row (spaces removed) that also stand in the four 원고 정본; the canon allows one set phrase.
const OVERLAP = 10;
const ALLOWED_PHRASES = ["저희 진단 받으신 분 중에"];
const squeeze = (text: string) => text.replace(/\s+/g, "");

function canonWindows(canon: string) {
  let text = squeeze(canon);
  // A newline never survives squeeze, so no window can run across a cut-out allowed phrase.
  for (const phrase of ALLOWED_PHRASES) text = text.split(squeeze(phrase)).join("\n");
  const windows = new Set<string>();
  for (let i = 0; i + OVERLAP <= text.length; i++) windows.add(text.slice(i, i + OVERLAP));
  return windows;
}
/** The first stretch of the paragraph that also stands in the canon, as written (with its spaces), or null. */
function canonOverlap(paragraph: string, windows: Set<string>) {
  const at: number[] = [];
  for (let i = 0; i < paragraph.length; i++) if (!/\s/.test(paragraph[i])) at.push(i);
  const flat = at.map((i) => paragraph[i]).join("");
  for (let start = 0; start + OVERLAP <= flat.length; start++) {
    if (!windows.has(flat.slice(start, start + OVERLAP))) continue;
    let end = start + OVERLAP;
    while (end < flat.length && windows.has(flat.slice(end + 1 - OVERLAP, end + 1))) end++;
    return paragraph.slice(at[start], at[end - 1] + 1);
  }
  return null;
}
export const CHARS_PER_MINUTE = 600;

/**
 * Body rules that also apply when a staff member edits the narration text directly (no headings left to check).
 * `canon` is the text of the four 원고 정본 for the 정본 겹침 count; without it that count is skipped.
 */
export function checkScriptBody(paragraphs: string[], targetMinutes: number | null, sourced: Set<number> | null = null, canon = "") {
  const issues: string[] = [];
  const chars = paragraphs.reduce((sum, paragraph) => sum + paragraph.length, 0);
  if (targetMinutes) {
    const target = targetMinutes * CHARS_PER_MINUTE;
    if (Math.abs(chars - target) > target * 0.15) issues.push(`총 ${chars}자 — 목표 ${targetMinutes}분(${target}자)의 ±15% 밖입니다.`);
  }
  let subscribe = 0;
  const windows = canon ? canonWindows(canon) : null;
  paragraphs.forEach((paragraph, index) => {
    const n = index + 1;
    if (paragraph.includes("\n")) issues.push(`${n}번 문단 안에 줄바꿈이 있습니다.`);
    if (paragraph.length < 80 || paragraph.length > 300) issues.push(`${n}번 문단 ${paragraph.length}자 — 80~300자여야 합니다.`);
    for (const [kind, words] of BANNED) for (const word of words) if (bannedAt(paragraph, word)) issues.push(`${n}번 문단 ${kind} "${word}"`);
    const concept = paragraph.match(CONCEPT_NAME);
    if (concept) issues.push(`${n}번 문단 작업어 "${concept[0]}" — '축'·'결'을 개념 이름으로 쓰지 않습니다.`);
    const links = CHAIN.filter((link) => link.test(paragraph)).length;
    if (links >= 4) issues.push(`${n}번 문단 사슬 낭독 — 결핍·욕구·행동·강점·정체성·업 중 ${links}개가 한 문단에 있습니다(3개까지).`);
    const copied = windows && canonOverlap(paragraph, windows);
    if (copied) issues.push(`${n}번 문단 정본 겹침 "${copied}" — 정본 문장을 옮기지 말고 이 편의 말로 새로 씁니다.`);
    const cue = paragraph.match(/\([^)]*\)/);
    if (cue) issues.push(`${n}번 문단 괄호 지시 "${cue[0]}"`);
    subscribe += paragraph.split("구독").length - 1;
    if (sourced && NEEDS_SOURCE.test(paragraph) && !sourced.has(n)) issues.push(`${n}번 문단에 수치·연구·후기가 있는데 출처 줄에 ${n}번이 없습니다. (예: <!-- 출처: ${n} → 칙센트미하이·르페브르(1989) | 9~15 → 같은 연구 | 8, 9 → 통계청 -->)`);
  });
  if (subscribe >= 3) issues.push(`구독 요청이 ${subscribe}회입니다(2회까지).`);
  const body = paragraphs.join("\n");
  const supposes = body.match(/[라다]고\s?해\s?보죠/g)?.length ?? 0;
  if (supposes >= 4) issues.push(`틀 반복 "~라고 해보죠" ${supposes}회입니다(3회까지).`);
  // ponytail: "맞아요"로 받는 반론 = "맞아요" right before a turn (근데·그런데·하지만·다만); a plain agreeing "맞아요" is not counted.
  const concedes = body.match(/맞아요[.!,]?\s*(?:근데|그런데|하지만|다만)/g)?.length ?? 0;
  if (concedes >= 3) issues.push(`틀 반복 "맞아요. 근데…"로 받는 반론 ${concedes}회입니다(2회까지).`);
  return { chars, issues };
}

export function checkManuscript(text: string, options: { title: string; targetMinutes: number; canon?: string }): ManuscriptCheck {
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
    for (const n of sourcedParagraphs(sourceLine[1])) sourced.add(n);
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
  const body = checkScriptBody(paragraphs, options.targetMinutes, sourced, options.canon);
  const all = [...issues, ...body.issues];
  return { narration: paragraphs.join("\n\n"), sections, paragraphs, chars: body.chars,
    issues: all.length > MAX_ISSUES ? [...all.slice(0, MAX_ISSUES), `외 ${all.length - MAX_ISSUES}건`] : all };
}
