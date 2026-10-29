import { NextResponse } from "next/server";
import { z, ZodError } from "zod";
import { ApiError, apiErrorResponse, parseJson } from "@/lib/http";
import { authenticateRequest } from "@/lib/server/auth";
import { assertHumanOwner, assertSameOrigin } from "@/lib/server/content-automation-v07";
import { publishPersonalThreads, readThreadsPublicationStatus } from "@/lib/server/threads-publication";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;
type Params = { params: Promise<{ id: string }> };
const inputSchema = z.object({ expectedVersion: z.number().int().positive(), accountOwnerId: z.string().uuid(), expectedAccountKey: z.string().regex(/^[0-9a-f]{64}$/), confirm: z.literal(true) }).strict();
function target(id: string) {
  if (!z.string().uuid().safeParse(id).success) throw new ApiError(404, "THREADS_SOURCE_NOT_FOUND", "내 쓰레드 원고를 찾을 수 없습니다.");
  return id;
}
export async function GET(request: Request, { params }: Params) {
  try {
    const actor = await authenticateRequest(request); assertHumanOwner(actor);
    return NextResponse.json(await readThreadsPublicationStatus(actor, target((await params).id)), { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return apiErrorResponse(error); }
}
export async function POST(request: Request, { params }: Params) {
  try {
    assertSameOrigin(request);
    const actor = await authenticateRequest(request, { verifySession: true }); assertHumanOwner(actor);
    const id = target((await params).id), input = inputSchema.parse(await parseJson(request, 5000));
    return NextResponse.json(await publishPersonalThreads(actor, id, input), { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof ZodError) return apiErrorResponse(new ApiError(422, "THREADS_PUBLICATION_INPUT", "원고 버전·게시 계정·직접 확인 여부를 확인해 주세요."));
    return apiErrorResponse(error);
  }
}
