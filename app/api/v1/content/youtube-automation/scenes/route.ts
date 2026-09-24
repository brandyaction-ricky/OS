import { NextResponse } from "next/server";
import { z, ZodError } from "zod";
import { ApiError, apiErrorResponse, parseJson } from "@/lib/http";
import { authenticateRequest } from "@/lib/server/auth";
import { readYoutubeAutomationInput } from "@/lib/server/youtube-automation-input";
import { checkScenePlan, generateYoutubeSceneWindow, readYoutubeSceneRules, SCENE_MODEL, scenePlanSchema, type YoutubeScenePlan } from "@/lib/server/youtube-scenes";
import { splitFishNarration } from "@/lib/server/fish-audio";
import { readYoutubeCharacterCatalog } from "@/lib/server/youtube-characters";
import { canUseYoutubeAutomationPilot } from "@/lib/youtube-automation-gate";
import { YOUTUBE_VISUAL_TEMPLATE_VERSION } from "@/lib/youtube-visual-template";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 800;
const inputSchema = z.object({ sourceId: z.string().uuid(), inputKey: z.string().length(64) }).strict();

export async function POST(request: Request) {
  if (!canUseYoutubeAutomationPilot(process.env)) return NextResponse.json({ error: { code: "AUTOMATION_PILOT_DISABLED", message: "영상 자동화 파일럿이 아직 연결되지 않았습니다." } }, { status: 404 });
  try {
    const actor = await authenticateRequest(request, { allowAgent: false });
    const input = inputSchema.parse(await parseJson(request, 1_000));
    const automation = await readYoutubeAutomationInput(actor.supabase, input.sourceId);
    const { state, plan } = automation;
    if (state.source.owner_id !== actor.id) throw new ApiError(403, "CONTENT_OWNER_REQUIRED", "이 콘텐츠의 소유자만 영상 장면을 설계할 수 있습니다.");
    if (!plan.inputKey || plan.inputKey !== input.inputKey) throw new ApiError(409, "AUTOMATION_INPUT_CHANGED", "원고나 승인 상태가 변경됐습니다. 새로 불러와 주세요.");
    const rules = await readYoutubeSceneRules(actor);
    const characters = await readYoutubeCharacterCatalog();
    const prior = state.source.metadata.narratedScenePlan as { inputKey?: string; model?: unknown; characterCatalogDigest?: unknown; ruleVersions?: unknown; templateVersion?: unknown; plan?: unknown } | undefined;
    if (prior?.inputKey === input.inputKey && prior.model === SCENE_MODEL && prior.characterCatalogDigest === characters.digest && prior.templateVersion === YOUTUBE_VISUAL_TEMPLATE_VERSION &&
      JSON.stringify(prior.ruleVersions) === JSON.stringify(rules.ruleVersions) && scenePlanSchema.safeParse(prior.plan).success)
      return NextResponse.json({ reused: true, scenePlan: prior }, { headers: { "cache-control": "private, no-store" } });
    if (!automation.scriptText) throw new ApiError(409, "AUTOMATION_INPUT_CHANGED", "현재 원고와 채택 패키징을 다시 확인해 주세요.");
    // One window of paragraphs per call; the draft survives between calls until every paragraph has scenes.
    const signature = { inputKey: input.inputKey, model: SCENE_MODEL, characterCatalogDigest: characters.digest,
      templateVersion: YOUTUBE_VISUAL_TEMPLATE_VERSION, ruleVersions: rules.ruleVersions };
    const stored = state.source.metadata.narratedScenePlanDraft as (typeof signature & { plan: YoutubeScenePlan }) | undefined;
    const draft = stored && stored.inputKey === signature.inputKey && stored.model === signature.model &&
      stored.characterCatalogDigest === signature.characterCatalogDigest && stored.templateVersion === signature.templateVersion &&
      JSON.stringify(stored.ruleVersions) === JSON.stringify(signature.ruleVersions) && scenePlanSchema.safeParse(stored.plan).success ? stored.plan : null;
    const from = draft?.scenes.length ?? 0;
    const { window, segmentCount } = await generateYoutubeSceneWindow({
      script: automation.scriptText, title: automation.title, thumbnailCopy: automation.thumbnailCopy,
      evidence: String(state.source.metadata.evidence ?? ""), rules: rules.rules, characters, from,
      direction: draft?.visualDirection, recentIdeas: draft?.scenes.slice(-1).flatMap((scene) => scene.visualBeats.map((beat) => beat.idea)),
    });
    const merged: YoutubeScenePlan = draft ? { ...draft, scenes: [...draft.scenes, ...window.scenes],
      unresolved: [...draft.unresolved, ...window.unresolved].slice(0, 20) } : window;
    const { state: latest, plan: latestPlan } = await readYoutubeAutomationInput(actor.supabase, input.sourceId);
    if (latestPlan.inputKey !== input.inputKey) throw new ApiError(409, "AUTOMATION_INPUT_CHANGED", "영상 설계 중 원고나 승인 상태가 변경됐습니다. 결과를 저장하지 않았습니다.");
    if (JSON.stringify((await readYoutubeSceneRules(actor)).ruleVersions) !== JSON.stringify(rules.ruleVersions))
      throw new ApiError(409, "SCENE_RULES_CHANGED", "영상 설계 중 OS 기준이 변경됐습니다. 결과를 저장하지 않았습니다.");
    const done = merged.scenes.length === segmentCount;
    if (done) checkScenePlan(merged, splitFishNarration(automation.scriptText), characters.ids);
    const scenePlan = done ? { ...signature, plan: merged, segmentCount, generatedAt: new Date().toISOString(), judgmentMode: "advisory_only" } : null;
    const rest = { ...latest.source.metadata };
    delete rest.narratedScenePlanDraft;
    const { data: saved, error } = await actor.supabase.from("os_records").update({
      metadata: scenePlan ? { ...rest, narratedScenePlan: scenePlan } : { ...rest, narratedScenePlanDraft: { ...signature, plan: merged } }, updated_by: actor.id,
    }).eq("id", latest.source.id).eq("version", latest.source.version).is("archived_at", null).select("id").maybeSingle();
    if (error || !saved) throw new ApiError(409, "AUTOMATION_INPUT_CHANGED", "다른 작업이 먼저 콘텐츠를 변경했습니다. 새로 불러와 주세요.");
    if (!scenePlan) return NextResponse.json({ reused: false, done: false, progress: { scenes: merged.scenes.length, total: segmentCount } },
      { status: 202, headers: { "cache-control": "private, no-store" } });
    return NextResponse.json({ reused: false, done: true, scenePlan }, { headers: { "cache-control": "private, no-store" } });
  } catch (error) {
    if (error instanceof ZodError) return apiErrorResponse(new ApiError(400, "INVALID_AUTOMATION_INPUT", "콘텐츠와 원고 버전을 확인해 주세요."));
    return apiErrorResponse(error);
  }
}

