import { z } from "zod";
import { ApiError, apiErrorResponse } from "@/lib/http";
import { authenticateRequest } from "@/lib/server/auth";
import { knowledgeAccessContext } from "@/lib/server/knowledge-access";
import { projectMeetings } from "@/lib/knowledge/meetings";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Server owns session configuration and API credentials. Only SDP is returned to the browser.
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const id = z.string().uuid().safeParse((await params).id);
    if (!id.success) throw new ApiError(400, "INVALID_MEETING_ID", "회의 주소를 확인해 주세요.");
    const user = await authenticateRequest(request);
    const [{ actor }, record, attendance] = await Promise.all([
      knowledgeAccessContext(user, []),
      user.supabase.from("os_records").select("id,title,description,status,version,owner_id,created_by,created_at,updated_at,starts_at,metadata").eq("id", id.data).eq("record_type", "meeting").is("archived_at", null).maybeSingle(),
      user.supabase.from("os_meeting_attendees").select("meeting_id,user_id").eq("meeting_id", id.data),
    ]);
    if (record.error || attendance.error) throw new ApiError(503, "MEETING_ACCESS_UNAVAILABLE", "회의 권한을 확인하지 못했습니다.");
    const meeting = projectMeetings(record.data ? [record.data] : [], [], attendance.data ?? [], actor)[0];
    const owner = meeting?.owner_id === actor.ownerId || actor.role === "admin";
    if (!meeting || meeting.legacy || meeting.status === "done" || (!meeting.attendees.includes(actor.ownerId) && actor.role !== "admin") || (meeting.status === "review" && !owner)) {
      throw new ApiError(403, "MEETING_NOT_EDITABLE", "이 회의에서 녹음을 시작할 권한이 없습니다.");
    }
    if (!process.env.OPENAI_API_KEY) throw new ApiError(503, "TRANSCRIPTION_NOT_CONFIGURED", "AI 전사 연결을 확인해 주세요.");
    if (!request.headers.get("content-type")?.startsWith("application/sdp")) throw new ApiError(415, "SDP_REQUIRED", "녹음 연결 형식이 올바르지 않습니다.");
    const reader = request.body?.getReader();
    if (!reader) throw new ApiError(400, "SDP_REQUIRED", "녹음 연결 정보가 필요합니다.");
    const chunks: Uint8Array[] = []; let length = 0;
    while (true) {
      const { done, value } = await reader.read(); if (done) break;
      length += value.byteLength;
      if (length > 64_000) { await reader.cancel(); throw new ApiError(413, "SDP_TOO_LARGE", "녹음 연결 정보가 너무 큽니다."); }
      chunks.push(value);
    }
    const sdp = Buffer.concat(chunks).toString("utf8");
    if (!sdp.startsWith("v=0") || !sdp.includes("m=audio")) throw new ApiError(400, "INVALID_SDP", "마이크 연결 정보를 확인해 주세요.");
    const form = new FormData(); form.set("sdp", sdp);
    form.set("session", JSON.stringify({
      type: "transcription",
      audio: { input: {
        transcription: { model: "gpt-4o-mini-transcribe", language: "ko" },
        turn_detection: { type: "server_vad", threshold: 0.5, prefix_padding_ms: 300, silence_duration_ms: 600 },
        noise_reduction: { type: "near_field" },
      } },
    }));
    const response = await fetch("https://api.openai.com/v1/realtime/calls", {
      method: "POST", headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}` }, body: form,
      signal: AbortSignal.any([request.signal, AbortSignal.timeout(20_000)]),
    });
    if (!response.ok) throw new ApiError(502, "LIVE_TRANSCRIPTION_FAILED", "실시간 전사 연결에 실패했습니다. 녹음 종료 후 전사를 재시도할 수 있습니다.");
    return new Response(await response.text(), { headers: { "Content-Type": "application/sdp", "Cache-Control": "private, no-store" } });
  } catch (error) { return apiErrorResponse(error); }
}
