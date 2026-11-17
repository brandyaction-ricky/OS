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

/** One message: who wrote to whom (their Telegram @username when linked, so Telegram rings them), the request, the comment's start, the link. */
export function requestCommentText(input: { author: string; mentions: { name: string; username?: string | null }[]; title: string; body: string; url: string }) {
  const who = input.mentions.map((m) => m.username ? `@${m.username.replace(/^@/, "")}` : `${m.name}님`).join(" ");
  const lines = input.body.replace(/\r/g, "").split("\n").map((line) => line.trim()).filter(Boolean);
  let excerpt = lines.slice(0, EXCERPT_LINES).join("\n");
  const cut = lines.length > EXCERPT_LINES || excerpt.length > EXCERPT_CHARS;
  if (excerpt.length > EXCERPT_CHARS) excerpt = excerpt.slice(0, EXCERPT_CHARS - 1);
  return `💬 수정 요청 댓글 · ${input.author} → ${who}\n「${input.title.slice(0, 120)}」\n\n${excerpt}${cut ? "…" : ""}\n\nOS에서 보기: ${input.url}`;
}
