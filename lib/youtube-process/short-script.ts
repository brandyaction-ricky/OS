// 숏폼 대본 정본 (03_Content/숏폼, owner direction 2026-10-28: "가장 중요한 게 주제 선정과 스크립트 확정"): §3 길이 · §5 첫 문장 ·
// §6 말투 · §10 기계 검사 on a 숏폼 대본. The OS counts these when the staff AI submits and while the PD edits; its count wins.
import { CHARS_PER_MINUTE, overlapWith } from "../youtube-script-check.ts";
import { editableFields } from "./confirm.ts";
import { compactCount } from "./discover.ts";
import { topicEditable, type YpProject } from "./project.ts";
import type { YpShortScript, YpShortTopicPick } from "./stages.ts";

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
  for (const ref of against.refs ?? []) copied(ref, "참고 영상과");
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
// ── 주제 (owner direction 2026-10-28): 숏폼 starts from a 초안 주제 (keywords or a link); the references and their formulas come first and
// the PD fixes the topic from them, so 참고 영상 · 공식 are worked on from 주제 until the 대본 is confirmed. ──
export const SHORT_TOPIC_MAX = 40;
export function shortResearchOpen(project: Pick<YpProject, "yp">) {
  if (project.yp.topic.type !== "short") return false;
  return project.yp.stage === "topic" ? topicEditable(project) : project.yp.stage === "draft" && editableFields(project, "draft") === "all";
}
/** The staff AI's 주제 후보: three, each one line and each on a formula it drew now or one in the 공식 창고. */
export function shortTopicPickProblems(topics: YpShortTopicPick[], formulas: string[]) {
  const problems: string[] = [];
  if (topics.length !== 3) problems.push(`주제 후보는 3개예요 — 지금 ${topics.length}개`);
  topics.forEach((topic, index) => {
    if (/\n/.test(topic.title) || topic.title.length > SHORT_TOPIC_MAX) problems.push(`${index + 1}번째 주제는 한 줄 ${SHORT_TOPIC_MAX}자 이하예요 — 지금 ${topic.title.length}자`);
    if (!formulas.includes(topic.formula)) problems.push(`${index + 1}번째 주제의 공식 「${topic.formula}」가 formulas에도 창고에도 없어요`);
  });
  if (new Set(topics.map(topic => topic.title)).size !== topics.length) problems.push("주제 후보끼리 같아요");
  return problems;
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
/** What the render PC read off the page (yt-dlp): counts a platform hides stay null (Reels often, Meta 광고 always). */
export interface YpShortRefResult { ok: boolean; durationSeconds: number | null; transcript: string; thumb: boolean; sheet: boolean; error: string; views?: number | null; likes?: number | null; followers?: number | null }
export interface YpShortRefItem {
  url: string; title: string; channel: string; views: number | null; ratio: number | null; source: "market" | "pd"; result: YpShortRefResult | null;
  /** The YouTube search's subscriber and like counts (2026-10-28 반응도 기준). */
  followers?: number | null; likes?: number | null;
  /** Signed links to the thumbnail and the sheet of the first three seconds (헤드 카피), when the render PC kept them. */
  thumbUrl?: string | null; sheetUrl?: string | null;
}
// 반응도 기준 (owner 2026-10-28: "반응도가 높은 콘텐츠 레퍼런스만 취합"): many watched it, more than the channel's own followers, and
// the people who watched reacted. The YouTube search keeps only those; a link the PD put in is marked and, below the bar, not handed on.
// Set from 61 Korean 이직 · 퇴사 · 연봉 Shorts (2026-10-28 night): their likes are a median 0.64% of views, so the first bar (10만 · 2%)
// let none through; 5만 · 0.5% keeps 21 of them, the ones that spread past their channel (the owner: "기준이 충족된 레퍼런스가 최대한 많을수록").
export const SHORT_REF_BAR = { views: 50_000, ratio: 1, likeRate: 0.005 } as const;
export const SHORT_REF_BAR_TEXT = "조회 5만 이상 · 구독자 수보다 많이 봄 · 좋아요가 조회의 0.5% 이상";
export interface RefCounts { views: number | null; followers: number | null; likes: number | null }
/** What the render PC read off the page first, then the YouTube search's or the PD's own numbers. */
export const refCounts = (item: Pick<YpShortRefItem, "views" | "followers" | "likes" | "result">): RefCounts => ({
  views: item.result?.views ?? item.views ?? null, followers: item.result?.followers ?? item.followers ?? null, likes: item.result?.likes ?? item.likes ?? null });
/**
 * "below" when a known count is under the bar; "pass" when the views are over it and so is the reaction we can see — the likes, or
 * where a channel hides them the views against its followers; "unknown" without views or without both. Each check counts only where
 * the platform shows that number (TikTok shows no followers, some YouTube channels hide likes or subscribers).
 */
export function refReaction(counts: RefCounts): "pass" | "below" | "unknown" {
  const { views, followers, likes } = counts;
  const checks = [views === null ? null : views >= SHORT_REF_BAR.views,
    views === null || !followers ? null : views / followers >= SHORT_REF_BAR.ratio,
    views === null || !views || likes === null ? null : likes / views >= SHORT_REF_BAR.likeRate];
  return checks.includes(false) ? "below" : views === null || (likes === null && !followers) ? "unknown" : "pass";
}
/**
 * Whether a found Short is about the 검색어 (2026-10-28 시안 2: 「일이 안 맞는 신호」 brought 「오줌이 마려울 땐 이 포즈를…」 — 680만 views passed
 * the bar and YouTube matched it on 신호). Its title must share a two-letter run with a word of the 검색어 (일이 · 맞는 · 신호 here). A
 * 검색어 of one-letter words cannot be checked and passes; the PD's own links are never checked.
 */
export function refMatchesQuery(query: string, title: string) {
  const pairs = (text: string) => text.toLowerCase().split(/[^0-9a-z가-힣]+/).flatMap(word => { const chars = [...word]; return chars.slice(1).map((ch, i) => chars[i] + ch); });
  const wanted = new Set(pairs(query));
  return !wanted.size || pairs(title).some(pair => wanted.has(pair));
}
/**
 * A count as a page shows it — 「12.5만」, 「12만5천」, 「1천만」, 「10,000회」, 「1.2M」 — as a number; anything it cannot read is null.
 * 천 adds inside a group and 만 · 억 close one (1천만 = 1,000 × 10,000).
 */
export function parseCount(text: string) {
  const s = text.replace(/[,\s]/g, "").replace(/(회|명|개|뷰|views?)$/i, "");
  const latin = s.match(/^(\d+(?:\.\d+)?)([kKmM])?$/);
  if (latin) return Math.round(Number(latin[1]) * (latin[2] ? (/k/i.test(latin[2]) ? 1e3 : 1e6) : 1));
  const tokens = s.match(/(\d+(?:\.\d+)?)?(억|만|천)|\d+(?:\.\d+)?$/g);
  if (!s || !tokens || tokens.join("") !== s) return null;
  let total = 0, group = 0;
  for (const token of tokens) {
    const [, digits, unit] = token.match(/^(\d+(?:\.\d+)?)?(억|만|천)?$/)!;
    const n = digits === undefined ? 0 : Number(digits);
    if (unit === "천") group += (digits === undefined ? 1 : n) * 1e3;
    else if (unit) { total += (group + n || 1) * (unit === "억" ? 1e8 : 1e4); group = 0; }
    else group += n;
  }
  return Math.round(total + group);
}
/** Where a reference is from, for its card. */
export function refPlatform(url: string) {
  const host = (() => { try { return new URL(url).hostname; } catch { return ""; } })();
  return /(^|\.)tiktok\.com$/.test(host) ? "틱톡" : /(^|\.)instagram\.com$/.test(host) ? "릴스" : /(^|\.)facebook\.com$/.test(host) ? "메타 광고"
    : /(^|\.)(youtube\.com|youtu\.be)$/.test(host) ? "유튜브" : "링크";
}
/** 「조회 125만 · 구독자의 8.2배 · 좋아요 3.1%」 — what is known of the three. */
export function refCountsLine(counts: RefCounts) {
  const { views, followers, likes } = counts;
  return [views === null ? "" : `조회 ${compactCount(views)}`,
    views === null || !followers ? "" : `구독자의 ${Math.round(views / followers * 10) / 10}배`,
    views === null || !views || likes === null ? "" : `좋아요 ${Math.round(likes / views * 1000) / 10}%`].filter(Boolean).join(" · ");
}
export interface YpShortRefFetch { id: string; status: string; query: string; requestedAt: string; doneAt: string | null; error: string | null; items: YpShortRefItem[] }
