import { NextResponse } from "next/server";
import { z, ZodError } from "zod";
import { ApiError, apiErrorResponse, parseJson } from "@/lib/http";
import { authenticateRequest } from "@/lib/server/auth";
import { requestStaffJob, staffJobRequestSchema, staffJobStatus } from "@/lib/server/youtube-ai-jobs";
import { scheduleGptJob } from "@/lib/server/youtube-gpt-jobs";
import { isGptTask } from "@/lib/youtube-process/gpt-draft";
import { canUseYoutubeAutomationPilot, canUseYoutubeStaffScript } from "@/lib/youtube-automation-gate";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// GPT 초안 (2026-10-29): this request may start GPT work after its response (next/server after), which takes several minutes.
export const maxDuration = 800;
const headers = { "cache-control": "private, no-store" };
const disabled = () => new ApiError(404, "AUTOMATION_PILOT_DISABLED", "영상 자동화 파일럿이 아직 연결되지 않았습니다.");
// ② 원고 and ⑦ 발행키트 open on the staff switch; ③ 화면 설계 and 기획표 stay with the DEV-only pilot.
// 기획안 (유튜브 공정 v1) opens with them.
const STAFF_TASKS = ["script", "kit", "plan", "shorts", "short", "niche", "column", "short-copy", "retitle", "short-topics", "short-formula", "short-script"] as const;
const TASKS = ["scene-plan", "storyboard", ...STAFF_TASKS] as const;
const open = (task: (typeof TASKS)[number]) => ((STAFF_TASKS as readonly string[]).includes(task) ? canUseYoutubeStaffScript : canUseYoutubeAutomationPilot)(process.env);

/** The latest staff AI job of one kind (③ scene-plan by default, ② script) for one video and when the requester's AI last used its key. */
export async function GET(request: Request) {
  try {
    const params = new URL(request.url).searchParams;
    const task = z.enum(TASKS).parse(params.get("task") ?? "scene-plan");
    if (!open(task)) throw disabled();
    const actor = await authenticateRequest(request, { allowAgent: false });
    const sourceId = z.string().uuid().parse(params.get("sourceId"));
    return NextResponse.json(await staffJobStatus(actor, sourceId, task), { headers });
  } catch (error) {
    if (error instanceof ZodError) return apiErrorResponse(new ApiError(400, "INVALID_AUTOMATION_INPUT", "콘텐츠를 확인해 주세요."));
    return apiErrorResponse(error);
  }
}

/** ② 원고 or ③ 영상 제작 › 화면 설계 › [내 AI에 보내기]. */
export async function POST(request: Request) {
  try {
    const actor = await authenticateRequest(request, { allowAgent: false });
    // 20,000-letter attachments at up to 3 UTF-8 bytes each.
    const { gpt, ...body } = await parseJson(request, 64_000) as Record<string, unknown>;
    const input = staffJobRequestSchema.parse(body);
    if (!open(input.task)) throw disabled();
    // GPT 초안: gpt = "precise" | "saving" asks the OS to do the card now with the company's GPT credit.
    const tier = z.enum(["precise", "saving"]).optional().parse(gpt);
    if (tier && !isGptTask(input.task)) throw new ApiError(400, "GPT_TASK_UNSUPPORTED", "이 작업은 GPT로 바로 만들 수 없어요.");
    if (tier && !process.env.OPENAI_API_KEY?.trim()) throw new ApiError(503, "OPENAI_NOT_CONFIGURED", "OpenAI 연결이 아직 없어서 GPT로 만들 수 없어요.");
    const job = await requestStaffJob(actor, input, tier ? { tier } : undefined);
    if (tier && job.status === "backlog") scheduleGptJob(job.id, { id: actor.id, name: actor.name, team: actor.team }, tier);
    return NextResponse.json({ job }, { headers });
  } catch (error) {
    if (error instanceof ZodError) return apiErrorResponse(new ApiError(400, "INVALID_AUTOMATION_INPUT", "콘텐츠와 원고 버전을 확인해 주세요."));
    return apiErrorResponse(error);
  }
}