const acknowledgeSchema = z.object({ sourceId: z.string().uuid(), inputKey: z.string().length(64), acknowledgeUnresolved: z.literal(true) }).strict();

/** The owner confirms they read the scene plan's open notes, which lets the voice stage start. */
export async function PATCH(request: Request) {
  if (!canUseYoutubeAutomationPilot(process.env)) return NextResponse.json({ error: { code: "AUTOMATION_PILOT_DISABLED", message: "영상 자동화 파일럿이 아직 연결되지 않았습니다." } }, { status: 404 });
  try {
    const actor = await authenticateRequest(request, { allowAgent: false });
    const input = acknowledgeSchema.parse(await parseJson(request, 1_000));
    const { state } = await readYoutubeAutomationInput(actor.supabase, input.sourceId);
    if (state.source.owner_id !== actor.id) throw new ApiError(403, "CONTENT_OWNER_REQUIRED", "이 콘텐츠의 소유자만 확인할 수 있습니다.");
    const scenePlan = state.source.metadata.narratedScenePlan as { inputKey?: string; plan?: unknown } | undefined;
    const parsed = scenePlanSchema.safeParse(scenePlan?.plan);
    if (!scenePlan || scenePlan.inputKey !== input.inputKey || !parsed.success)
      throw new ApiError(409, "SCENE_PLAN_REQUIRED", "현재 원고의 화면 설계를 먼저 완료해 주세요.");
    const unresolvedAcknowledged = { by: actor.id, at: new Date().toISOString(), count: parsed.data.unresolved.length };
    const { data: saved, error } = await actor.supabase.from("os_records").update({
      metadata: { ...state.source.metadata, narratedScenePlan: { ...scenePlan, unresolvedAcknowledged } }, updated_by: actor.id,
    }).eq("id", state.source.id).eq("version", state.source.version).is("archived_at", null).select("id").maybeSingle();
    if (error || !saved) throw new ApiError(409, "AUTOMATION_INPUT_CHANGED", "다른 작업이 먼저 콘텐츠를 변경했습니다. 새로 불러와 주세요.");
    return NextResponse.json({ unresolvedAcknowledged }, { headers: { "cache-control": "private, no-store" } });
  } catch (error) {
    if (error instanceof ZodError) return apiErrorResponse(new ApiError(400, "INVALID_AUTOMATION_INPUT", "콘텐츠와 원고 버전을 확인해 주세요."));
    return apiErrorResponse(error);
  }
}
