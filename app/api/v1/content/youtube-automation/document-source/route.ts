import { NextResponse } from "next/server";
import { z, ZodError } from "zod";
import { ApiError, apiErrorResponse, parseJson } from "@/lib/http";
import { authenticateRequest } from "@/lib/server/auth";
import { readApprovedScriptDocument } from "@/lib/server/youtube-automation-input";
import { canUseYoutubeAutomationPilot } from "@/lib/youtube-automation-gate";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const inputSchema = z.object({ documentId: z.string().uuid() }).strict();

/**
 * Temporary bridge (DEV pilot only): bind one approved script document version to a
 * content record the video automation can run from. Reuses the record for the same version.
 */
export async function POST(request: Request) {
  try {
    if (!canUseYoutubeAutomationPilot(process.env)) throw new ApiError(404, "AUTOMATION_PILOT_DISABLED", "영상 자동화 파일럿이 아직 연결되지 않았습니다.");
    const actor = await authenticateRequest(request, { allowAgent: false });
    const { documentId } = inputSchema.parse(await parseJson(request, 1_000));
    const doc = await readApprovedScriptDocument(actor.supabase, documentId);
    const scriptDocument = { id: doc.id, version: doc.version, contentSha256: doc.contentSha256 };
    const { data: existing } = await actor.supabase.from("os_records").select("*").eq("record_type", "content_topic")
      .eq("metadata->scriptDocument->>id", doc.id).eq("metadata->scriptDocument->>contentSha256", doc.contentSha256).is("archived_at", null).limit(1);
    if (existing?.length) return NextResponse.json({ source: existing[0], reused: true });
    const { data, error } = await actor.supabase.from("os_records").insert({
      record_type: "content_topic", title: doc.title.slice(0, 240), description: "승인된 원고 문서로 만드는 내레이션 영상입니다.",
      status: "planned", priority: "normal", stage: "영상 자동화", owner_id: actor.id, created_by: actor.id, updated_by: actor.id,
      team: actor.team, brand: actor.brand ?? "", tags: ["유튜브", "영상자동화"],
      metadata: { automationSource: "script_document", scriptDocument },
    }).select("*").single();
    if (error || !data) throw new ApiError(400, "DOCUMENT_SOURCE_CREATE_FAILED", "원고 문서로 영상 작업을 만들지 못했습니다.");
    return NextResponse.json({ source: data, reused: false }, { status: 201 });
  } catch (error) {
    if (error instanceof ZodError) return apiErrorResponse(new ApiError(400, "INVALID_DOCUMENT_SOURCE", "원고 문서를 확인해 주세요."));
    return apiErrorResponse(error);
  }
}
