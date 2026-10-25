// One Markdown file per meeting: what was decided, who does what by when, open items, the
// summary and the full transcript. Used by both meeting screens' "MD로 내려받기".
export type MeetingMarkdownItem = { kind: "decision" | "task" | "open"; text: string; state: "pending" | "accepted" | "discarded"; ownerId?: string; dueOn?: string };
export type MeetingMarkdownInput = {
  title: string; startsAt: string | null; business?: string; attendees: string[];
  agenda: string; summary: string; transcript: string; items: MeetingMarkdownItem[]; nameOf: (id: string) => string;
};

const kst = (value: string | null) => value ? new Date(value).toLocaleString("ko-KR", { timeZone: "Asia/Seoul", dateStyle: "long", timeStyle: "short" }) : "일정 미정";
const block = (title: string, body: string) => body.trim() ? `## ${title}\n\n${body.trim()}\n` : "";

export function meetingMarkdown(m: MeetingMarkdownInput) {
  const kept = m.items.filter(item => item.state !== "discarded");
  const mark = (state: MeetingMarkdownItem["state"]) => state === "accepted" ? "" : " _(검수 전)_";
  const decisions = kept.filter(item => item.kind === "decision").map(item => `- ${item.text}${mark(item.state)}`).join("\n");
  const tasks = kept.filter(item => item.kind === "task").map(item =>
    `- [ ] ${item.text} — 담당 ${item.ownerId ? m.nameOf(item.ownerId) : "미정"} · 기한 ${item.dueOn || "미정"}${mark(item.state)}`).join("\n");
  const open = kept.filter(item => item.kind === "open").map(item => `- ${item.text}${mark(item.state)}`).join("\n");
  return [
    `# ${m.title}`, "",
    `- 일시: ${kst(m.startsAt)}`,
    ...(m.business ? [`- 사업: ${m.business}`] : []),
    `- 참석: ${m.attendees.map(m.nameOf).join(", ") || "미기록"}`, "",
    block("안건", m.agenda), block("결정", decisions), block("할 일", tasks), block("미결", open),
    block("요약", m.summary), block("회의 원문", m.transcript),
  ].filter((line, index, lines) => line !== "" || lines[index - 1] !== "").join("\n").trim() + "\n";
}

export function meetingFileName(title: string, startsAt: string | null) {
  const day = (startsAt ? new Date(startsAt) : new Date()).toLocaleDateString("sv-SE", { timeZone: "Asia/Seoul" });
  return `${day} ${title}`.replace(/[\\/:*?"<>|\n\r]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 120) + ".md";
}

export function downloadMarkdown(fileName: string, text: string) {
  const url = URL.createObjectURL(new Blob([text], { type: "text/markdown;charset=utf-8" })), link = document.createElement("a");
  link.href = url; link.download = fileName; document.body.append(link); link.click(); link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}
