// 텔레그램 아카이브 (수정 요청 2026-11-13): the links and one-line notes the team drops in its archive rooms, kept as OS reference
// documents in 03_Content/레퍼런스/{주제 폴더}. The rooms stay as they are, so a link is sorted by its kind (형식) and its topic, not by
// the room it came from. Pure helpers here; the webhook does the reading and writing (lib/server/telegram-archive.ts).
import { createHash } from "node:crypto";

export const ARCHIVE_FOLDER = "03_Content/레퍼런스";
/** The eight topic folders (2026-11-13 decision); a person moving a card to another folder is the answer. */
export const ARCHIVE_TOPICS = ["후킹·대본 구조", "썸네일·제목", "채널·계정 포맷", "영상 연출·편집", "AI 툴·자동화", "마케팅·세일즈 사례", "콘텐츠 주제 소재", "미분류"] as const;
export type ArchiveTopic = (typeof ARCHIVE_TOPICS)[number];
export const ARCHIVE_STATES = ["새로 들어옴", "검토함", "주제 후보", "사용함", "보관"] as const;
/** A first-word tag decides the folder without asking the AI. */
const TAG_TOPIC: Record<string, ArchiveTopic> = { 후킹: "후킹·대본 구조", 썸네일: "썸네일·제목", 채널: "채널·계정 포맷", 연출: "영상 연출·편집",
  ai툴: "AI 툴·자동화", 마케팅: "마케팅·세일즈 사례", 주제: "콘텐츠 주제 소재" };
const TRACKING = /^(si|igsh|igshid|img_index|utm_[a-z]+|fbclid|gclid|feature|pp|ab_channel|s|xmt|slof|_r|_t|ref|ref_src|share_id|is_from_webapp|sender_device)$/i;

/** The archive rooms: a comma list of chat ids from the environment (they are internal identifiers, never in the code). */
export const archiveChats = (value: string | undefined) => new Set((value ?? "").split(",").map((id) => id.trim()).filter((id) => /^-?\d+$/.test(id)));

