import { NextResponse } from "next/server";
import { z, ZodError } from "zod";
import { ApiError, apiErrorResponse, parseJson } from "@/lib/http";
import { youtubeActor } from "@/lib/server/youtube-process";
import { canUseYoutubeAutomationPilot } from "@/lib/youtube-automation-gate";
import {
  createShortImage, readYoutubeShort, renderYoutubeClip, renderYoutubeShort, saveYoutubeShort, shortImageSchema, shortRenderSchema, shortSaveSchema,
  youtubeClipRenders, youtubeShortVideoUrl,
} from "@/lib/server/youtube-process-short";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;
const headers = { "cache-control": "private, no-store" };
const projectId = z.string().uuid();
const postSchema = z.discriminatedUnion("action", [
  shortImageSchema.extend({ action: z.literal("image") }).strict(),
  shortRenderSchema.extend({ action: z.literal("render") }).strict(),
  z.object({ action: z.literal("clip"), clipId: z.string().uuid() }).strict(),
]);

/** A 숏폼 project's card (?), the clips' renders (?clips=1) or a finished MP4 link (?video=<render id>[&download=1]). */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const actor = await youtubeActor(request);
    const id = projectId.parse((await params).id);
    const query = new URL(request.url).searchParams;
    const video = query.get("video");
    if (video) return NextResponse.json({ url: await youtubeShortVideoUrl(actor, id, z.string().uuid().parse(video), query.get("download") === "1") }, { headers });
    if (query.get("clips")) return NextResponse.json({ clips: await youtubeClipRenders(actor, id) }, { headers });
    return NextResponse.json({ short: await readYoutubeShort(actor, id) }, { headers });
  } catch (error) {
    if (error instanceof ZodError) return apiErrorResponse(new ApiError(404, "YOUTUBE_PROJECT_NOT_FOUND", "프로젝트를 찾지 못했습니다."));
    return apiErrorResponse(error);
  }
}

/** What to make and the scenes. */
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const actor = await youtubeActor(request);
    const input = shortSaveSchema.parse(await parseJson(request, 120_000));
    return NextResponse.json({ short: await saveYoutubeShort(actor, projectId.parse((await params).id), input) }, { headers });
  } catch (error) {
    if (error instanceof ZodError) return apiErrorResponse(new ApiError(400, "SHORT_INPUT_INVALID", "숏폼 내용을 확인해 주세요."));
    return apiErrorResponse(error);
  }
}

/** A scene image upload, the MP4 request for the 숏폼, or a longform clip's vertical video. */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const actor = await youtubeActor(request);
    const id = projectId.parse((await params).id);
    const input = postSchema.parse(await parseJson(request, 4_000));
    const { action, ...rest } = input;
    // The render PC takes these only where the automation is switched on (like the earlier shortform cards).
    if (action !== "image" && !canUseYoutubeAutomationPilot(process.env)) throw new ApiError(404, "AUTOMATION_PILOT_DISABLED", "영상 제작 연결을 준비 중입니다.");
    const result = action === "image" ? await createShortImage(actor, id, rest as z.infer<typeof shortImageSchema>)
      : action === "render" ? await renderYoutubeShort(actor, id, rest as z.infer<typeof shortRenderSchema>)
      : await renderYoutubeClip(actor, id, (rest as { clipId: string }).clipId);
    return NextResponse.json(result, { headers });
  } catch (error) {
    if (error instanceof ZodError) return apiErrorResponse(new ApiError(400, "SHORT_INPUT_INVALID", "요청 내용을 확인해 주세요."));
    return apiErrorResponse(error);
  }
}
