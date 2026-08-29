import { z } from "zod";
import { RECORD_TYPES } from "./record-types";

const optionalText = (max: number) => z.string().trim().max(max).optional();
const nullableDate = z.string().date().nullable().optional();
const nullableDateTime = z.string().datetime().nullable().optional();
const nullableUuid = z.string().uuid().nullable().optional();
const nullableNumber = z.number().finite().nullable().optional();

export const recordCreateSchema = z.object({
  recordType: z.enum(RECORD_TYPES),
  title: z.string().trim().min(1).max(240),
  description: z.string().max(20_000).default(""),
  status: z.string().trim().min(1).max(40).default("backlog"),
  priority: z.enum(["low", "normal", "high", "urgent"]).default("normal"),
  stage: z.string().trim().max(80).default(""),
  brand: z.string().trim().max(120).default(""),
  team: z.string().trim().max(120).default(""),
  assigneeId: nullableUuid,
  parentId: nullableUuid,
  dueDate: nullableDate,
  startsAt: nullableDateTime,
  endsAt: nullableDateTime,
  progress: z.number().int().min(0).max(100).default(0),
  metricTarget: nullableNumber,
  metricCurrent: nullableNumber,
  metricUnit: z.string().trim().max(30).default(""),
  amount: nullableNumber,
  currency: z.string().regex(/^[A-Z]{3}$/).default("KRW"),
  sourceUrl: z.string().url().max(2000).nullable().optional(),
  tags: z.array(z.string().trim().min(1).max(60)).max(30).default([]),
  metadata: z.record(z.unknown()).default({}),
});

export const recordUpdateSchema = recordCreateSchema.partial().extend({
  id: z.string().uuid(),
  expectedVersion: z.number().int().positive(),
  recordType: z.enum(RECORD_TYPES).optional(),
  title: optionalText(240),
});
