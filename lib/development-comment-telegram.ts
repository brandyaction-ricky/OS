import { teamBusiness } from "./team/business.ts";

// 수정 요청 댓글 → 텔레그램 (2026-11-17 대표): a comment that names people with 「@ 함께 볼 사람」 goes to the business rooms the
// confirmed meetings already go to — 마이인 → 액션팀 업무 소통방, 에듀 → 마케팅 업무 소통방 — never to anyone's private chat.
export type CommentRoom = "myin" | "edu";

/** The rooms for a request: its project's business; a company-wide project (브랜디액션 OS, TIPS) goes where the people named are. */
export function requestCommentRooms(project: { title?: string | null; brand?: string | null }, affiliations: string[]): CommentRoom[] {
  const names = [project.brand ?? "", project.title ?? ""].filter(Boolean);
  const business = names.map((name) => teamBusiness(name)?.key ?? (/^myin/i.test(name) ? "myin" : null)).find((key) => key === "myin" || key === "edu");
  if (business) return [business];
  // RS 협업 = the marketing-education collaborators (company roster); everyone else works in 액션팀's room.
  return [...new Set(affiliations.map((affiliation): CommentRoom => affiliation.trim() === "RS 협업" ? "edu" : "myin"))];
}

const EXCERPT_LINES = 3;
const EXCERPT_CHARS = 300;

/** The start of a text: its first 3 non-empty lines, at most 300 characters, "…" when cut. */
function excerpt(body: string) {
  const lines = body.replace(/\r/g, "").split("\n").map((line) => line.trim()).filter(Boolean);
  let text = lines.slice(0, EXCERPT_LINES).join("\n");
  const cut = lines.length > EXCERPT_LINES || text.length > EXCERPT_CHARS;
  if (text.length > EXCERPT_CHARS) text = text.slice(0, EXCERPT_CHARS - 1);
  return `${text}${cut ? "…" : ""}`;
}

/** One message: who wrote to whom (their Telegram @username when linked, so Telegram rings them), the request, the comment's start, the link. */
export function requestCommentText(input: { author: string; mentions: { name: string; username?: string | null }[]; title: string; body: string; url: string }) {
  const who = input.mentions.map((m) => m.username ? `@${m.username.replace(/^@/, "")}` : `${m.name}님`).join(" ");
  return `💬 수정 요청 댓글 · ${input.author} → ${who}\n「${input.title.slice(0, 120)}」\n\n${excerpt(input.body)}\n\nOS에서 보기: ${input.url}`;
}

// 운영 반영 공지 (2026-11-17 대표): a development log saved as 운영 · 완료 goes, as the bot, to the same business room.
// Only the log — a deployment record (record_deployment) holds test results, not a summary, and would announce the same release twice.
export function isReleaseLog(record: { record_type?: string | null; stage?: string | null; status?: string | null }) {
  return record.record_type === "development_log" && record.stage === "production" && record.status === "completed";
}

/** A log's room: its project's business; a company-wide project (브랜디액션 OS, TIPS) goes to the requester's room — 액션팀 when there is no request. */
export function releaseLogRooms(project: { title?: string | null; brand?: string | null }, requesterAffiliation?: string | null) {
  return requestCommentRooms(project, [requesterAffiliation ?? ""]);
}

// 쉬운 설명 (2026-11-17 대표): written so staff understand the feature at once, not squeezed into 3 lines — the whole of it goes, paragraph
// breaks kept, cut only near Telegram's 4096 characters per message.
const PLAIN_CHARS = 2500;

function plainText(body: string) {
  const text = body.replace(/\r/g, "").split("\n").map((line) => line.trim()).join("\n").replace(/\n{3,}/g, "\n\n").trim();
  return text.length > PLAIN_CHARS ? `${text.slice(0, PLAIN_CHARS - 1)}…` : text;
}

/** Staff read plain words only: the 쉬운 설명 (the log's own, else its request's), never the developer summary; none → the title alone. */
export function releaseLogText(input: { project: string; title: string; plain?: string | null; url: string }) {
  const plain = input.plain?.trim() ? `\n\n${plainText(input.plain)}` : "";
  return `🚀 개발 반영 · ${input.project}\n「${input.title.slice(0, 120)}」${plain}\n\nOS에서 보기: ${input.url}`;
}
