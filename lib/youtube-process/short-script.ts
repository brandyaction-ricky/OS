// 숏폼 대본 정본 (03_Content/숏폼, owner direction 2026-10-28: "가장 중요한 게 주제 선정과 스크립트 확정"): §3 길이 · §5 첫 문장 ·
// §6 말투 · §10 기계 검사 on a 숏폼 대본. The OS counts these when the staff AI submits and while the PD edits; its count wins.
import { CHARS_PER_MINUTE, overlapWith } from "../youtube-script-check.ts";
import type { YpShortScript } from "./stages.ts";

export const SHORT_SCRIPT = { min: 250, max: 370, max60: 490, first: 25, line: 24, hard: 30, longLines: 3, head: 20 } as const;
const MARK = /^\s*\[(관계|사람)\]\s*/;
/** One line = one sentence = one screen (§6 형식); a leading [관계] or [사람] is the screen hint (§7), not spoken. */
export function scriptLines(text: string) {
  return text.split(/\r?\n/).map(line => line.trim()).filter(Boolean)
    .map(line => ({ text: line.replace(MARK, "").trim(), mark: (line.match(MARK)?.[1] ?? "") as "" | "관계" | "사람" })).filter(line => line.text);
}
const BANNED: [RegExp, string][] = [
  [/아까|앞에서|이 영상|지난번|위에서 말한/, "바깥을 가리키는 말"],
  [/당신|여러분/, "부르는 말"],
  [/안녕하세요|오늘은|이번 영상|알아볼게요/, "인사 · 예고"],
];
export interface ShortScriptCheck { chars: number; seconds: number; lines: number; problems: string[]; notes: string[] }

/** problems = §10 기계 검사 failures (고쳐서 다시 낸다); notes = what only fits a 60-second Short. refs and canon are compared 10 letters at a time. */
export function checkShortScript(text: string, against: { refs?: string[]; canon?: string } = {}): ShortScriptCheck {
  const lines = scriptLines(text);
  const spoken = lines.map(line => line.text).join(" ");
  const chars = spoken.length, problems: string[] = [], notes: string[] = [];
  const result = () => ({ chars, seconds: Math.round(chars / CHARS_PER_MINUTE * 60), lines: lines.length, problems, notes });
  if (!lines.length) { problems.push("대본을 써 주세요"); return result(); }
  if (chars < SHORT_SCRIPT.min) problems.push(`전체 ${chars}자예요 — ${SHORT_SCRIPT.min}자 이상으로 써요`);
  else if (chars > SHORT_SCRIPT.max60) problems.push(`전체 ${chars}자예요 — ${SHORT_SCRIPT.max60}자(60초)를 넘어요. 통찰이 하나인지 먼저 봐요`);
  else if (chars > SHORT_SCRIPT.max) notes.push(`${chars}자라 60초 쇼츠로만 쓸 수 있어요 (기본 ${SHORT_SCRIPT.max}자까지)`);
  if (lines[0].text.length > SHORT_SCRIPT.first) problems.push(`첫 문장이 ${lines[0].text.length}자예요 — ${SHORT_SCRIPT.first}자 이하로 써요`);
  lines.forEach((line, index) => { if (line.text.length > SHORT_SCRIPT.hard) problems.push(`${index + 1}번째 줄이 ${line.text.length}자예요 — ${SHORT_SCRIPT.hard}자를 넘으면 둘로 나눠요`); });
  const long = lines.filter(line => line.text.length > SHORT_SCRIPT.line).length;
  if (long > SHORT_SCRIPT.longLines) problems.push(`${SHORT_SCRIPT.line}자 넘는 줄이 ${long}개예요 — ${SHORT_SCRIPT.longLines}개까지`);
  for (const [pattern, name] of BANNED) lines.forEach((line, index) => { const hit = line.text.match(pattern)?.[0]; if (hit) problems.push(`${name} 「${hit}」 (${index + 1}번째 줄)`); });
  const copied = (source: string, name: string) => {
    if (!source.trim()) return;
    const find = overlapWith(source);
    for (const [index, line] of lines.entries()) { const hit = find(line.text); if (hit) { problems.push(`${name} 같은 구간 「${hit}」 (${index + 1}번째 줄) — 구조만 빌리고 문장은 새로 써요`); return; } }
  };
  for (const ref of against.refs ?? []) copied(ref, "레퍼런스와");
  copied(against.canon ?? "", "정본과");
  return result();
}

/** The texts a 대본 must not copy: the PD's references (title and pasted script), the titles the AI read and what the fetched references say. */
export const refTexts = (script: Pick<YpShortScript, "refs" | "ai">, fetched?: Pick<YpShortRefFetch, "items"> | null) => [
  ...script.refs.map(ref => `${ref.title}\n${ref.script}`), ...(script.ai?.picked ?? []).map(ref => ref.title),
  ...(fetched?.items ?? []).map(item => `${item.title}\n${(item.result?.transcript ?? "").replace(/^[\d.]+ /gm, "")}`)];
/** The 헤드 카피 (first screen, §5): set, and short enough for two lines of big type. */
export function headCopyProblem(head: string) {
  const text = head.trim();
  return !text ? "첫 화면 헤드 카피를 써 주세요" : text.length > SHORT_SCRIPT.head ? `헤드 카피가 ${text.length}자예요 — ${SHORT_SCRIPT.head}자 이하로 써요` : "";
}
/** The one-line reason the 대본 확정 cannot be made yet, or "" (the canon overlap is counted when the AI submits). */
export function shortScriptMissing(script: YpShortScript, fetched?: Pick<YpShortRefFetch, "items"> | null) {
  if (!script.insight.trim()) return "통찰 한 줄을 써 주세요";
  return headCopyProblem(script.headCopy ?? "") || (checkShortScript(script.text, { refs: refTexts(script, fetched) }).problems[0] ?? "");
}

// ── 레퍼런스 받기 (§2-2, owner direction 2026-10-28): the render PC keeps each reference's thumbnail, first three seconds and words ──
/** Where the render PC may fetch from (yt-dlp): YouTube, Instagram, TikTok and the Meta 광고 라이브러리; nothing else is handed to it. */
export const REF_HOSTS = ["youtube.com", "youtu.be", "instagram.com", "facebook.com", "tiktok.com"] as const;
export function refHostOk(link: string) {
  let url: URL;
  try { url = new URL(link); } catch { return false; }
  return url.protocol === "https:" && REF_HOSTS.some(host => url.hostname === host || url.hostname.endsWith(`.${host}`));
}
export interface YpShortRefResult { ok: boolean; durationSeconds: number | null; transcript: string; thumb: boolean; sheet: boolean; error: string }
export interface YpShortRefItem {
  url: string; title: string; channel: string; views: number | null; ratio: number | null; source: "market" | "pd"; result: YpShortRefResult | null;
  /** Signed links to the thumbnail and the sheet of the first three seconds (헤드 카피), when the render PC kept them. */
  thumbUrl?: string | null; sheetUrl?: string | null;
}
export interface YpShortRefFetch { id: string; status: string; query: string; requestedAt: string; doneAt: string | null; error: string | null; items: YpShortRefItem[] }
