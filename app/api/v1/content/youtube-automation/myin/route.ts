import { NextResponse } from "next/server";
import { z, ZodError } from "zod";
import { ApiError, apiErrorResponse, parseJson } from "@/lib/http";
import { authenticateRequest } from "@/lib/server/auth";
import { confirmMyinAssetUpload, createMyinRun, decideMyinAsset, latestMyinRun, myinAssetUploadUrl, myinPreviewSheets, myinWordsReport, reviewMyinStoryboard, startMyinPrep } from "@/lib/server/myin-run";
import { canUseYoutubeAutomationPilot } from "@/lib/youtube-automation-gate";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const headers = { "cache-control": "private, no-store" };
const pilot = () => { if (!canUseYoutubeAutomationPilot(process.env)) throw new ApiError(404, "AUTOMATION_PILOT_DISABLED", "영상 자동화 파일럿이 아직 연결되지 않았습니다."); };

/** ③ 영상 제작 › 마이인 v13: the latest run for one video, or its subtitle check sheet (?report=runId). */
export async function GET(request: Request) {
  try {
    pilot();
    const actor = await authenticateRequest(request, { allowAgent: false });
    const query = new URL(request.url).searchParams;
    const report = query.get("report");
    if (report) return NextResponse.json(await myinWordsReport(actor, z.string().uuid().parse(report)), { headers });
    const sheets = query.get("sheets");
    if (sheets) return NextResponse.json(await myinPreviewSheets(actor, z.string().uuid().parse(sheets)), { headers });
    return NextResponse.json({ run: await latestMyinRun(actor, z.string().uuid().parse(query.get("sourceId"))) }, { headers });
  } catch (error) {
    if (error instanceof ZodError) return apiErrorResponse(new ApiError(400, "INVALID_MYIN_INPUT", "콘텐츠를 확인해 주세요."));
    return apiErrorResponse(error);
  }
}

const patchSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("review"), runId: z.string().uuid(), decision: z.enum(["confirmed", "revise"]), note: z.string().max(2000).default("") }),
  z.object({ action: z.literal("asset"), runId: z.string().uuid(), file: z.string().min(1).max(120), decision: z.enum(["approved", "excluded"]) }),
  z.object({ action: z.literal("upload"), runId: z.string().uuid(), file: z.string().min(1).max(120) }),
  z.object({ action: z.literal("uploaded"), runId: z.string().uuid(), file: z.string().min(1).max(120) }),
  z.object({ action: z.literal("prepare"), runId: z.string().uuid() }),
]);

/** Logan's storyboard review, then stage 3: each candidate's decision, uploads of files people downloaded, and the start of preparation. */
export async function PATCH(request: Request) {
  try {
    pilot();
    const actor = await authenticateRequest(request, { allowAgent: false });
    const input = patchSchema.parse(await parseJson(request, 4_000));
    const result = input.action === "review" ? { run: await reviewMyinStoryboard(actor, input.runId, input.decision, input.note) }
      : input.action === "asset" ? { run: await decideMyinAsset(actor, input.runId, input.file, input.decision) }
      : input.action === "upload" ? await myinAssetUploadUrl(actor, input.runId, input.file)
      : input.action === "uploaded" ? { run: await confirmMyinAssetUpload(actor, input.runId, input.file) }
      : { run: await startMyinPrep(actor, input.runId) };
    return NextResponse.json(result, { headers });
  } catch (error) {
    if (error instanceof ZodError) return apiErrorResponse(new ApiError(400, "INVALID_MYIN_INPUT", "요청 내용을 확인해 주세요."));
    return apiErrorResponse(error);
  }
}

/** [v13 음성 만들기]. */
export async function POST(request: Request) {
  try {
    pilot();
    const actor = await authenticateRequest(request, { allowAgent: false });
    const input = z.object({ sourceId: z.string().uuid() }).passthrough().parse(await parseJson(request, 1_000));
    return NextResponse.json({ run: await createMyinRun(actor, input.sourceId) }, { status: 202, headers });
  } catch (error) {
    if (error instanceof ZodError) return apiErrorResponse(new ApiError(400, "INVALID_MYIN_INPUT", "콘텐츠를 확인해 주세요."));
    return apiErrorResponse(error);
  }
}
