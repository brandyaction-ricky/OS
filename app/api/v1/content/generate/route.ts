import { NextResponse } from "next/server";
import { z, ZodError } from "zod";
import { ApiError, apiErrorResponse, parseJson } from "@/lib/http";
import { authenticateRequest, type RequestActor } from "@/lib/server/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

const schema = z.object({
  action: z.enum(["derivatives", "title_package", "shorts_proposal", "youtube_kit"]),
  sourceId: z.string().uuid(),
  platforms: z.array(z.enum(["shorts", "threads", "column", "instagram", "essay"])).max(5).optional(),
  count: z.number().int().min(1).max(12).default(5),
});

const PROCEDURE_TERMS = {
  derivatives: ["숏폼", "쓰레드", "SEO칼럼", "카드뉴스", "에세이"],
  title_package: ["패키징", "제목", "썸네일"],
  shorts_proposal: ["숏폼", "쇼츠"],
  youtube_kit: ["유튜브", "발행키트"],
} as const;

function extractJson(value: string) {
  const fenced = value.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1];
  const source = fenced ?? value.slice(value.indexOf("{"), value.lastIndexOf("}") + 1);
  try { return JSON.parse(source) as Record<string, unknown>; }
  catch { throw new ApiError(502, "CONTENT_GENERATION_INVALID", "AI가 올바른 결과 형식을 반환하지 않았습니다."); }
}

function outputText(body: Record<string, unknown>) {
  const content = Array.isArray(body.content) ? body.content : [];
  return content.filter((item) => item && typeof item === "object" && (item as { type?: string }).type === "text")
    .map((item) => String((item as { text?: string }).text ?? "")).join("\n").trim();
}

async function claude(prompt: string, model: string, maxTokens = 4000) {
  const key = process.env.ANTHROPIC_API_KEY || process.env.CLAUDE_API_KEY;
  if (!key) throw new ApiError(503, "CLAUDE_NOT_CONFIGURED", "Claude API 키가 아직 연결되지 않았습니다.");
  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "x-api-key": key, "anthropic-version": "2023-06-01", "content-type": "application/json" },
    body: JSON.stringify({ model, max_tokens: maxTokens, temperature: 0.25, messages: [{ role: "user", content: prompt }] }),
    signal: AbortSignal.timeout(90_000),
  });
  const body = await response.json() as Record<string, unknown>;
  if (!response.ok) throw new ApiError(502, "CLAUDE_GENERATION_FAILED", "콘텐츠 생성 요청에 실패했습니다.");
  return outputText(body);
}

async function procedures(actor: RequestActor, action: keyof typeof PROCEDURE_TERMS) {
  const terms = PROCEDURE_TERMS[action];
  const filter = terms.map((term) => `title.ilike.%${term}%`).join(",");
  const { data } = await actor.supabase.from("os_documents").select("title,content_md")
    .eq("status", "canonical").or(filter).limit(6);
  return (data ?? []).map((document) => `# ${document.title}\n${String(document.content_md).slice(0, 18_000)}`).join("\n\n").slice(0, 45_000);
}

async function queueForCredentials(actor: RequestActor, source: Record<string, unknown>, action: string) {
  const { data, error } = await actor.supabase.from("os_records").insert({
    record_type: "ai_job", title: `[콘텐츠] ${String(source.title)} · ${action}`,
    description: "Claude API 연결 후 정본을 읽어 자동 실행할 대기 작업입니다.", status: "blocked", priority: "normal",
    stage: "credentials", brand: String(source.brand ?? ""), team: String(source.team ?? actor.team), owner_id: actor.id,
    created_by: actor.id, updated_by: actor.id, metadata: { contentAction: action, sourceId: source.id, reason: "claude_not_configured" },
    tags: ["콘텐츠", "AI", "연결대기"],
  }).select("*").single();
  if (error) throw new ApiError(400, "CONTENT_JOB_QUEUE_FAILED", "AI 작업을 대기열에 저장하지 못했습니다.", error.message);
  return data;
}

