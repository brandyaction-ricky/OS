import {
  THREADS_REFERENCE_KIND,
  THREADS_REFERENCE_WORKFLOW,
  threadsReferenceItemsSchema,
} from "./threads-reference";

export type TopicBrief = {
  one: string;
  who: string;
  message: string;
  sources: string;
  warn: string;
};

type Topic = {
  title: string;
  stage?: string | null;
  metadata: Record<string, unknown>;
};

const BRIEF_KEYS = ["one", "who", "message", "sources", "warn"] as const;
const CHANNELS = ["card", "shorts", "threads"];
const text = (value: unknown) => typeof value === "string" ? value : "";

// Keep whole notes: cutting a source sentence mid-way can change its meaning.
// The complete source snapshot remains available in the reference panel and AI input.
function notesWithinLimit(notes: string[], limit: number, more: string) {
  const distinct = [...new Set(notes.map(note => note.trim()).filter(Boolean))];
  const complete = distinct.join("\n\n");
  if (complete.length <= limit) return complete;
  const kept: string[] = [];
  for (const note of distinct) {
    if ([...kept, note, more].join("\n\n").length > limit) break;
    kept.push(note);
  }
  return [...kept, more].join("\n\n");
}

/**
 * An unsaved planning aid, not an approved brief or a reference-quality verdict.
 * Only untouched reference candidates are seeded. A saved empty string is an edit,
 * so the presence of even one brief field disables seeding for the whole brief.
 */
export function getTopicBriefDraft(topic: Topic | null | undefined): {
  brief: TopicBrief;
  channels: string[];
  seeded: boolean;
} {
  const metadata = topic?.metadata ?? {};
  const raw = metadata.brief;
  const saved = raw && typeof raw === "object" && !Array.isArray(raw)
    ? raw as Record<string, unknown> : {};
  const brief: TopicBrief = {
    one: text(saved.one), who: text(saved.who), message: text(saved.message),
    sources: text(saved.sources), warn: text(saved.warn),
  };
  const channels = Array.isArray(metadata.channels)
    ? metadata.channels.filter((channel): channel is string => typeof channel === "string" && CHANNELS.includes(channel))
    : [];
  const untouched = topic?.stage === "candidate"
    && !BRIEF_KEYS.some(key => Object.hasOwn(saved, key))
    && (raw === undefined || raw !== null && typeof raw === "object" && !Array.isArray(raw));
  if (!untouched || metadata.editorial_workflow !== THREADS_REFERENCE_WORKFLOW
    || metadata.kind === THREADS_REFERENCE_KIND) return { brief, channels, seeded: false };

  const parsed = threadsReferenceItemsSchema.safeParse(metadata.reference_items);
  if (!parsed.success || !parsed.data.length) return { brief, channels, seeded: false };
  const references = parsed.data;
  const scope = { full: "전체 읽음", partial: "일부 읽음", preview: "미리보기만 확인", unavailable: "원문 확인 불가" };
  return {
    brief: {
      one: topic.title,
      who: notesWithinLimit(references.map(item => item.relevanceNote), 2000,
        "나머지 독자 관련성은 선택한 레퍼런스에서 확인해 주세요."),
      message: notesWithinLimit(references.map(item => item.addedPerspective), 2000,
        "나머지 관점은 선택한 레퍼런스에서 확인해 핵심 메시지를 정해 주세요."),
      sources: notesWithinLimit(references.map(item => [
        item.koreanTitle || item.title,
        [item.author, item.publishedAt].filter(Boolean).join(" · "),
        item.url,
        `읽은 범위: ${scope[item.readScope]}`,
      ].filter(Boolean).join("\n")), 4000,
      "나머지 원문과 실제 장면·확인 기록은 선택한 레퍼런스에서 확인해 주세요."),
      warn: "원문의 실제 장면과 우리가 더할 관점을 구분한다. 확인하지 않은 경험·수치·인용은 덧붙이지 않는다.",
    },
    channels: channels.length ? channels : ["threads"],
    seeded: true,
  };
}
