import { z } from "zod";
import { measurementIssue } from "./ad-production.ts";
export const dispositionSchema = z
  .object({ kind: z.enum(["published", "withheld"]), value: z.string().trim().max(2000) })
  .strict();
export const adSetupSchema = z
  .object({
    brand: z.string().max(300).optional(),
    audience: z.string().max(2000).optional(),
    offer: z.string().max(4000).optional(),
    product: z.string().trim().min(1).max(500),
    evidence: z.string().trim().min(1).max(2000),
    goal: z.string().trim().min(1).max(300),
    landingUrl: z
      .string()
      .url()
      .max(2000)
      .refine((value) => {
        try {
          const u = new URL(value);
          return u.protocol === "https:" && !u.username && !u.password;
        } catch {
          return false;
        }
      }),
    campaign: z.string().trim().min(1).max(120),
    aspects: z
      .array(z.enum(["9x16", "4x5", "1x1"]))
      .min(1)
      .max(3)
      .refine((a) => new Set(a).size === a.length),
    path: z.enum(["free", "paid"]),
  })
  .strict();
const count = z.number().int().min(0).max(1e12);
export const measurementSchema = z
  .object({
    from: z.string(),
    to: z.string(),
    impressions: count,
    clicks: count,
    spend: count,
    purchases: count,
    revenue: count,
    refunds: count,
    refundedOrders: count,
    otherCosts: count,
    starts: count,
    completions: count,
    cohortConfirmed: z.boolean(),
  })
  .strict()
  .refine((value) => !measurementIssue(value), "집행 기간과 입력 수치를 확인해 주세요.");
