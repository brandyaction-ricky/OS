import { z } from "zod";
import { cardProblems, type CardDraft } from "./formats.ts";
import { productionSchema } from "./production.ts";
/** A transient proof uses only bundled assets or one bounded, browser-normalized PNG. No external URLs or storage paths. */
export const myinEditableSchema = z.object({
  draft: z.object({
    id: z.string().max(100), format: z.literal("list"), formatVersion: z.literal(1),
    workTitle: z.string().max(200).optional(), at: z.string().max(50), by: z.string().max(100),
    production: productionSchema.refine(p => p.design?.startsWith("myin-") && !p.reference, "마이인 디자인을 골라 주세요."),
    slides: z.array(z.object({ type: z.enum(["cover", "item", "summary", "end"]), myinVisual: z.enum(["report", "observation"]).optional(), fields: z.record(z.string().max(400)).refine(v => Object.keys(v).length <= 6) }).strict()).min(6).max(10),
    caption: z.string().max(2200), hashtags: z.array(z.string().max(50)).max(5),
  }).strict(),
  art: z.string().max(2_000_000).regex(/^data:image\/png;base64,[A-Za-z0-9+/]+=*$/).optional(),
  slide: z.number().int().min(0).max(9).optional(), zip: z.boolean().optional(),
}).strict();
export const myinPreviewSchema = myinEditableSchema.superRefine((v, ctx) => {
  const problem = cardProblems(v.draft as CardDraft).blocking[0];
  if (problem) ctx.addIssue({ code: "custom", message: problem });
  if (v.slide !== undefined && v.slide >= v.draft.slides.length) ctx.addIssue({ code: "custom", message: "없는 장이에요." });
});
