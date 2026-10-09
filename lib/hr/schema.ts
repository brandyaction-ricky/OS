import { z } from "zod";
import { validDate } from "./domain";
export const date = z.string().refine(validDate, "날짜를 확인해 주세요.");
export const uuid = z.string().uuid();
export const reason = z
  .string()
  .trim()
  .min(1, "바꾼 이유를 적어 주세요.")
  .max(500);
const nullableText = (max = 500) =>
  z.string().trim().max(max).nullable().optional();
export const contractSchema = z
  .object({
    contract_type: z.enum(["permanent", "fixed_term", "part_time"]),
    start_date: date.optional(),
    end_date: date.nullable().optional(),
    probation_end: date.nullable().optional(),
    weekly_hours: z.number().min(1).max(40),
    work_days: z.string().max(80).optional(),
    work_time: z.string().max(80).optional(),
    workplace: z.string().max(200).optional(),
  })
  .strict()
  .refine((x) => x.contract_type !== "fixed_term" || !!x.end_date, {
    message: "기간제 계약 끝 날짜를 넣어 주세요.",
    path: ["end_date"],
  });
export const personSchema = z
  .object({
    id: uuid.optional(),
    profile_id: uuid.nullable().optional(),
    person_kind: z.enum(["employee", "owner", "contractor", "shared"]),
    display_name: z.string().trim().min(1).max(120),
    legal_name: z.string().trim().min(1).max(120).optional(),
    email: z
      .string()
      .trim()
      .email()
      .max(320)
      .transform((s) => s.toLowerCase())
      .nullable()
      .optional(),
    job_roles: z.array(z.string().trim().min(1).max(80)).max(12).optional(),
    affiliation: z.string().trim().max(120).optional(),
    gender: z.enum(["M", "F", "X"]).nullable().optional(),
    birth_date: date.nullable().optional(),
    address: nullableText(),
    phone: nullableText(40),
    emergency_contact: nullableText(120),
    career_summary: nullableText(2000),
    hire_date: date.optional(),
    status: z.enum(["active", "on_leave"]).optional(),
    leave_from: date.nullable().optional(),
    leave_to: date.nullable().optional(),
    contract: contractSchema.optional(),
    expected_updated_at: z.string().datetime({ offset: true }).optional(),
  })
  .strict();
export const leaveSchema = z
  .object({
    person: uuid,
    type: z.enum([
      "annual",
      "half_am",
      "half_pm",
      "sick",
      "family_event",
      "public_duty",
      "unpaid",
      "other",
    ]),
    start: date,
    end: date,
    reason: z.string().trim().max(500).nullable().optional(),
    proof: z.string().max(200).nullable().optional(),
    direct: z.boolean().default(false),
  })
  .strict();
export const version = z.number().int().positive();
export const fileSchema = z
  .object({
    purpose: z.enum([
      "document",
      "leave_proof",
      "credit_evidence",
      "promotion_paper",
      "form",
    ]),
    employee: uuid.nullable().optional(),
    size: z.number().int().positive(),
    mime: z.enum(["application/pdf", "image/jpeg", "image/png"]),
  })
  .strict();
export const promotionSchema = z
  .object({
    employee: uuid,
    step: z.enum([
      "notice_1",
      "designation_2",
      "notice_1_extra",
      "designation_2_extra",
    ]),
    days: z.number().nonnegative().max(999),
    dates: z.array(date).max(366).default([]),
    channel: z.enum(["os_email", "paper"]),
    body: z.string().trim().min(1).max(16000),
    paper: z.string().max(200).nullable().optional(),
  })
  .strict();
