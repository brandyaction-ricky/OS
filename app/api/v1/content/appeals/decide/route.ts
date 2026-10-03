import { NextResponse } from "next/server";
import { z, ZodError } from "zod";
import { ApiError, apiErrorResponse, parseJson } from "@/lib/http";
import { authenticateRequest } from "@/lib/server/auth";

export const runtime = "nodejs";

const decideSchema = z.object({
  id: z.string().uuid(),
  expectedVersion: z.number().int().positive(),
  candidateSetVersion: z.string().max(80),
  entries: z.array(z.object({
    index: z.number().int().min(0).max(11),
    decision: z.enum(["approved", "revision", "held"]),
    note: z.string().trim().max(500).default(""),
  })).min(1).max(12),
});

export async function POST(request: Request) {
  try {
    const actor = await authenticateRequest(request);
    if (actor.type !== "user") throw new ApiError(403, "HUMAN_APPROVER_REQUIRED", "사람 승인자만 소구점을 판정할 수 있습니다.");
    const input = decideSchema.parse(await parseJson(request, 32_000));
    const { data, error } = await actor.supabase.rpc("os_decide_appeals", {
      p_record_id: input.id,
      p_expected_version: input.expectedVersion,
      p_set_version: input.candidateSetVersion,
      p_entries: input.entries,
    });
    if (error) {
      const denied = error.message.includes("OS_APPEAL_APPROVAL_DENIED");
      const conflict = error.message.includes("OS_APPEAL_VERSION_CONFLICT");
      throw new ApiError(denied ? 403 : conflict ? 409 : 400,
        denied ? "APPEAL_APPROVAL_DENIED" : conflict ? "APPEAL_VERSION_CONFLICT" : "APPEAL_DECISION_FAILED",
        denied ? "작성자는 승인할 수 없습니다. 지정 승인자 또는 위임자에게 요청해 주세요."
          : conflict ? "후보 세트가 바뀌었습니다. 다시 불러온 뒤 판정해 주세요." : "소구점 판정을 저장하지 못했습니다.");
    }
    return NextResponse.json({ record: data });
  } catch (error) {
    if (error instanceof ZodError) return apiErrorResponse(new ApiError(400, "INVALID_APPEAL_DECISION", "판정 대상을 확인해 주세요.", error.flatten()));
    return apiErrorResponse(error);
  }
}
