import { NextResponse } from "next/server";
import { z, ZodError } from "zod";
import { ApiError, apiErrorResponse, parseJson } from "@/lib/http";
import { authenticateRequest } from "@/lib/server/auth";
import { readPipeline } from "@/lib/server/content-pipeline";
import { generateYoutubeStill } from "@/lib/server/youtube-image";
import { readYoutubeSceneRules, scenePlanSchema } from "@/lib/server/youtube-scenes";
import { buildYoutubeAutomationPlan } from "@/lib/youtube-automation-plan";
import { canUseYoutubeAutomationPilot } from "@/lib/youtube-automation-gate";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 180;
const inputSchema = z.object({ sourceId: z.string().uuid(), inputKey: z.string().length(64), segmentIndex: z.number().int().min(0).max(79) }).strict();

export async function POST(request: Request) {
  if (!canUseYoutubeAutomationPilot(process.env)) return NextResponse.json({ error: { code: "AUTOMATION_PILOT_DISABLED", message: "영상 자동화 파일럿이 아직 연결되지 않았습니다." } }, { status: 404 });
  try {
    const actor = await authenticateRequest(request, { allowAgent: false });
    if (actor.role !== "admin") throw new ApiError(403, "ADMIN_REQUIRED", "이미지 미리보기는 관리자만 실행할 수 있습니다.");
    const input = inputSchema.parse(await parseJson(request, 1_000));
    const state = await readPipeline(actor, input.sourceId);
    if (state.source.owner_id !== actor.id) throw new ApiError(403, "CONTENT_OWNER_REQUIRED", "이 콘텐츠의 소유자만 이미지를 생성할 수 있습니다.");
    const plan = buildYoutubeAutomationPlan(state);
    const scenePlan = state.source.metadata.narratedScenePlan as { inputKey?: string; ruleVersions?: unknown; plan?: unknown } | undefined;
    const parsedScenes = scenePlanSchema.safeParse(scenePlan?.plan);
    const scene = parsedScenes.success ? parsedScenes.data.scenes.find((item) => item.segmentIndex === input.segmentIndex) : null;
    if (!plan.inputKey || plan.inputKey !== input.inputKey || scenePlan?.inputKey !== input.inputKey || !scene)
      throw new ApiError(409, "AUTOMATION_INPUT_CHANGED", "현재 원고의 화면 설계를 다시 확인해 주세요.");
    const ruleVersions = JSON.stringify((await readYoutubeSceneRules(actor)).ruleVersions);
    if (JSON.stringify(scenePlan?.ruleVersions) !== ruleVersions)
      throw new ApiError(409, "SCENE_RULES_CHANGED", "OS 영상 기준이 변경됐습니다. 화면 설계를 다시 만드세요.");
    if (scene.visualType !== "generated_still") throw new ApiError(409, "IMAGE_SCENE_NOT_GENERATIVE", "이 장면은 생성 이미지 대신 편집용 그래픽이나 출처 자료를 사용합니다.");
    const image = await generateYoutubeStill(scene.visualPrompt, { apiKey: process.env.OPENAI_API_KEY ?? "" });
    if (buildYoutubeAutomationPlan(await readPipeline(actor, input.sourceId)).inputKey !== input.inputKey || JSON.stringify((await readYoutubeSceneRules(actor)).ruleVersions) !== ruleVersions)
      throw new ApiError(409, "AUTOMATION_INPUT_CHANGED", "이미지 생성 중 원고가 변경됐습니다. 이 결과는 사용하지 않습니다.");
    return new Response(new Uint8Array(image.bytes), { headers: { "cache-control": "private, no-store", "content-type": image.mimeType, "content-disposition": `inline; filename=scene-${input.segmentIndex + 1}.png` } });
  } catch (error) {
    if (error instanceof ZodError) return apiErrorResponse(new ApiError(400, "INVALID_IMAGE_PREVIEW", "영상 장면과 버전을 확인해 주세요."));
    return apiErrorResponse(error);
  }
}
