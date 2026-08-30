import { NextResponse } from "next/server";
import { z, ZodError } from "zod";
import { ApiError, apiErrorResponse, parseJson } from "@/lib/http";
import { authenticateRequest, type RequestActor } from "@/lib/server/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

const schema = z.object({
  action: z.enum(["topic_plan", "script_draft", "derivatives", "title_package", "shorts_proposal", "youtube_kit"]),
  sourceId: z.string().uuid(),
  platforms: z.array(z.enum(["shorts", "threads", "column", "instagram", "essay"])).max(5).optional(),
  count: z.number().int().min(1).max(12).default(5),
  marketEvidence: z.array(z.object({ title: z.string().max(300), channelTitle: z.string().max(200), viewCount: z.number().nonnegative(), url: z.string().url() })).max(20).optional(),
});

const PROCEDURE_TERMS = {
  topic_plan: ["기획", "현재기준", "분석"],
  script_draft: ["원고", "다듬는", "현재기준"],
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

type JsonSchema = Record<string, unknown>;

const reviewSchema: JsonSchema = {
  type: "object", additionalProperties: false,
  properties: { issues: { type: "array", items: { type: "string" } }, fixed: { type: "boolean" } },
  required: ["issues", "fixed"],
};

function outputSchema(action: z.infer<typeof schema>["action"]): JsonSchema {
  const textList = { type: "array", items: { type: "string" } };
  const baseReview = { score: { type: "number", minimum: 1, maximum: 5 }, review: reviewSchema };
  if (action === "topic_plan") return { type: "object", additionalProperties: false, properties: { summary: { type: "string" }, audience: { type: "string" }, entryLanguage: { type: "string" }, hierarchy: { type: "string" }, candidates: { type: "array", items: { type: "object", additionalProperties: false, properties: { title: { type: "string" }, thumbnailCopy: { type: "string" }, narrative: { type: "string" }, cta: { type: "string" }, evidence: { type: "string" } }, required: ["title", "thumbnailCopy", "narrative", "cta", "evidence"] } }, handoff: { type: "string" }, ...baseReview }, required: ["summary", "audience", "entryLanguage", "hierarchy", "candidates", "handoff", "score", "review"] };
  if (action === "script_draft") return { type: "object", additionalProperties: false, properties: { title: { type: "string" }, outline: textList, script: { type: "string" }, handoff: { type: "string" }, checks: textList, ...baseReview }, required: ["title", "outline", "script", "handoff", "checks", "score", "review"] };
  if (action === "shorts_proposal") return { type: "object", additionalProperties: false, properties: { clips: { type: "array", items: { type: "object", additionalProperties: false, properties: { title: { type: "string" }, hook: { type: "string" }, start: { type: "number", minimum: 0 }, end: { type: "number", minimum: 0 }, reason: { type: "string" } }, required: ["title", "hook", "start", "end", "reason"] } }, ...baseReview }, required: ["clips", "score", "review"] };
  if (action === "title_package") {
    const candidate = { type: "object", additionalProperties: false, properties: { text: { type: "string" }, hook: { type: "string" }, why: { type: "string" }, picked: { type: "boolean" } }, required: ["text", "hook", "why", "picked"] };
    return { type: "object", additionalProperties: false, properties: { summary: { type: "string" }, formula: { type: "string" }, titles: { type: "array", items: candidate }, copies: { type: "array", items: candidate }, designPrompts: textList, ...baseReview }, required: ["summary", "formula", "titles", "copies", "designPrompts", "score", "review"] };
  }
  if (action === "youtube_kit") return { type: "object", additionalProperties: false, properties: { summary: { type: "string" }, title: { type: "string" }, description: { type: "string" }, tags: textList, chapters: textList, pinnedComment: { type: "string" }, kakao: { type: "string" }, cafe: { type: "string" }, post: { type: "string" }, checklist: textList, ...baseReview }, required: ["summary", "title", "description", "tags", "chapters", "pinnedComment", "kakao", "cafe", "post", "checklist", "score", "review"] };
  return { type: "object", additionalProperties: false, properties: { items: { type: "array", items: { type: "object", additionalProperties: false, properties: { platform: { type: "string", enum: ["shorts", "threads", "column", "instagram", "essay"] }, format: { type: "string" }, title: { type: "string" }, body: { type: "string" }, deriv_html: { type: ["string", "null"] }, score: { type: "number", minimum: 1, maximum: 5 }, review: reviewSchema }, required: ["platform", "format", "title", "body", "deriv_html", "score", "review"] } } }, required: ["items"] };
}

function tokenBudget(action: z.infer<typeof schema>["action"]) {
  if (action === "derivatives") return 14_000;
  if (action === "youtube_kit" || action === "script_draft") return 9_000;
  return 7_000;
}

async function claude(prompt: string, model: string, jsonSchema: JsonSchema, maxTokens: number) {
  const key = process.env.ANTHROPIC_API_KEY || process.env.CLAUDE_API_KEY;
  if (!key) throw new ApiError(503, "CLAUDE_NOT_CONFIGURED", "Claude API 키가 아직 연결되지 않았습니다.");
  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "x-api-key": key, "anthropic-version": "2023-06-01", "content-type": "application/json" },
    body: JSON.stringify({ model, max_tokens: maxTokens, temperature: 0.25, output_config: { format: { type: "json_schema", schema: jsonSchema } }, messages: [{ role: "user", content: prompt }] }),
    signal: AbortSignal.timeout(90_000),
  });
  const body = await response.json() as Record<string, unknown>;
  if (!response.ok) throw new ApiError(502, "CLAUDE_GENERATION_FAILED", "콘텐츠 생성 요청에 실패했습니다.");
  if (body.stop_reason === "max_tokens") throw new ApiError(502, "CLAUDE_OUTPUT_TRUNCATED", "AI 결과가 길이 제한에 걸렸습니다. 원문을 줄이거나 생성 범위를 나눠 주세요.");
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
      starts_at: scheduleDate(index), metadata: { automationOutput: true, platform: String(item.platform ?? "threads"), format: String(item.format ?? item.platform ?? "파생 콘텐츠"), sourceId: source.id, aiScore: Number(item.score ?? 0), selfReview: item.review ?? null, derivHtml: typeof item.deriv_html === "string" ? item.deriv_html.slice(0, 80_000) : null, generatedBy: "claude", finalApprovalRequired: true },
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
  if (action === "script_draft") {
    const script = String(result.script ?? result.body ?? "").slice(0, 80_000);
    if (!script) throw new ApiError(502, "CONTENT_GENERATION_EMPTY", "생성된 원고가 없습니다.");
    const { data, error } = await actor.supabase.from("os_records").insert({
      ...base, record_type: "content_script", title: String(result.title ?? `${source.title} · 원고`).slice(0, 240),
      description: script, status: "review", priority: "high", stage: "초안", progress: 75,
      metadata: { scriptStep: 5, outline: result.outline ?? [], handoff: String(result.handoff ?? ""), checks: result.checks ?? [], finalApprovalRequired: true, generatedBy: "claude" },
      tags: ["원고", "정본실행"],
    }).select("*").single();
    if (error) throw new ApiError(400, "CONTENT_SAVE_FAILED", "원고를 저장하지 못했습니다.", error.message);
    return [data];
  }
  const recordType = "content_package";
  const title = action === "youtube_kit" ? `${source.title} · 유튜브 발행 키트` : action === "topic_plan" ? `${source.title} · 기획 브리핑` : `${source.title} · 제목·썸네일 후보`;
  const { data, error } = await actor.supabase.from("os_records").insert({
    ...base, record_type: recordType, title, description: String(result.summary ?? "정본 기준으로 생성된 패키지입니다."), status: "review", priority: "normal",
    stage: action === "youtube_kit" ? "발행키트" : action === "topic_plan" ? "기획확정" : "패키징", metadata: { packageKind: action, result, finalApprovalRequired: true }, tags: action === "youtube_kit" ? ["유튜브", "발행키트"] : action === "topic_plan" ? ["기획", "브리핑"] : ["제목", "썸네일"],
  }).select("*").single();
  if (error) throw new ApiError(400, "CONTENT_SAVE_FAILED", "콘텐츠 패키지를 저장하지 못했습니다.", error.message); return [data];
}

