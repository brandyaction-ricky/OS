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
