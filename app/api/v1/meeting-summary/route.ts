import { NextResponse } from "next/server";
import { OPENAI_ANSWER_MODEL } from "@/lib/config";
import { ApiError, apiErrorResponse, parseJson } from "@/lib/http";
import { authenticateRequest } from "@/lib/server/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function extractText(body: Record<string, unknown>) {
  const output = Array.isArray(body.output) ? body.output : [];
  return output.flatMap((item) => item && typeof item === "object" && Array.isArray((item as { content?: unknown[] }).content) ? (item as { content: unknown[] }).content : [])
    .filter((item) => item && typeof item === "object" && (item as { type?: string }).type === "output_text")
    .map((item) => String((item as { text?: string }).text ?? "")).join("\n").trim();
}

function localSummary(transcript: string) {
  const lines = transcript.split(/\n|(?<=[.!?다요])\s+/).map((line) => line.trim()).filter((line) => line.length >= 8);
  const decisions = lines.filter((line) => /(결정|합의|확정|하기로)/.test(line)).slice(0, 5);
  const actions = lines.filter((line) => /(담당|까지|해야|하기|진행|요청|확인)/.test(line)).slice(0, 7);
  const overview = lines.slice(0, 5);
  return `## 핵심 요약\n${overview.map((line) => `- ${line}`).join("\n") || "- 요약할 문장이 부족합니다."}\n\n## 결정사항\n${decisions.map((line) => `- ${line}`).join("\n") || "- 명시된 결정사항 없음"}\n\n## 후속 업무\n${actions.map((line) => `- ${line}`).join("\n") || "- 명시된 후속 업무 없음"}`;
}

export async function POST(request: Request) {
  try {
    await authenticateRequest(request);
    const body = await parseJson(request) as { transcript?: unknown };
    const transcript = typeof body.transcript === "string" ? body.transcript.trim() : "";
    if (transcript.length < 20 || transcript.length > 200_000) throw new ApiError(400, "INVALID_TRANSCRIPT", "회의 원문은 20자 이상 20만자 이하로 입력해 주세요.");
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) return NextResponse.json({ summary: localSummary(transcript), mode: "local" });
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 20_000);
    try {
      const response = await fetch("https://api.openai.com/v1/responses", {
        method: "POST",
        headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          model: OPENAI_ANSWER_MODEL,
          instructions: "브랜디액션 사내 회의록 편집자입니다. 제공된 원문만 사용해 한국어 Markdown으로 '핵심 요약', '결정사항', '후속 업무(담당자·기한이 있으면 포함)', '미해결 질문' 네 섹션을 간결하게 작성하세요. 추측하지 마세요.",
          input: transcript,
          max_output_tokens: 1200,
        }),
        signal: controller.signal,
      });
      const result = await response.json() as Record<string, unknown>;
      if (!response.ok) return NextResponse.json({ summary: localSummary(transcript), mode: "local" });
      return NextResponse.json({ summary: extractText(result) || localSummary(transcript), mode: "ai" });
    } catch {
      return NextResponse.json({ summary: localSummary(transcript), mode: "local" });
    } finally { clearTimeout(timeout); }
  } catch (error) { return apiErrorResponse(error); }
}
