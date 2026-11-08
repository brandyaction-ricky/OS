// 채널 모양 (유쓰 요청 5/8, 2026-11-02): per channel, the look Logan's engine already takes from a storyboard — the diagram tone (his
// 톤앤매너: base · key · ink · page), how the video ends (talk · outro) and the MYIN logo — chosen when a video's voice is started and
// pinned to it with its version, so changing the 틀 later never touches a video already being made. The 업로드 채널 it is meant for is
// compared with the one the video goes up on. Fonts and the subtitle box are fixed in his engine; they join once it takes them.
import { z } from "zod";

// 채널 카드 (다채널 설계 1단계, 2026-11-07, OS 문서 「다채널 콘텐츠 운영 설계」): the same list grew into the channel itself — what it is for
// (목적, which 목적 정본 it will read), its one-line concept, its own topic axis and the formats it runs. A project picks its channel; the
// first card is the 기본 채널, and every project made before channels belongs to it. Step 2: the channel's voice (a Fish Audio voice id;
// empty = the OS's own voice) — the render PC reads whatever voice the OS sends with the job, so no machine changes per channel.
const hex = z.string().regex(/^#[0-9A-Fa-f]{6}$/, "색은 #RRGGBB 로 적어 주세요");
export const channelToneSchema = z.object({ base: z.enum(["myin", "card"]), key: hex, ink: hex, page: hex }).strict();
export const CHANNEL_FORMATS = ["long", "short", "card", "threads"] as const;
export type ChannelFormat = (typeof CHANNEL_FORMATS)[number];
export const CHANNEL_FORMAT_LABEL: Record<ChannelFormat, string> = { long: "롱폼", short: "숏폼", card: "카드뉴스", threads: "스레드" };
export const channelStyleInput = z.object({
  id: z.string().uuid(), name: z.string().trim().min(1).max(30), channel: z.string().trim().max(60),
  tone: channelToneSchema.nullable(), ending: z.enum(["talk", "outro"]), logo: z.boolean(),
  purpose: z.string().trim().max(40).default(""), concept: z.string().trim().max(200).default(""), topics: z.string().trim().max(300).default(""),
  formats: z.array(z.enum(CHANNEL_FORMATS)).min(1, "운영 형식을 하나 이상 골라 주세요").max(CHANNEL_FORMATS.length).default([...CHANNEL_FORMATS]),
  voice: z.string().trim().max(64).regex(/^[A-Za-z0-9_-]*$/, "목소리 ID는 영문 · 숫자로 적어 주세요").default(""),
  // The YouTube channel (its id, from a connection) this channel's videos go up on; empty = matched by name, else the first.
  youtube: z.string().trim().max(64).regex(/^[A-Za-z0-9_-]*$/).default(""),
}).strict();
export type ChannelStyleInput = z.infer<typeof channelStyleInput>;
/** Cards saved before 2026-11-07 have no purpose · concept · topics · formats · voice: read them as empty and every format. */
type CardFields = "purpose" | "concept" | "topics" | "formats" | "voice" | "youtube";
export interface ChannelStyle extends Omit<ChannelStyleInput, CardFields>, Partial<Pick<ChannelStyleInput, CardFields>> { version: number; updatedAt: string; by: string }
/** What a video keeps of the style it was started with. */
export type PinnedStyle = Pick<ChannelStyle, "id" | "name" | "version" | "channel" | "tone" | "ending" | "logo">;

/** The formats a channel runs; a card from before formats runs them all. */
export const channelFormats = (style: Pick<ChannelStyle, "formats"> | null | undefined): ChannelFormat[] => style?.formats?.length ? style.formats : [...CHANNEL_FORMATS];
/** The format a project kind belongs to. */
export const formatOfKind = (kind: "live" | "anim" | "short" | "card"): ChannelFormat => kind === "short" || kind === "card" ? kind : "long";
/** A project's channel: the card it picked, else the 기본 채널 (the first card) — projects made before channels belong to it. */
export const channelOf = <T extends { id: string }>(styles: T[], id: string | null | undefined): T | undefined => styles.find(style => style.id === id) ?? styles[0];
/** The 기본 채널 holds every older project, so a save may not remove it or move another card above it. */
export const keepsDefault = (prev: Pick<ChannelStyle, "id">[], input: Pick<ChannelStyle, "id">[]) => !prev.length || input[0]?.id === prev[0].id;

/** The list saved: a card that changed gets the next version; an unchanged one keeps its version. */
export function nextStyles(prev: ChannelStyle[], input: ChannelStyleInput[], by: string, at: string): ChannelStyle[] {
  const look = (style: ChannelStyle | ChannelStyleInput) => JSON.stringify([style.name, style.channel, style.tone, style.ending, style.logo,
    style.purpose ?? "", style.concept ?? "", style.topics ?? "", channelFormats(style), style.voice ?? "", style.youtube ?? ""]);
  return input.map((style) => {
    const before = prev.find((row) => row.id === style.id);
    return before && look(before) === look(style) ? before : { ...style, version: (before?.version ?? 0) + 1, updatedAt: at, by };
  });
}

export const pinStyle = ({ id, name, version, channel, tone, ending, logo }: ChannelStyle): PinnedStyle => ({ id, name, version, channel, tone, ending, logo });
/** The 업로드 채널 differs from the one the style was made for (both named): told to the person, never decided for them. */
export const channelMismatch = (style: Pick<PinnedStyle, "channel"> | null | undefined, uploadChannel: string | null | undefined) =>
  Boolean(style?.channel && uploadChannel && style.channel.trim() !== uploadChannel.trim());

// 다채널 3단계 (2026-11-07): a channel other than the 기본 채널 reads its 목적 정본 — one OS document per purpose, shared by the
// channels with that purpose — and its card first (lib/server/channel-canon.ts finds the document).
export const purposeCanonTitle = (purpose: string) => `목적 정본 — ${purpose.trim()}`;
export const PURPOSE_CANON_PREFIX = "목적 정본 — ";

/** A channel row a 목적 정본 offers under 「## 채널 카드」 (| 채널 | 컨셉 | 주제 축 |), so a card is picked from the 정본, not typed. ⛔ = not decided yet. */
export function canonChannels(markdown: string) {
  const section = markdown.split(/^##\s+(?:\d+\.\s*)?채널 카드\s*$/m)[1]?.split(/^##\s/m)[0] ?? "";
  return section.split("\n").filter(line => line.trim().startsWith("|")).slice(2)
    .map(line => line.trim().replace(/^\||\|$/g, "").split("|").map(cell => cell.includes("⛔") ? "" : cell.trim()))
    .filter(([name]) => name).map(([name, concept = "", topics = ""]) => ({ name: name.slice(0, 30), concept: concept.slice(0, 200), topics: topics.slice(0, 300) }));
}

/** 대표 2026-11-08 「정본은 언제든 편하게 바꿀 수 있게」: a card named like a row of its 정본's table follows that row, so the 정본 is the one place its concept · topic axis change. */
export function followCanon<T extends { name: string; concept?: string; topics?: string }>(card: T, channels: ReturnType<typeof canonChannels>) {
  const row = channels.find(item => item.name === card.name.trim());
  return row ? { ...card, concept: row.concept, topics: row.topics } : card;
}

/** What an AI reads first for a channel that is not the 기본 채널: its card, then its 목적 정본 (opened by doc_id). */
export function channelBriefText(card: ChannelStyle, canon: { id: string; title: string }) {
  return [`## 이 영상의 채널 — 「${card.name}」 (먼저 읽기)`, `- 목적: ${card.purpose}`, card.concept ? `- 컨셉: ${card.concept}` : "",
    card.topics ? `- 주제 축: ${card.topics}` : "", `- 운영 형식: ${channelFormats(card).map(format => CHANNEL_FORMAT_LABEL[format]).join(" · ")}`,
    `- 목적 정본: 「${canon.title}」 (doc_id: ${canon.id}) — 이 채널의 타겟 · 메시지 · 말투 · 행동 유도 · 링크 · 금지 표현은 이 문서를 따릅니다.`,
    "- 아래 작업 카드가 여는 정본들은 마이인(기본 채널) 기준이에요. 구성 · 분량 · 제출 형식은 그대로 따르고, 내용이 목적 정본과 다르면 목적 정본이 이깁니다. 마이인 진단 · 마이인 링크 · 마이인 전용 표현은 이 채널에 쓰지 않습니다.",
  ].filter(Boolean).join("\n");
}