function requestedShape(action: z.infer<typeof schema>["action"], count: number, platforms: string[]) {
  if (action === "topic_plan") return `{"summary":"","audience":"","entryLanguage":"","hierarchy":"유입형|전환형|판매형","candidates":[{"title":"","thumbnailCopy":"","narrative":"","cta":"","evidence":""}],"handoff":""} 후보 3개. 현재기준과 기획 절차의 채택 게이트를 적용.`;
  if (action === "script_draft") return `{"title":"","outline":[""],"script":"","handoff":"","checks":[""]} 원고 절차의 결재 지점과 사실 확인 항목을 지키는 낭독용 초안.`;
  if (action === "shorts_proposal") return `{"clips":[{"title":"","hook":"","start":0,"end":40,"reason":""}]} 배열은 ${count}개. 렌더링하지 말고 구간만 제안.`;
  if (action === "title_package") return `{"summary":"","formula":"","titles":[{"text":"","hook":"","why":"","picked":false}],"copies":[{"text":"","hook":"","why":"","picked":false}],"designPrompts":[""]} 제목 8개, 카피 8개, 영어 디자인 프롬프트 3개. 이미지는 생성하지 않음.`;
  if (action === "youtube_kit") return `{"summary":"","title":"","description":"","tags":[],"chapters":["00:00 ..."],"pinnedComment":"","kakao":"","cafe":"","post":"","checklist":[]} 복사 가능한 발행 키트.`;
  return `{"items":[{"platform":"shorts|threads|column|instagram|essay","format":"","title":"","body":"","deriv_html":"SEO 칼럼일 때만 완성 HTML","score":1,"review":{"issues":[],"fixed":true}}]} 요청한 플랫폼 ${platforms.join(", ")}별 완결 산출물. 기본 수량은 shorts 3개, threads 3개, column 1개, instagram 1개, essay 1개이며 요청하지 않은 플랫폼은 제외. SEO 칼럼은 body와 함께 목차·JSON-LD·hero·중간영상·유튜브 임베드를 포함한 deriv_html을 반드시 반환.`;
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
    const model = input.action === "youtube_kit" || (input.action === "derivatives" && platforms.includes("column"))
      ? process.env.CLAUDE_SONNET_MODEL || "claude-sonnet-4-5-20250929"
      : process.env.CLAUDE_HAIKU_MODEL || "claude-haiku-4-5-20251001";
    const marketEvidence = input.marketEvidence?.length ? `\n\n[YouTube 시장 근거]\n${input.marketEvidence.map((item, index) => `${index + 1}. ${item.title} · ${item.channelTitle} · 조회 ${item.viewCount} · ${item.url}`).join("\n")}` : "";
    const context = `당신은 브랜디액션 콘텐츠 기획실입니다. 아래 회사 절차 정본을 최우선으로 지키고, 근거 없는 내용은 만들지 마세요. 외부 발행은 하지 않습니다. 결과를 제출하기 전에 같은 절차로 자가검수하고, 문제를 직접 고친 최종본과 1~5점 score·review를 함께 반환하세요.\n\n[절차 정본]\n${procedure}\n\n[원본]\n제목: ${source.title}\n설명/원고:\n${String(source.description ?? "").slice(0, 45_000)}${marketEvidence}\n\n[출력]\n${requestedShape(input.action, input.count, platforms)}`;
    const result = extractJson(await claude(context, model, outputSchema(input.action), tokenBudget(input.action)));
    const records = await insertGenerated(actor, source, input.action, result);
    return NextResponse.json({ configured: true, queued: false, action: input.action, records }, { status: 201 });
  } catch (error) {
    if (error instanceof ZodError) return apiErrorResponse(new ApiError(400, "INVALID_CONTENT_GENERATION", "콘텐츠 생성 조건을 확인해 주세요.", error.flatten()));
    return apiErrorResponse(error);
  }
}
