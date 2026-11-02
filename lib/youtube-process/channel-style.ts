// 채널 모양 (유쓰 요청 5/8, 2026-11-02): per channel, the look Logan's engine already takes from a storyboard — the diagram tone (his
// 톤앤매너: base · key · ink · page), how the video ends (talk · outro) and the MYIN logo — chosen when a video's voice is started and
// pinned to it with its version, so changing the 틀 later never touches a video already being made. The 업로드 채널 it is meant for is
// compared with the one the video goes up on. Fonts and the subtitle box are fixed in his engine; they join once it takes them.
import { z } from "zod";

const hex = z.string().regex(/^#[0-9A-Fa-f]{6}$/, "색은 #RRGGBB 로 적어 주세요");
export const channelToneSchema = z.object({ base: z.enum(["myin", "card"]), key: hex, ink: hex, page: hex }).strict();
export const channelStyleInput = z.object({
  id: z.string().uuid(), name: z.string().trim().min(1).max(30), channel: z.string().trim().max(60),
  tone: channelToneSchema.nullable(), ending: z.enum(["talk", "outro"]), logo: z.boolean(),
}).strict();
export type ChannelStyleInput = z.infer<typeof channelStyleInput>;
export interface ChannelStyle extends ChannelStyleInput { version: number; updatedAt: string; by: string }
/** What a video keeps of the style it was started with. */
export type PinnedStyle = Pick<ChannelStyle, "id" | "name" | "version" | "channel" | "tone" | "ending" | "logo">;

/** The list saved: a style whose look changed gets the next version; an unchanged one keeps its version. */
export function nextStyles(prev: ChannelStyle[], input: ChannelStyleInput[], by: string, at: string): ChannelStyle[] {
  const look = (style: ChannelStyleInput) => JSON.stringify([style.name, style.channel, style.tone, style.ending, style.logo]);
  return input.map((style) => {
    const before = prev.find((row) => row.id === style.id);
    return before && look(before) === look(style) ? before : { ...style, version: (before?.version ?? 0) + 1, updatedAt: at, by };
  });
}

export const pinStyle = ({ id, name, version, channel, tone, ending, logo }: ChannelStyle): PinnedStyle => ({ id, name, version, channel, tone, ending, logo });
/** The 업로드 채널 differs from the one the style was made for (both named): told to the person, never decided for them. */
export const channelMismatch = (style: Pick<PinnedStyle, "channel"> | null | undefined, uploadChannel: string | null | undefined) =>
  Boolean(style?.channel && uploadChannel && style.channel.trim() !== uploadChannel.trim());
