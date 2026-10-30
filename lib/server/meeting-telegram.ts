import { teamBusiness } from "@/lib/team/business";
import { createServiceSupabase } from "@/lib/supabase/server";

// 회의 확정 → 텔레그램 (2026-10-30 대표 요청): the confirmed meeting's summary goes to every chat that turned on
// /회의공유켜기. A meeting shared only with attendees never leaves the OS.
type Item = { kind: string; text: string; state: string; ownerId?: string; dueOn?: string };
type Row = { id: string; title: string; brand: string | null; starts_at: string | null; metadata: { visibility?: string; summary?: string; items?: Item[] } };

export function meetingTelegramText(row: Row, names: Record<string, string>, origin: string) {
  const items = (row.metadata.items ?? []).filter(item => item.state !== "discarded" && item.text.trim());
  const list = (kind: string, label: string, line: (item: Item) => string) => {
    const rows = items.filter(item => item.kind === kind);
    return rows.length ? `\n\n${label} ${rows.length}\n${rows.map(line).join("\n")}` : "";
  };
  const day = row.starts_at ? new Date(row.starts_at).toLocaleDateString("ko-KR", { timeZone: "Asia/Seoul", month: "long", day: "numeric", weekday: "short" }) : "";
  const head = `📋 회의 확정 · ${row.title || "제목 없음"}\n${[day, teamBusiness(row.brand ?? "")?.label].filter(Boolean).join(" · ")}`;
  const summary = (row.metadata.summary ?? "").replace(/^#+\s*/gm, "■ ").trim();
  const tail = list("decision", "✅ 결정", item => `- ${item.text}`)
    + list("task", "📌 업무", item => `- ${item.text}${item.ownerId ? ` · ${names[item.ownerId] ?? "담당"}` : " · 담당 미정"}${item.dueOn ? ` · ${item.dueOn.slice(5).replace("-", "/")}까지` : ""}`)
    + list("open", "❓ 다음 회의로", item => `- ${item.text}`);
  const link = `\n\nOS에서 보기: ${origin}/organization/meetings?meeting=${row.id}`;
  // Telegram allows 4096 characters: the lists and the link always fit, the summary gives way.
  const room = 3900 - head.length - tail.length - link.length - 4;
  const body = summary && room > 40 ? `\n\n${summary.length > room ? `${summary.slice(0, room - 1)}…` : summary}` : "";
  return `${head}${body}${tail}`.slice(0, 3900 - link.length) + link;
}

export async function shareConfirmedMeeting(id: string, origin: string) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) return;
  const supabase = createServiceSupabase();
  const [{ data: row }, { data: chats }] = await Promise.all([
    supabase.from("os_records").select("id,title,brand,starts_at,metadata").eq("id", id).eq("record_type", "meeting").maybeSingle<Row>(),
    supabase.from("os_telegram_chats").select("external_chat_id").eq("meeting_summary_enabled", true),
  ]);
  if (!row || row.metadata.visibility === "attendees" || !chats?.length) return;
  const owners = [...new Set((row.metadata.items ?? []).flatMap(item => item.ownerId ? [item.ownerId] : []))];
  const { data: people } = owners.length ? await supabase.from("os_profiles").select("id,display_name").in("id", owners) : { data: [] };
  const text = meetingTelegramText(row, Object.fromEntries((people ?? []).map(person => [person.id, person.display_name])), origin);
  for (const chat of chats) {
    const response = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ chat_id: chat.external_chat_id, text, link_preview_options: { is_disabled: true } }), signal: AbortSignal.timeout(15_000) }).catch(() => null);
    if (!response?.ok) console.warn("[telegram] meeting summary not sent", response?.status ?? "network");
  }
}
