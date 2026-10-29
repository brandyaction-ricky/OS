import { z } from "zod";
import type { OsRecord } from "./record-types";

export const developmentCommentQuerySchema = z.object({
  requestId: z.string().uuid(),
});

export const developmentCommentCreateSchema = developmentCommentQuerySchema.extend({
  body: z.string().trim().min(1).max(5_000),
  replyTo: z.string().uuid().nullable().optional(),
  mentionIds: z.array(z.string().uuid()).max(12).default([])
    .refine((ids) => new Set(ids).size === ids.length, "같은 구성원을 두 번 멘션할 수 없습니다."),
});

/** 내 댓글 고치기 · 지우기 (2026-10-28): the new text, or `delete`. The DB lets only the author do either and keeps the old text. */
export const developmentCommentUpdateSchema = z.object({
  commentId: z.string().uuid(),
  body: z.string().trim().min(1).max(5_000).optional(),
  delete: z.literal(true).optional(),
}).refine((input) => Boolean(input.body) !== Boolean(input.delete), "고칠 내용이나 지우기 중 하나만 보내 주세요.");

/** What readers see: a deleted comment without its text, and no comment with its earlier texts. */
export function developmentCommentView<T extends Pick<OsRecord, "description" | "metadata">>(comment: T): T {
  const metadata = { ...comment.metadata };
  delete metadata.history;
  return { ...comment, description: metadata.deletedAt ? "" : comment.description, metadata };
}

export interface DevelopmentComment extends OsRecord {
  record_type: "development_comment";
}

export function isDevelopmentComment(record: Pick<OsRecord, "record_type" | "metadata">) {
  return record.record_type === "development_comment" && record.metadata?.kind === "development_comment";
}

export function developmentCommentMetadata(input: {
  requestId: string;
  replyTo?: string | null;
  authorName: string;
  authorType?: "member" | "agent";
  mentionIds?: string[];
  mentionNames?: string[];
}) {
  return {
    kind: "development_comment",
    requestId: input.requestId,
    replyTo: input.replyTo ?? "",
    authorName: input.authorName,
    authorType: input.authorType ?? "member",
    mentionIds: input.mentionIds ?? [],
    mentionNames: input.mentionNames ?? [],
  };
}
