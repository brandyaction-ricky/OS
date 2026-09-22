import { OPENAI_ANSWER_MODEL } from "@/lib/config";
import { jsonText } from "./meeting-summary";

// 회의 결정사항 전부를 운영지침 후보로 본다(추가 분류 없음 — 대표 결정).
// 여기서는 현재 운영지침과 문자 그대로 상충하는지만 판정한다. 판정은 참고용 — 실제
// 반영은 텔레그램 확인 버튼으로 사람이 한다(⛔ 여기서 문서를 갱신하지 않는다).

export interface GuidelineConflictCheck { decision: string; conflictsWith: string | null }

export async function checkGuidelineConflicts(currentGuideline: string, decisions: string[]): Promise<GuidelineConflictCheck[]> {
  const fallback = decisions.map((decision) => ({ decision, conflictsWith: null as string | null }));
  if (!decisions.length) return [];
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey || !currentGuideline.trim()) return fallback;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15_000);
  try {
    const response = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: OPENAI_ANSWER_MODEL,
        instructions: "현재 운영지침과 새 결정사항 목록을 비교하세요. 각 결정이 현재 지침의 어느 줄과 실제로 내용이 상충하면 그 줄을 그대로 인용하고, 상충하지 않으면 빈 문자열을 반환하세요. 지침에 없는 내용을 지어내거나 일반론으로 추측하지 마세요.",
        input: `# 현재 운영지침\n${currentGuideline.slice(0, 4000)}\n\n# 새 결정사항\n${decisions.map((item, index) => `${index + 1}. ${item}`).join("\n")}`,
        text: {
          format: {
            type: "json_schema", name: "guideline_conflicts", strict: true,
            schema: {
              type: "object", additionalProperties: false,
              properties: { results: { type: "array", items: { type: "object", additionalProperties: false, properties: { decision: { type: "string" }, conflictsWith: { type: "string" } }, required: ["decision", "conflictsWith"] } } },
              required: ["results"],
            },
          },
        },
        max_output_tokens: 800,
      }),
      signal: controller.signal,
    });
    const result = await response.json() as Record<string, unknown>;
    if (!response.ok) return fallback;
    const raw = jsonText(result);
    const parsed = raw ? JSON.parse(raw) as { results?: Array<{ decision?: string; conflictsWith?: string }> } : null;
    const rows = Array.isArray(parsed?.results) ? parsed.results : [];
    return decisions.map((decision) => {
      const match = rows.find((row) => row.decision === decision);
      const conflictsWith = typeof match?.conflictsWith === "string" ? match.conflictsWith.trim() : "";
      return { decision, conflictsWith: conflictsWith || null };
    });
  } catch {
    return fallback;
  } finally {
    clearTimeout(timeout);
  }
}