function scheduleDate(index: number) {
  const date = new Date(); date.setUTCDate(date.getUTCDate() + index + 1); date.setUTCHours(9, 0, 0, 0);
  return date.toISOString();
}

async function insertGenerated(actor: RequestActor, source: Record<string, unknown>, action: z.infer<typeof schema>["action"], result: Record<string, unknown>) {
  const base = { parent_id: source.id, brand: source.brand ?? "", team: source.team ?? actor.team, owner_id: actor.id, created_by: actor.id, updated_by: actor.id, source_url: source.source_url ?? null };
  if (action === "derivatives") {
    const items = Array.isArray(result.items) ? result.items : [];
    const rows = items.slice(0, 20).map((raw, index) => { const item = raw as Record<string, unknown>; return {
      ...base, record_type: "content_publish", title: String(item.title ?? `${source.title} 파생 ${index + 1}`).slice(0, 240),
      description: String(item.body ?? "").slice(0, 20_000), status: "review", priority: "normal", stage: "검토필요",
      starts_at: scheduleDate(index), metadata: { automationOutput: true, platform: String(item.platform ?? "threads"), format: String(item.format ?? item.platform ?? "파생 콘텐츠"), sourceId: source.id, aiScore: Number(item.score ?? 0), selfReview: item.review ?? null, generatedBy: "claude", finalApprovalRequired: true },
      tags: ["파생콘텐츠", String(item.platform ?? "threads")],
    }; });
    if (!rows.length) throw new ApiError(502, "CONTENT_GENERATION_EMPTY", "생성된 파생 콘텐츠가 없습니다.");
    const { data, error } = await actor.supabase.from("os_records").insert(rows).select("*");
    if (error) throw new ApiError(400, "CONTENT_SAVE_FAILED", "파생 콘텐츠를 저장하지 못했습니다.", error.message); return data ?? [];
  }
  if (action === "shorts_proposal") {
    const items = Array.isArray(result.clips) ? result.clips : [];
    const rows = items.slice(0, 12).map((raw, index) => { const item = raw as Record<string, unknown>; return {
      ...base, record_type: "content_short", title: String(item.title ?? `쇼츠 후보 ${index + 1}`).slice(0, 240), description: String(item.hook ?? item.reason ?? "").slice(0, 20_000),
      status: "review", priority: "normal", stage: "구간제안", progress: 25,
      metadata: { proposalOnly: true, renderState: "not_started", start: Number(item.start ?? 0), end: Number(item.end ?? 0), hook: String(item.hook ?? ""), selected: true, reframe: "pad", captions: false, tighten: false }, tags: ["쇼츠", "구간제안"],
    }; });
    if (!rows.length) throw new ApiError(502, "CONTENT_GENERATION_EMPTY", "제안된 쇼츠 구간이 없습니다.");
    const { data, error } = await actor.supabase.from("os_records").insert(rows).select("*");
    if (error) throw new ApiError(400, "CONTENT_SAVE_FAILED", "쇼츠 제안을 저장하지 못했습니다.", error.message); return data ?? [];
  }
  const recordType = "content_package";
  const title = action === "youtube_kit" ? `${source.title} · 유튜브 발행 키트` : `${source.title} · 제목·썸네일 후보`;
  const { data, error } = await actor.supabase.from("os_records").insert({
    ...base, record_type: recordType, title, description: String(result.summary ?? "정본 기준으로 생성된 패키지입니다."), status: "review", priority: "normal",
    stage: action === "youtube_kit" ? "발행키트" : "패키징", metadata: { packageKind: action, result, finalApprovalRequired: true }, tags: action === "youtube_kit" ? ["유튜브", "발행키트"] : ["제목", "썸네일"],
  }).select("*").single();
  if (error) throw new ApiError(400, "CONTENT_SAVE_FAILED", "콘텐츠 패키지를 저장하지 못했습니다.", error.message); return [data];
}

