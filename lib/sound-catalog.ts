import { z } from "zod";

// 사운드 창고 (로건 2026-10-27): the music, effect and ambience keys the render PC's installed package can play, reported like the
// diagram list so the ④ editor offers only sounds this PC has.
export const soundCatalogSchema = z.object({
  items: z.array(z.object({
    kind: z.enum(["music", "sfx", "amb"]), key: z.string().min(1).max(80), title: z.string().max(200), note: z.string().max(200).optional(),
  }).strict()).max(600),
}).strict();
export type SoundCatalog = z.infer<typeof soundCatalogSchema> & { at?: string };

export function parseSavedSoundCatalog(text: string): SoundCatalog | null {
  const parsed = soundCatalogSchema.extend({ at: z.string().optional() }).safeParse(JSON.parse(text));
  return parsed.success ? parsed.data : null;
}
