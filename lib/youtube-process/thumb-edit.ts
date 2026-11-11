// 제작 「최종 썸네일」 상세 수정: the shape a saved edit takes, checked where it is rendered and where 제작 stores it.
import { z } from "zod";

export const thumbCopySchema = z.object({ text: z.string().trim().min(1).max(40), accent: z.string().trim().max(20).default("") }).strict();
export const thumbEditSchema = z.object({
  size: z.number().min(60).max(220).optional(),
  photo: z.object({ scale: z.number(), x: z.number(), y: z.number(), brightness: z.number() }).strict().optional(),
  extras: z.array(z.object({ id: z.string().max(40), text: z.string().trim().min(1).max(20), color: z.enum(["ink", "accent", "red", "white"]),
    size: z.number(), x: z.number(), y: z.number() }).strict()).max(4).optional(),
}).strict();
/** What 제작 keeps with a slot: the picture it was made from (a candidate or the PD's own photo), the copy, the edits, and whether a
 *  finished thumbnail was put in by hand over it (full — 「우리 틀로 돌아가기」 renders the edit again). */
export const thumbSavedEditSchema = thumbEditSchema.extend({
  candidate: z.string().uuid().optional(), image: z.string().max(200).optional(), copy: thumbCopySchema, full: z.boolean().optional(),
}).strict();
export type ThumbSavedEdit = z.infer<typeof thumbSavedEditSchema>;