function requestedShape(action: z.infer<typeof schema>["action"], count: number, platforms: string[]) {
  if (action === "shorts_proposal") return `{"clips":[{"title":"","hook":"","start":0,"end":40,"reason":""}]} 배열은 ${count}개. 렌더링하지 말고 구간만 제안.`;
  if (action === "title_package") return `{"summary":"","formula":"","titles":[{"text":"","hook":"","why":"","picked":false}],"copies":[{"text":"","hook":"","why":"","picked":false}],"designPrompts":[""]} 제목 8개, 카피 8개, 영어 디자인 프롬프트 3개. 이미지는 생성하지 않음.`;
  if (action === "youtube_kit") return `{"summary":"","title":"","description":"","tags":[],"chapters":["00:00 ..."],"pinnedComment":"","kakao":"","cafe":"","post":"","checklist":[]} 복사 가능한 발행 키트.`;
  return `{"items":[{"platform":"","format":"","title":"","body":"","score":1,"review":{"issues":[],"fixed":true}}]} 플랫폼 ${platforms.join(", ")}별 완결 산출물.`;
}

export async function POST(request: Request) {
  try {
    const actor = await authenticateRequest(request);
    const input = schema.parse(await parseJson(request));
    const { data: source, error } = await actor.supabase.from("os_records").select("*").eq("id", input.sourceId).is("archived_at", null).maybeSingle();
    if (error || !source) throw new ApiError(404, "CONTENT_SOURCE_NOT_FOUND", "기준 콘텐츠를 찾지 못했습니다.");
    const key = process.env.ANTHROPIC_API_KEY || process.env.CLAUDE_API_KEY;
    if (!key) return NextResponse.json({ queued: true, configured: false, job: await queueForCredentials(actor, source, input.action) }, { status: 202 });
    const procedure = await procedures(actor, input.action);
    if (!procedure) throw new ApiError(409, "CONTENT_PROCEDURE_MISSING", "실행할 콘텐츠 절차 정본을 찾지 못했습니다.");
    const platforms = input.platforms?.length ? input.platforms : ["shorts", "threads", "column", "instagram"];
    const model = input.action === "youtube_kit" || platforms.includes("column")
      ? process.env.CLAUDE_SONNET_MODEL || "claude-sonnet-4-5-20250929"
      : process.env.CLAUDE_HAIKU_MODEL || "claude-haiku-4-5-20251001";
    const context = `당신은 브랜디액션 콘텐츠 기획실입니다. 아래 회사 절차 정본을 최우선으로 지키고, 근거 없는 내용은 만들지 마세요. 외부 발행은 하지 않습니다.\n\n[절차 정본]\n${procedure}\n\n[원본]\n제목: ${source.title}\n설명/원고:\n${String(source.description ?? "").slice(0, 45_000)}\n\n[출력]\n${requestedShape(input.action, input.count, platforms)}\nJSON만 반환하세요.`;
    const draft = extractJson(await claude(context, model));
    const reviewed = extractJson(await claude(`아래 초안을 같은 절차 기준으로 1~5점 채점하고 문제를 직접 고쳐 최종 JSON만 반환하세요. 각 항목에는 score와 review를 남기세요.\n\n[절차]\n${procedure.slice(0, 25_000)}\n\n[초안]\n${JSON.stringify(draft).slice(0, 45_000)}`, model));
    const records = await insertGenerated(actor, source, input.action, reviewed);
    return NextResponse.json({ configured: true, queued: false, action: input.action, records }, { status: 201 });
  } catch (error) {
    if (error instanceof ZodError) return apiErrorResponse(new ApiError(400, "INVALID_CONTENT_GENERATION", "콘텐츠 생성 조건을 확인해 주세요.", error.flatten()));
    return apiErrorResponse(error);
  }
}
