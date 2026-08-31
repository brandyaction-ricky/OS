import { z } from "zod";
import { DOCUMENT_STATUSES } from "./types";

const optionalTrimmed = z.string().trim().max(160).optional().default("");

export const documentCreateSchema = z.object({
  title: z.string().trim().min(1).max(200),
  content: z.string().min(1).max(1_500_000),
  folder: optionalTrimmed,
  brand: z.string().trim().max(120).optional().default(""),
  team: z.string().trim().max(120).optional().default(""),
  tags: z.array(z.string().trim().min(1).max(60)).max(30).optional().default([]),
  source: z.string().trim().max(40).optional().default("wiki"),
  sourceRef: z.string().trim().max(500).nullable().optional().default(null),
});

export const documentUpdateSchema = documentCreateSchema.partial().extend({
  id: z.string().uuid(),
  expectedVersion: z.number().int().positive(),
  reason: z.string().trim().max(500).optional().default(""),
});

export const searchSchema = z.object({
  organizationId: z.string().uuid().optional(),
  query: z.string().trim().min(1).max(1000),
  mode: z.enum(["hybrid", "keyword", "semantic"]).optional().default("hybrid"),
  topK: z.number().int().min(1).max(30).optional().default(10),
  filters: z
    .object({
      statuses: z.array(z.enum(DOCUMENT_STATUSES)).max(6).optional(),
      folder: z.string().trim().max(160).optional(),
      brand: z.string().trim().max(120).optional(),
    })
    .optional()
    .default({}),
});

export const statusChangeSchema = z.object({
  status: z.enum(DOCUMENT_STATUSES),
  note: z.string().trim().max(500).optional().default(""),
});
