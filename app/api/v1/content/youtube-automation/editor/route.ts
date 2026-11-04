import { NextResponse } from "next/server";
import { z, ZodError } from "zod";
import { ApiError, apiErrorResponse } from "@/lib/http";
import { authenticateRequest } from "@/lib/server/auth";
import { confirmFinish, confirmStart, confirmStartSchema, declineEdit, editHandoff, editLock, editOrderResult, editOrderSchema, editorProject, editStatus, nextEditOrders, submitEditOrder } from "@/lib/server/myin-edit";
import { myinEditorView } from "@/lib/server/myin-run";
import { listFeedback } from "@/lib/server/youtube-process-feedback";
import { canUseYoutubeAutomationPilot } from "@/lib/youtube-automation-gate";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const headers = { "cache-control": "private, no-store" };
const querySchema = z.object({ projectId: z.string().uuid(), view: z.enum(["summary", "scenes", "subtitles", "assets", "orders", "edits"]).default("summary") });

/**
 * 영상 편집기 읽기 (로건 개발 문서 2026-11-03 §4-2, MCP get_video_editor): what an AI needs to edit a finished video, read only.
 * A person reads what the database lets them; an AI key only a video its owner made or is assigned (its database client is not
 * scoped, so the project is checked here). orders = the 최종 검토 feedback on the video still open; edits = who holds the edit lock
 * and the orders sent from members' AI chats, with what each became.
 */
export async function GET(request: Request) {
  try {
    if (!canUseYoutubeAutomationPilot(process.env)) throw new ApiError(404, "AUTOMATION_PILOT_DISABLED", "영상 자동화 파일럿이 아직 연결되지 않았습니다.");
    const actor = await authenticateRequest(request, { allowAgent: true, requiredAgentScope: "knowledge.read" });
    const input = querySchema.parse(Object.fromEntries(new URL(request.url).searchParams));
    const project = await editorProject(actor, input.projectId);
    if (input.view === "edits") return NextResponse.json({ title: project.title, ...await editStatus(actor, project.id) }, { headers });
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

const pc = z.string().trim().min(1).max(80);
const postSchema = z.object({ action: z.enum(["lock", "heartbeat", "unlock", "order", "next", "result", "decline", "confirm_start", "confirm_finish", "handoff"]), projectId: z.string().uuid() }).passthrough();
const resultSchema = z.object({ pc, orderId: z.string().uuid(), status: z.enum(["done", "failed", "queued"]), version: z.string().trim().max(80).optional(), note: z.string().trim().max(2000).optional() }).strict();
const finishSchema = z.object({ pc, confirmId: z.string().uuid(), parts: z.array(z.object({ bytes: z.number().int().positive(), sha256: z.string().regex(/^[a-f0-9]{64}$/) }).strict()).min(1).max(24) }).strict();
const declineSchema = z.object({ orderId: z.string().uuid().optional(), feedbackId: z.string().uuid().optional(), reason: z.string().trim().min(1).max(1000) }).strict()
  .refine((d) => d.orderId || d.feedbackId, "못 하는 주문이나 피드백을 골라 주세요.");

/**
 * 영상 편집기 ②-2 (로건 개발 문서 v2): lock · heartbeat · unlock and next · result come from the editor on a member's computer
 * (`pc` names it), and so do confirm_start · confirm_finish (a confirmed final with its material bundle) and handoff (to go on
 * editing on another computer); order and decline come from that member's AI chat (MCP submit_video_edit · decline_video_order).
 */
export async function POST(request: Request) {
  try {
    if (!canUseYoutubeAutomationPilot(process.env)) throw new ApiError(404, "AUTOMATION_PILOT_DISABLED", "영상 자동화 파일럿이 아직 연결되지 않았습니다.");
    const actor = await authenticateRequest(request, { allowAgent: true, requiredAgentScope: "records.write" });
    const { action, projectId, ...rest } = postSchema.parse(await request.json());
    if (action === "lock" || action === "heartbeat" || action === "unlock") return NextResponse.json(await editLock(actor, projectId, z.object({ pc }).strict().parse(rest).pc, action), { headers });
    if (action === "order") return NextResponse.json(await submitEditOrder(actor, projectId, editOrderSchema.parse(rest)), { headers });
    if (action === "next") return NextResponse.json(await nextEditOrders(actor, projectId, z.object({ pc }).strict().parse(rest).pc), { headers });
    if (action === "result") { const input = resultSchema.parse(rest); return NextResponse.json(await editOrderResult(actor, projectId, input.pc, input), { headers }); }
    if (action === "confirm_start") return NextResponse.json(await confirmStart(actor, projectId, confirmStartSchema.parse(rest)), { headers });
    if (action === "confirm_finish") return NextResponse.json(await confirmFinish(actor, projectId, finishSchema.parse(rest)), { headers });
    if (action === "handoff") return NextResponse.json(await editHandoff(actor, projectId, z.object({ at: z.string().datetime().optional() }).strict().parse(rest).at), { headers });
    return NextResponse.json(await declineEdit(actor, projectId, declineSchema.parse(rest)), { headers });
  } catch (error) {
    if (error instanceof ZodError) return apiErrorResponse(new ApiError(400, "INVALID_EDIT_REQUEST", error.issues.map((i) => `${i.path.join(".") || "요청"}: ${i.message}`).join(" / ")));
    return apiErrorResponse(error);
  }
}
