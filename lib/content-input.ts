export interface TimedCue { start: number; end: number; text: string }

export function timestampSeconds(value: string): number | null {
  const parts = value.trim().replace(",", ".").split(":").map(Number);
  if (parts.length < 2 || parts.length > 3 || parts.some((part) => !Number.isFinite(part) || part < 0)) return null;
  if (parts.at(-1)! >= 60 || (parts.length === 3 && parts[1] >= 60)) return null;
  return parts.reduce((total, part) => total * 60 + part, 0);
}

/** SRT and WebVTT: preserve actual times; never estimate timings from prose. */
export function parseTimedTranscript(value: string): TimedCue[] {
  const cues: TimedCue[] = [];
  for (const block of value.replace(/\r/g, "").split(/\n\s*\n/)) {
    const lines = block.trim().split("\n");
    const timeIndex = lines.findIndex((line) => line.includes("-->"));
    if (timeIndex < 0) continue;
    const match = lines[timeIndex].match(/([\d:.,]+)\s*-->\s*([\d:.,]+)/);
    if (!match) continue;
    const start = timestampSeconds(match[1]); const end = timestampSeconds(match[2]);
    const text = lines.slice(timeIndex + 1).join(" ").replace(/<[^>]*>/g, "").trim();
    if (start === null || end === null || end <= start || !text) continue;
    cues.push({ start, end, text });
  }
  return cues.sort((a, b) => a.start - b.start);
}

export function contentSourceText(source: { record_type?: string; description?: string; metadata?: Record<string, unknown> }, scripts: Array<{ description?: string; status?: string }> = []) {
  const metadata = source.metadata ?? {};
  for (const key of ["transcriptSrt", "transcript", "script", "finalScript"]) {
    if (typeof metadata[key] === "string" && metadata[key].trim()) return metadata[key].trim();
  }
  const script = scripts.find((item) => ["ready", "done", "published"].includes(item.status ?? "")) ?? scripts[0];
  if (script?.description?.trim()) return script.description.trim();
  if (source.record_type === "content_script" || (metadata.automationSource === true && metadata.sourceTextKind !== "brief")) return source.description?.trim() ?? "";
  return "";
}

export const CHANNEL_PROCEDURES: Record<string, string> = {
  shorts: "숏폼_만드는_절차.md", threads: "쓰레드_쓰는_절차.md", column: "SEO칼럼_만드는_절차.md",
  instagram: "인스타_카드뉴스_만드는_절차.md", essay: "에세이_절차.md",
};
type Procedure = { id: string; title: string; source_ref: string | null; status: string; content_md: string };
export function selectChannelProcedures(documents: Procedure[], platforms: string[]) {
  const selected: Procedure[] = []; const missing: Array<{ file: string; reason: "missing" | "approval"; documentId?: string }> = [];
  for (const platform of [...new Set(platforms)]) {
    const file = CHANNEL_PROCEDURES[platform];
    if (!file) continue;
    const candidates = documents.filter((doc) => doc.source_ref?.replaceAll("\\", "/").split("/").at(-1)?.normalize("NFC") === file || doc.title === file.replace(/\.md$/, ""));
    const approved = candidates.find((doc) => doc.status === "canonical" && doc.content_md.trim());
    if (approved) selected.push(approved);
    else missing.push({ file, reason: candidates.length ? "approval" : "missing", documentId: candidates[0]?.id });
  }
  return { selected, missing };
}

export function validateClipRanges(clips: unknown, cues: TimedCue[]) {
  if (!Array.isArray(clips) || !clips.length || !cues.length) return false;
  const duration = Math.max(...cues.map((cue) => cue.end));
  return clips.every((clip) => clip && typeof clip === "object" && Number.isFinite(clip.start) && Number.isFinite(clip.end)
    && clip.start >= 0 && clip.end > clip.start && clip.end <= duration
    && cues.some((cue) => cue.start < clip.end && cue.end > clip.start));
}

export function assembleYoutubeKit(result: Record<string, unknown>, cues: TimedCue[]) {
  const tags = [...new Set((Array.isArray(result.tags) ? result.tags : []).map(String).map((tag) => tag.replace(/^#+/, "").trim()).filter(Boolean))];
  const chapters = (Array.isArray(result.chapters) ? result.chapters : []).map(String);
  const times = chapters.map((line) => timestampSeconds(line.match(/^([\d:]+)\s+/)?.[1] ?? ""));
  const valid = cues.length > 0 && chapters.length >= 3 && times[0] === 0 && times.every((time, index) => time !== null && (index === 0 || time > (times[index - 1] ?? Infinity))
    && time <= cues.at(-1)!.end && (time === 0 || cues.some((cue) => Math.abs(cue.start - time) < 1)));
  const safeChapters = valid ? chapters : [];
  const description = String(result.description ?? "").replace(/(?:^|\n)(?:\d{1,2}:)?\d{1,2}:\d{2}[^\n]*/g, "").trim();
  const checklist = [...(Array.isArray(result.checklist) ? result.checklist.map(String) : [])];
  if (!valid) checklist.unshift("실제 영상의 챕터 시각을 확인하고 00:00부터 3개 이상 입력");
  return { ...result, tags, chapters: safeChapters, description: safeChapters.length ? `${description}\n\n타임스탬프\n${safeChapters.join("\n")}` : description, checklist, chapterTimingVerified: valid };
}