/** Every http(s) link in a message, without the punctuation a sentence leaves after it. */
export function messageLinks(text: string) {
  return [...new Set((text.match(/https?:\/\/[^\s<>"'「」]+/gi) ?? []).map((url) => url.replace(/[).,;!?…·、。」』]+$/u, "")))];
}

/** One link however it was shared: lower-case host without www, tracking tails dropped (?si=, img_index, utm_*), youtu.be and shorts kept apart. */
export function normalizeLink(raw: string) {
  let url: URL;
  try { url = new URL(raw); } catch { return raw.trim(); }
  url.hash = "";
  url.hostname = url.hostname.toLowerCase().replace(/^(www|m)\./, "");
  if (url.hostname === "youtu.be") { const id = url.pathname.slice(1); url = new URL(`https://youtube.com/watch?v=${id}`); }
  for (const key of [...url.searchParams.keys()]) if (TRACKING.test(key)) url.searchParams.delete(key);
  url.searchParams.sort();
  const text = url.toString().replace(/\?$/, "");
  return text.endsWith("/") && url.pathname !== "/" ? text.slice(0, -1) : text;
}
/** The key a link is found again by (a tag on its document). */
export const linkKey = (normalized: string) => `ref:${createHash("sha256").update(normalized).digest("hex").slice(0, 16)}`;

export function platformOf(url: string) {
  const host = (() => { try { return new URL(url).hostname.replace(/^(www|m)\./, ""); } catch { return ""; } })();
  if (/(^|\.)youtube\.com$|^youtu\.be$/.test(host)) return "YouTube";
  if (/(^|\.)instagram\.com$/.test(host)) return "Instagram";
  if (/(^|\.)tiktok\.com$/.test(host)) return "TikTok";
  if (/(^|\.)threads\.(net|com)$/.test(host)) return "Threads";
  if (/(^|\.)(x|twitter)\.com$/.test(host)) return "X";
  return "기타";
}

/** 형식 from the link alone: reels, shorts and TikTok are 숏폼, a YouTube video 롱폼, a profile 채널, an image with no link 썸네일. */
export function formatOf(url: string | null) {
  if (!url) return "썸네일";
  const platform = platformOf(url), path = (() => { try { return new URL(url).pathname; } catch { return ""; } })();
  if (platform === "TikTok") return /\/video\//.test(path) ? "숏폼" : "채널";
  if (platform === "Instagram") return /^\/(reel|reels)\//.test(path) ? "숏폼" : /^\/(p|tv)\//.test(path) ? "게시물" : "채널";
  if (platform === "YouTube") return /^\/shorts\//.test(path) ? "숏폼" : /^\/watch/.test(path) || /^\/live\//.test(path) ? "롱폼" : "채널";
  if (platform === "Threads") return "스레드";
  if (platform === "X") return "게시물";
  return "툴·기타";
}

/** A first word such as #후킹 or #AI툴 (spaces and case ignored) names the folder. */
export function tagTopic(text: string): ArchiveTopic | null {
  const tag = text.trim().match(/^#([^\s#]+)/)?.[1]?.toLowerCase().replace(/\s+/g, "");
  return tag ? TAG_TOPIC[tag] ?? null : null;
}

/** Account details in a note (아이디 · 비밀번호 · pw: …) are never stored: the whole note is replaced. */
export function safeComment(text: string) {
  return /(아이디|비번|비밀번호|패스워드|password|passwd|\bpw\b|\bid\b)\s*[:：=]|id\s*\/\s*pw/i.test(text) ? "(계정 정보 제외)" : text;
}

/** The note around the links: the message without them, its tag kept (it is part of what the person wrote). */
export const commentOf = (text: string, links: string[]) => links.reduce((rest, link) => rest.split(link).join(" "), text).replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim();

export interface ArchiveMention { at: string; room: string; who: string; comment: string; receipt: string }
export interface ArchiveCard {
  link: string | null; platform: string; format: string; topic: ArchiveTopic; title: string; channel: string; thumbnail: string;
  views: number | null; likes: number | null; image: string; first: ArchiveMention;
}

const line = (key: string, value: string | number | null) => value === null || value === "" ? [] : [`${key}: ${String(value).replace(/\n/g, " ")}`];
const mentionLine = (m: ArchiveMention) => `- ${m.at.slice(0, 16).replace("T", " ")} · ${m.room} · ${m.who}${m.comment ? ` — ${m.comment.replace(/\n+/g, " ")}` : ""} (${m.receipt})`;

/** The reference document: a header block the archive screen reads (링크 · 플랫폼 · 형식 · 주제 · 방 · 올린 사람 · 상태 …), then the note. */
export function archiveDocument(card: ArchiveCard) {
  const title = (card.title || card.first.comment.split("\n")[0] || `${card.platform} ${card.format}`).slice(0, 120);
  const header = ["---", "source: telegram", ...line("링크", card.link), ...line("플랫폼", card.platform), ...line("형식", card.format), ...line("주제", card.topic),
    ...line("방", card.first.room), ...line("올린 사람", card.first.who), ...line("올린 시각", card.first.at), ...line("채널", card.channel), ...line("썸네일", card.thumbnail),
    ...line("이미지", card.image), ...line("수집 시점 조회수", card.views), ...line("수집 시점 좋아요", card.likes), "상태: 새로 들어옴", "---"];
  const body = [`# ${title}`, "", card.first.comment ? card.first.comment.split("\n").map((row) => `> ${row}`).join("\n") : "", "",
    card.link ? `[원본 열기](${card.link})` : "", "", "## 올린 기록", mentionLine(card.first)];
  return { title, content: [...header, "", ...body].filter((row, i, rows) => row !== "" || rows[i - 1] !== "").join("\n").trim() + "\n" };
}

/** Another mention of the same link joins its document (once per message), as 「추가 언급」. */
export function withMention(content: string, mention: ArchiveMention) {
  if (content.includes(`(${mention.receipt})`)) return null;
  const count = (content.match(/^- .* \(telegram:/gm) ?? []).length;
  const next = `${content.trimEnd()}\n${mentionLine(mention)}\n`;
  return /^추가 언급: \d+$/m.test(next) ? next.replace(/^추가 언급: \d+$/m, `추가 언급: ${count}`) : next.replace(/^상태: /m, `추가 언급: ${count}\n상태: `);
}
