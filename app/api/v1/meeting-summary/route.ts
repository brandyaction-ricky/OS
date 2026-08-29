import { NextResponse } from "next/server";
import { OPENAI_ANSWER_MODEL } from "@/lib/config";
import { ApiError, apiErrorResponse, parseJson } from "@/lib/http";
import { authenticateRequest } from "@/lib/server/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface MeetingTodo { title: string; assignee: string; dueDate: string; dueLabel: string }
interface MeetingSummary { summary: string; decisions: string[]; pending: string[]; todos: MeetingTodo[] }

function sentences(transcript: string) {
  return transcript.split(/\n|(?<=[.!?다요])\s+/).map((line) => line.replace(/^[-*]\s*/, "").trim()).filter((line) => line.length >= 8);
}

function localSummary(transcript: string): MeetingSummary {
  const lines = sentences(transcript);
  const decisions = lines.filter((line) => /(결정|합의|확정|하기로)/.test(line)).slice(0, 8);
  const pending = lines.filter((line) => /(미정|보류|확인 필요|논의 필요|추후|아직)/.test(line)).slice(0, 8);
  const actionLines = lines.filter((line) => /(담당|까지|해야|진행|요청|확인|준비)/.test(line)).slice(0, 10);
  return {
    summary: lines.slice(0, 6).map((line) => `- ${line}`).join("\n") || "- 요약할 문장이 부족합니다.",
    decisions,
    pending,
    todos: actionLines.map((title) => ({ title, assignee: "", dueDate: "", dueLabel: "" })),
  };
}

function jsonText(body: Record<string, unknown>) {
  const output = Array.isArray(body.output) ? body.output : [];
  return output.flatMap((item) => item && typeof item === "object" && Array.isArray((item as { content?: unknown[] }).content) ? (item as { content: unknown[] }).content : [])
    .filter((item) => item && typeof item === "object" && (item as { type?: string }).type === "output_text")
    .map((item) => String((item as { text?: string }).text ?? "")).join("\n").trim();
}

function normalize(value: unknown, fallback: MeetingSummary): MeetingSummary {
  if (!value || typeof value !== "object") return fallback;
  const item = value as Record<string, unknown>;
  const strings = (input: unknown) => Array.isArray(input) ? input.map(String).map((text) => text.trim()).filter(Boolean).slice(0, 20) : [];
  const todos: MeetingTodo[] = Array.isArray(item.todos) ? item.todos.flatMap((todo) => {
    if (!todo || typeof todo !== "object") return [];
    const row = todo as Record<string, unknown>;
    const title = String(row.title ?? "").trim();
    return title ? [{ title, assignee: String(row.assignee ?? "").trim(), dueDate: /^\d{4}-\d{2}-\d{2}$/.test(String(row.dueDate ?? "")) ? String(row.dueDate) : "", dueLabel: String(row.dueLabel ?? "").trim() }] : [];
  }).slice(0, 20) : [];
  return { summary: String(item.summary ?? fallback.summary).trim(), decisions: strings(item.decisions), pending: strings(item.pending), todos };
}

export async function POST(request: Request) {
  try {
    await authenticateRequest(request);
    const body = await parseJson(request) as { transcript?: unknown; meetingDate?: unknown; business?: unknown };
    const transcript = typeof body.transcript === "string" ? body.transcript.trim() : "";
    if (transcript.length < 20 || transcript.length > 200_000) throw new ApiError(400, "INVALID_TRANSCRIPT", "회의 원문은 20자 이상 20만자 이하로 입력해 주세요.");
    const fallback = localSummary(transcript);
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) return NextResponse.json({ ...fallback, mode: "local" });
    const meetingDate = typeof body.meetingDate === "string" && /^\d{4}-\d{2}-\d{2}$/.test(body.meetingDate) ? body.meetingDate : new Date().toISOString().slice(0, 10);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30_000);
    try {
      const response = await fetch("https://api.openai.com/v1/responses", {
        method: "POST",
        headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          model: OPENAI_ANSWER_MODEL,
          instructions: `브랜디액션 사내 회의 기록 편집자입니다. 회의일은 ${meetingDate}입니다. 원문에 명시된 내용만 추출하고 담당자나 기한을 절대 추측하지 마세요. 상대 기한은 회의일을 기준으로 YYYY-MM-DD로 변환하되 불명확하면 dueDate를 비우고 원문 표현을 dueLabel에 남기세요. summary는 한국어 글머리표 문자열로 작성하세요. JSON만 출력하세요.`,
          input: transcript,
          text: { format: { type: "json_schema", name: "meeting_summary", strict: true, schema: { type: "object", additionalProperties: false, properties: { summary: { type: "string" }, decisions: { type: "array", items: { type: "string" } }, pending: { type: "array", items: { type: "string" } }, todos: { type: "array", items: { type: "object", additionalProperties: false, properties: { title: { type: "string" }, assignee: { type: "string" }, dueDate: { type: "string" }, dueLabel: { type: "string" } }, required: ["title", "assignee", "dueDate", "dueLabel"] } } }, required: ["summary", "decisions", "pending", "todos"] } } },
          max_output_tokens: 1800,
        }),
        signal: controller.signal,
      });
      const result = await response.json() as Record<string, unknown>;
      if (!response.ok) return NextResponse.json({ ...fallback, mode: "local" });
      const raw = jsonText(result);
      return NextResponse.json({ ...normalize(raw ? JSON.parse(raw) : null, fallback), mode: "ai" });
    } catch { return NextResponse.json({ ...fallback, mode: "local" }); }
    finally { clearTimeout(timeout); }
  } catch (error) { return apiErrorResponse(error); }
}
