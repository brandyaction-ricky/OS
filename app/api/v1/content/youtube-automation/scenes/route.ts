import { NextResponse } from "next/server";
import { z, ZodError } from "zod";
import { ApiError, apiErrorResponse, parseJson } from "@/lib/http";
import { authenticateRequest } from "@/lib/server/auth";
import { readPipeline } from "@/lib/server/content-pipeline";
import { generateYoutubeScenePlan, readYoutubeSceneRules, scenePlanSchema } from "@/lib/server/youtube-scenes";
import { selectedPackaging } from "@/lib/content-selected-packaging";
import { buildYoutubeAutomationPlan } from "@/lib/youtube-automation-plan";
import { canUseYoutubeAutomationPilot } from "@/lib/youtube-automation-gate";
import { YOUTUBE_VISUAL_TEMPLATE_VERSION } from "@/lib/youtube-visual-template";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 180;
const inputSchema = z.object({ sourceId: z.string().uuid(), inputKey: z.string().length(64) }).strict();

export async function POST(request: Request) {
  if (!canUseYoutubeAutomationPilot(process.env)) return NextResponse.json({ error: { code: "AUTOMATION_PILOT_DISABLED", message: "영상 자동화 파일럿이 아직 연결되지 않았습니다." } }, { status: 404 });
  try {
    const actor = await authenticateRequest(request, { allowAgent: false });
    const input = inputSchema.parse(await parseJson(request, 1_000));
    const state = await readPipeline(actor, input.sourceId);
    if (state.source.owner_id !== actor.id) throw new ApiError(403, "CONTENT_OWNER_REQUIRED", "이 콘텐츠의 소유자만 영상 장면을 설계할 수 있습니다.");
    const plan = buildYoutubeAutomationPlan(state);
    if (!plan.inputKey || plan.inputKey !== input.inputKey) throw new ApiError(409, "AUTOMATION_INPUT_CHANGED", "원고나 승인 상태가 변경됐습니다. 새로 불러와 주세요.");
    const rules = await readYoutubeSceneRules(actor);
    const prior = state.source.metadata.narratedScenePlan as { inputKey?: string; ruleVersions?: unknown; templateVersion?: unknown; plan?: unknown } | undefined;
    if (prior?.inputKey === input.inputKey && prior.templateVersion === YOUTUBE_VISUAL_TEMPLATE_VERSION &&
      JSON.stringify(prior.ruleVersions) === JSON.stringify(rules.ruleVersions) && scenePlanSchema.safeParse(prior.plan).success)
      return NextResponse.json({ reused: true, scenePlan: prior }, { headers: { "cache-control": "private, no-store" } });
    const script = state.records.find((record) => record.id === plan.script?.id && record.version === plan.script.version);
    const packageChoice = selectedPackaging(state.records, input.sourceId);
    if (!script || !packageChoice) throw new ApiError(409, "AUTOMATION_INPUT_CHANGED", "현재 원고와 채택 패키징을 다시 확인해 주세요.");
    const generated = await generateYoutubeScenePlan({
      script: script.description, title: packageChoice.title, thumbnailCopy: packageChoice.thumbnailCopies.join(" / "),
      evidence: String(state.source.metadata.evidence ?? ""), ...rules,
    });
    const latest = await readPipeline(actor, input.sourceId);
    if (buildYoutubeAutomationPlan(latest).inputKey !== input.inputKey) throw new ApiError(409, "AUTOMATION_INPUT_CHANGED", "영상 설계 중 원고나 승인 상태가 변경됐습니다. 결과를 저장하지 않았습니다.");
    if (JSON.stringify((await readYoutubeSceneRules(actor)).ruleVersions) !== JSON.stringify(rules.ruleVersions))
      throw new ApiError(409, "SCENE_RULES_CHANGED", "영상 설계 중 OS 기준이 변경됐습니다. 결과를 저장하지 않았습니다.");
    const scenePlan = { inputKey: input.inputKey, ...generated, generatedAt: new Date().toISOString(), judgmentMode: "advisory_only" };
    const { data: saved, error } = await actor.supabase.from("os_records").update({
      metadata: { ...latest.source.metadata, narratedScenePlan: scenePlan }, updated_by: actor.id,
    }).eq("id", latest.source.id).eq("version", latest.source.version).is("archived_at", null).select("id").maybeSingle();
    if (error || !saved) throw new ApiError(409, "AUTOMATION_INPUT_CHANGED", "다른 작업이 먼저 콘텐츠를 변경했습니다. 새로 불러와 주세요.");
    return NextResponse.json({ reused: false, scenePlan }, { headers: { "cache-control": "private, no-store" } });
  } catch (error) {
    if (error instanceof ZodError) return apiErrorResponse(new ApiError(400, "INVALID_AUTOMATION_INPUT", "콘텐츠와 원고 버전을 확인해 주세요."));
    return apiErrorResponse(error);
  }
}
