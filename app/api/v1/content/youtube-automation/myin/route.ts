import { NextResponse } from "next/server";
import { z, ZodError } from "zod";
import { ApiError, apiErrorResponse, parseJson } from "@/lib/http";
import { authenticateRequest } from "@/lib/server/auth";
import { confirmMyinClips, createMyinRun, latestMyinRun, myinDownloads, myinOutputs, myinPreviewSheets, myinSoundState, myinWordsReport, reopenMyinMaterials, reviewMyinStoryboard, saveMyinSound, setMyinDraftPlace, startMyinFinal, startMyinPrep } from "@/lib/server/myin-run";
import { readLocalRenderStatus } from "@/lib/server/youtube-render-pc";
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
    // 1단계 파일 내려받기 (2026-10-28): the voice parts and the subtitle bundle.
    const downloads = query.get("downloads");
    if (downloads) return NextResponse.json(await myinDownloads(actor, z.string().uuid().parse(downloads)), { headers });
    const outputs = query.get("outputs");
    if (outputs) return NextResponse.json(await myinOutputs(actor, z.string().uuid().parse(outputs)), { headers });
    // 내 컴퓨터: whether this member's own Mac is on and has the render PC's engine (?local=1).
    if (query.get("local")) return NextResponse.json({ local: await readLocalRenderStatus(actor.ownerId) }, { headers });
    const sound = query.get("sound");
    if (sound) return NextResponse.json(await myinSoundState(actor, z.string().uuid().parse(sound)), { headers });
    return NextResponse.json({ run: await latestMyinRun(actor, z.string().uuid().parse(query.get("sourceId"))) }, { headers });
  } catch (error) {
    if (error instanceof ZodError) return apiErrorResponse(new ApiError(400, "INVALID_MYIN_INPUT", "콘텐츠를 확인해 주세요."));
    return apiErrorResponse(error);
  }
}

const patchSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("review"), runId: z.string().uuid(), decision: z.enum(["confirmed", "revise"]), note: z.string().max(2000).default(""), place: z.enum(["pc", "local"]).default("pc") }),
  z.object({ action: z.literal("place"), runId: z.string().uuid(), place: z.enum(["pc", "local"]) }),
  z.object({ action: z.literal("prepare"), runId: z.string().uuid() }),
  z.object({ action: z.literal("clips_ok"), runId: z.string().uuid(), note: z.string().max(2000).default("") }),
  // ④ 자료 준비 (2026-10-27): the full video after the sound check, ⑤ → ④ for another sound pass, and the sound plan itself.
  z.object({ action: z.literal("final"), runId: z.string().uuid() }),
  z.object({ action: z.literal("reopen"), runId: z.string().uuid() }),
  z.object({ action: z.literal("sound"), runId: z.string().uuid(), plan: z.object({
    music: z.array(z.object({ scene: z.number().int().min(1).max(200), key: z.string().min(1).max(80), start: z.number().min(0).max(3600).optional() }).strict()).max(60),
    amb: z.array(z.object({ scene: z.number().int().min(1).max(200), key: z.string().min(1).max(80), dur: z.number().positive().max(600).optional(),
      cue: z.string().max(200).optional(), cueEnd: z.string().max(200).optional() }).strict()).max(60),
    sfx: z.array(z.object({ scene: z.number().int().min(1).max(200), cue: z.string().min(1).max(200), key: z.string().min(1).max(80) }).strict()).max(200),
  }).strict() }),
]);

/** Logan's storyboard review (confirming starts the ③ drafts), the drafts' OK (starts ④), the sound plan, the full video, and restarts. */
export async function PATCH(request: Request) {
  try {
    pilot();
    const actor = await authenticateRequest(request, { allowAgent: false });
    const input = patchSchema.parse(await parseJson(request, 60_000));
    const result = input.action === "review" ? { run: await reviewMyinStoryboard(actor, input.runId, input.decision, input.note, input.place) }
      : input.action === "place" ? { run: await setMyinDraftPlace(actor, input.runId, input.place) }
      : input.action === "clips_ok" ? { run: await confirmMyinClips(actor, input.runId, input.note) }
      : input.action === "final" ? { run: await startMyinFinal(actor, input.runId) }
      : input.action === "reopen" ? { run: await reopenMyinMaterials(actor, input.runId) }
      : input.action === "sound" ? { run: await saveMyinSound(actor, input.runId, input.plan) }
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
