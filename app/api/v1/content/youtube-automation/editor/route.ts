import { NextResponse } from "next/server";
import { z, ZodError } from "zod";
import { ApiError, apiErrorResponse } from "@/lib/http";
import { authenticateRequest } from "@/lib/server/auth";
import { myinEditorView } from "@/lib/server/myin-run";
import { getYoutubeProject } from "@/lib/server/youtube-process";
import { listFeedback } from "@/lib/server/youtube-process-feedback";
import { canUseYoutubeAutomationPilot } from "@/lib/youtube-automation-gate";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const headers = { "cache-control": "private, no-store" };
const querySchema = z.object({ projectId: z.string().uuid(), view: z.enum(["summary", "scenes", "subtitles", "assets", "orders"]).default("summary") });

/**
 * 영상 편집기 읽기 (로건 개발 문서 2026-11-03 §4-2, MCP get_video_editor): what an AI needs to edit a finished video, read only.
 * A person reads what the database lets them; an AI key only a video its owner made or is assigned (its database client is not
 * scoped, so the project is checked here). orders = the 최종 검토 feedback on the video still open.
 */
export async function GET(request: Request) {
  try {
    if (!canUseYoutubeAutomationPilot(process.env)) throw new ApiError(404, "AUTOMATION_PILOT_DISABLED", "영상 자동화 파일럿이 아직 연결되지 않았습니다.");
    const actor = await authenticateRequest(request, { allowAgent: true, requiredAgentScope: "knowledge.read" });
    const input = querySchema.parse(Object.fromEntries(new URL(request.url).searchParams));
    const project = await getYoutubeProject(actor, input.projectId);
    if (!project || (actor.type === "agent" && project.ownerId !== actor.ownerId && project.assigneeId !== actor.ownerId))
      throw new ApiError(404, "VIDEO_NOT_FOUND", "이 AI 키 주인이 만들었거나 맡은 영상만 읽을 수 있어요.");
    if (input.view === "orders") {
      const items = (await listFeedback(actor, project.id)).filter((item) => item.target === "video" && item.status === "open" && !item.deleted);
      return NextResponse.json({ projectId: project.id, title: project.title, orders: items.map(({ id, version, ver, t, range, text, kind, marks, who }) => ({ id, version, ver, t, range, text, kind, marks: marks ?? [], who })) }, { headers });
    }
    return NextResponse.json({ projectId: project.id, title: project.title, ...await myinEditorView(actor, project.id, input.view) }, { headers });
  } catch (error) {
    if (error instanceof ZodError) return apiErrorResponse(new ApiError(400, "INVALID_EDITOR_QUERY", "영상과 보기를 확인해 주세요."));
    return apiErrorResponse(error);
  }
}
