import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { ApiError, apiErrorResponse, parseJson } from "@/lib/http";
import { developmentCommentCreateSchema, developmentCommentMetadata, developmentCommentQuerySchema } from "@/lib/development-comments";
import { authenticateRequest, type RequestActor } from "@/lib/server/auth";
import { createServiceSupabase } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "private, no-store" };

function respondError(error: unknown) {
  if (error instanceof ZodError) return apiErrorResponse(new ApiError(400, "INVALID_DEVELOPMENT_COMMENT", "댓글 내용을 확인해 주세요.", error.flatten()));
  return apiErrorResponse(error);
}

async function getRequest(actor: RequestActor, requestId: string) {
  const { data, error } = await actor.supabase.from("os_records")
    .select("id,parent_id,brand,team")
    .eq("id", requestId)
    .eq("record_type", "ai_job")
    .eq("metadata->>kind", "development_request")
    .is("archived_at", null)
    .maybeSingle();
  if (error) throw new ApiError(500, "REQUEST_READ_FAILED", "개발 요청을 확인하지 못했습니다.");
  if (!data) throw new ApiError(404, "REQUEST_NOT_FOUND", "개발 요청이 없거나 접근할 수 없습니다.");
  return data;
}

async function getAuthorName(actor: RequestActor) {
  const { data } = await createServiceSupabase().from("os_profiles")
    .select("display_name,email")
    .eq("id", actor.ownerId)
    .maybeSingle();
  return String(data?.display_name || data?.email || actor.name).split("@")[0];
}

async function getMentions(ids: string[]) {
  if (!ids.length) return [];
  const { data, error } = await createServiceSupabase().from("os_profiles")
    .select("id,display_name,email")
    .in("id", ids)
    .eq("is_active", true);
  if (error) throw new ApiError(500, "COMMENT_MENTION_READ_FAILED", "멘션할 구성원을 확인하지 못했습니다.");
  if ((data ?? []).length !== ids.length) throw new ApiError(404, "COMMENT_MENTION_NOT_FOUND", "활성 상태인 구성원만 멘션할 수 있습니다.");
  const profiles = new Map((data ?? []).map((profile) => [profile.id, profile]));
  return ids.map((id) => {
    const profile = profiles.get(id)!;
    return { id, name: String(profile.display_name || profile.email || "구성원").split("@")[0] };
  });
}

async function assertReply(actor: RequestActor, requestId: string, replyTo: string | null | undefined) {
  if (!replyTo) return;
  const { data, error } = await actor.supabase.from("os_records")
    .select("id,metadata")
    .eq("id", replyTo)
    .eq("record_type", "development_comment")
    .eq("parent_id", requestId)
    .eq("metadata->>kind", "development_comment")
    .is("archived_at", null)
    .maybeSingle();
  if (error) throw new ApiError(500, "COMMENT_REPLY_READ_FAILED", "답글 대상을 확인하지 못했습니다.");
  if (!data) throw new ApiError(404, "COMMENT_REPLY_NOT_FOUND", "답글을 남길 댓글이 없거나 다른 요청의 댓글입니다.");
  if (data.metadata?.replyTo) throw new ApiError(400, "COMMENT_REPLY_DEPTH_EXCEEDED", "답글에는 다시 답글을 남길 수 없습니다.");
}

export async function GET(request: Request) {
  try {
    const actor = await authenticateRequest(request);
    const input = developmentCommentQuerySchema.parse(Object.fromEntries(new URL(request.url).searchParams));
    await getRequest(actor, input.requestId);
    const { data, error } = await actor.supabase.from("os_records")
      .select("*")
      .eq("record_type", "development_comment")
      .eq("parent_id", input.requestId)
      .eq("metadata->>kind", "development_comment")
      .is("archived_at", null)
      .order("created_at", { ascending: true })
      .order("id", { ascending: true })
      .range(0, 199);
    if (error) throw new ApiError(500, "COMMENT_LIST_FAILED", "요청 대화를 불러오지 못했습니다.");
    const comments = data ?? [];
    return NextResponse.json({ comments, truncated: comments.length === 200 }, { headers });
  } catch (error) { return respondError(error); }
}

export async function POST(request: Request) {
  try {
    const actor = await authenticateRequest(request);
    const input = developmentCommentCreateSchema.parse(await parseJson(request, 16_000));
    const developmentRequest = await getRequest(actor, input.requestId);
    await assertReply(actor, input.requestId, input.replyTo);
    const authorName = await getAuthorName(actor);
    const mentions = await getMentions(input.mentionIds);
    const { data, error } = await actor.supabase.from("os_records").insert({
      record_type: "development_comment",
      title: input.replyTo ? "개발 요청 답글" : "개발 요청 댓글",
      description: input.body,
      status: "active",
      priority: "normal",
      parent_id: input.requestId,
      brand: developmentRequest.brand ?? "",
      team: developmentRequest.team || actor.team,
      owner_id: actor.ownerId,
      created_by: actor.ownerId,
      updated_by: actor.ownerId,
      metadata: developmentCommentMetadata({
        requestId: input.requestId,
        replyTo: input.replyTo,
        authorName,
        mentionIds: mentions.map((mention) => mention.id),
        mentionNames: mentions.map((mention) => mention.name),
      }),
    }).select("*").single();
    if (error || !data) throw new ApiError(500, "COMMENT_CREATE_FAILED", "댓글을 저장하지 못했습니다.");
    return NextResponse.json({ comment: data }, { status: 201, headers });
  } catch (error) { return respondError(error); }
}
