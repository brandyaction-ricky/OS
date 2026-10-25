// 유튜브 공정 v1 숏폼 (owner decision 2026-10-21): the screens edit scenes by length; the render PC (shortform_render_v1)
// takes Codex's cut list — start · end as MM:SS.mmm, 00:00 to the chosen length without gaps.
import { GateError } from "./confirm.ts";
import type { YpMeta } from "./project.ts";
import type { YpUpload } from "./stages.ts";
export type YpShortPurpose = "organic" | "ad";
export type YpShortDuration = 15 | 30 | 60;
export interface YpShortBrief { purpose: YpShortPurpose; duration: YpShortDuration; product: string; audience: string; goal: string; landingUrl: string; evidence: string; appeal: string }
export interface YpShortScene { seconds: number; text: string; voice: string; note: string; asset: string; assetId?: string }
export interface YpShortCut { start: string; end: string; text: string; note: string; voice?: string; asset?: string; missingAsset?: boolean; assetId?: string }
export interface YpShortAppeal { title: string; reason: string; evidence: string; basis: "evidence" | "hypothesis" }

/** The picked reason as the brief keeps it (the same text whether picked on screen or by the AI). */
export const appealText = (appeal: YpShortAppeal) => `${appeal.title}\n${appeal.reason}\n근거: ${appeal.evidence || "추가 확인 필요"}\n${appeal.basis === "evidence" ? "입력 근거 기반" : "검증할 가설"}`;

export function shortformTime(seconds: number) {
  const ms = Math.round(seconds * 1000), minutes = Math.floor(ms / 60_000), rest = ms % 60_000;
  return `${minutes >= 60 ? `${String(Math.floor(minutes / 60)).padStart(2, "0")}:` : ""}${String(minutes % 60).padStart(2, "0")}:${String(Math.floor(rest / 1000)).padStart(2, "0")}.${String(rest % 1000).padStart(3, "0")}`;
}
export function shortSeconds(value: string) {
  const parts = value.split(":").map(Number);
  return parts.some(part => !Number.isFinite(part)) ? NaN : parts.reduce((total, part) => total * 60 + part, 0);
}

/** Scenes → cuts: each scene runs on from the last one and the last scene takes what is left of the chosen length. */
export function cutsFromScenes(scenes: YpShortScene[], duration: number): YpShortCut[] {
  let at = 0;
  return scenes.map((scene, index) => {
    const end = index === scenes.length - 1 ? duration : Math.min(duration, at + Math.max(0, scene.seconds));
    const cut: YpShortCut = { start: shortformTime(at), end: shortformTime(end), text: scene.text, note: scene.note, voice: scene.voice, asset: scene.asset,
      missingAsset: !scene.assetId, ...(scene.assetId ? { assetId: scene.assetId } : {}) };
    at = end;
    return cut;
  });
}
export const scenesFromCuts = (cuts: YpShortCut[]): YpShortScene[] => cuts.map(cut => ({
  seconds: Math.round((shortSeconds(cut.end) - shortSeconds(cut.start)) * 10) / 10, text: cut.text, voice: cut.voice ?? "", note: cut.note ?? "", asset: cut.asset ?? "",
  ...(cut.assetId ? { assetId: cut.assetId } : {}),
}));

/** What still keeps the 숏폼 from being made, one line each (the render PC checks the same again). */
export function shortMissing(brief: YpShortBrief, scenes: YpShortScene[]) {
  const missing: string[] = [];
  if (!brief.audience.trim()) missing.push("누구에게 보여 줄지 써주세요");
  if (!brief.goal.trim()) missing.push("보고 나서 할 행동을 써주세요");
  if (brief.purpose === "ad") {
    if (!brief.product.trim()) missing.push("광고할 상품 · 서비스를 써주세요");
    if (!brief.landingUrl.trim()) missing.push("연결할 페이지 주소를 써주세요");
    if (!brief.evidence.trim()) missing.push("광고에 쓸 실제 근거를 써주세요");
    if (!brief.appeal.trim()) missing.push("구매 이유를 하나 골라주세요");
  }
  if (!scenes.length) missing.push("장면을 만들어 주세요");
  const before = scenes.slice(0, -1).reduce((total, scene) => total + scene.seconds, 0);
  if (scenes.slice(0, -1).some(scene => scene.seconds <= 0)) missing.push("장면 길이는 0초보다 길게 써주세요");
  if (scenes.length && before >= brief.duration) missing.push(`앞 장면들이 ${brief.duration}초를 넘어요`);
  if (scenes.some(scene => !scene.text.trim())) missing.push("장면마다 자막을 써주세요");
  if (scenes.some(scene => !scene.assetId)) missing.push("장면마다 이미지를 넣어주세요");
  return missing;
}

/**
 * A clip of the longform → cuts in source time, one per subtitle line, joined end to start so the voice never jumps.
 * ponytail: more than 20 lines are merged pairwise (the renderer's limit); a merged caption over four lines stops the render with its reason.
 */
export function clipCuts(cues: { start: number; end: number; text: string }[], start: number, end: number, fallback: string, max = 20): YpShortCut[] {
  let parts: { at: number; text: string }[] = [];
  for (const cue of cues) {
    const text = cue.text.replace(/\s+/g, " ").trim();
    if (!text || cue.end <= start + 0.05 || cue.start >= end - 0.05) continue;
    const at = Math.max(start, cue.start);
    const last = parts.at(-1);
    if (last && at <= last.at + 0.3) last.text = `${last.text} ${text}`;
    else parts.push({ at, text });
  }
  if (!parts.length) parts = [{ at: start, text: fallback }];
  while (parts.length > max) {
    const merged: typeof parts = [];
    for (let i = 0; i < parts.length; i += 2) merged.push(parts[i + 1] ? { at: parts[i].at, text: `${parts[i].text} ${parts[i + 1].text}` } : parts[i]);
    parts = merged;
  }
  return parts.map((part, index) => ({ start: shortformTime(index ? part.at : start), end: shortformTime(parts[index + 1]?.at ?? end), text: part.text.slice(0, 240), note: "롱폼 자막" }));
}

// ── 롱폼 → 쇼츠 대본 (owner request 2026-10-25, 숏폼 정본 모드 A "단순 클립 말고 재구성"): up to four parts of the final in the
// order they play — the first carries the 3-second hook — confirmed by the PD (쇼츠 확정) before anything is made or uploaded.
export interface YpClipPart { start: number; end: number }
export const CLIP_MAX_PARTS = 4;
export const CLIP_MAX_SECONDS = 60;
type ClipLike = { title: string; metadata?: Record<string, unknown> | null };
/** The parts of a clip: its `segments`, or the single start · end of a clip made before them. */
export function clipParts(metadata: Record<string, unknown> | null | undefined): YpClipPart[] {
  const parts = (Array.isArray(metadata?.segments) ? metadata.segments as { start?: unknown; end?: unknown }[] : [])
    .map(part => ({ start: Number(part?.start), end: Number(part?.end) })).filter(part => Number.isFinite(part.start) && Number.isFinite(part.end));
  return parts.length ? parts : [{ start: Number(metadata?.start ?? 0), end: Number(metadata?.end ?? 0) }];
}
export const clipSeconds = (parts: YpClipPart[]) => parts.reduce((total, part) => total + Math.max(0, part.end - part.start), 0);
/** What keeps a clip's script from the 쇼츠 확정, one word each (empty when it can be confirmed). */
export function clipScriptProblems(clip: ClipLike) {
  const parts = clipParts(clip.metadata);
  const total = clipSeconds(parts);
  return [
    !clip.title.trim() ? "제목" : "",
    !String(clip.metadata?.desc ?? "").trim() ? "설명" : "",
    parts.length > CLIP_MAX_PARTS ? `구간은 ${CLIP_MAX_PARTS}개까지` : "",
    parts.some(part => part.start < 0 || part.end - part.start < 1) ? "구간 시각" : "",
    total > CLIP_MAX_SECONDS ? `${Math.round(total)}초 (${CLIP_MAX_SECONDS}초 이내)` : "",
  ].filter(Boolean);
}
/** The script as the PD confirmed it; any change after the 확정 reads as a different signature. */
export const clipSignature = (clip: ClipLike) =>
  JSON.stringify([clip.title.trim(), String(clip.metadata?.hook ?? "").trim(), String(clip.metadata?.desc ?? "").trim(), clipParts(clip.metadata)]);
/** Confirmed (쇼츠 확정) and unchanged since: the clip may become a vertical video and go up. */
export const clipConfirmed = (confirmed: { clips: Record<string, string> } | undefined, clip: ClipLike & { id: string }) =>
  confirmed?.clips[clip.id] === clipSignature(clip);
export const SHORTS_LOG_MAX = 50;
/** The project after a 쇼츠 확정 (the picked clips, each confirmed as it is now) or a comment; throws GateError when it cannot be confirmed. */
export function shortsAction(yp: YpMeta, input: { action: "confirm"; note?: string; clips: (ClipLike & { id: string })[] } | { action: "comment"; text: string }, who: { id: string; name: string }, now: string): YpMeta {
  let next = yp;
  let count: number | undefined;
  if (input.action === "confirm") {
    const { clips } = input;
    if (!clips.length) throw new GateError("SHORTS_EMPTY", "쇼츠로 만들 대본을 하나 이상 채택해 주세요.");
    const unfinished = clips.map(clip => ({ clip, problems: clipScriptProblems(clip) })).filter(row => row.problems.length);
    if (unfinished.length) throw new GateError("SHORTS_SCRIPT_INCOMPLETE", `쇼츠 대본을 채워 주세요 — ${unfinished.slice(0, 3).map(row => `${row.clip.title || "제목 없음"}: ${row.problems.join(", ")}`).join(" / ")}`, 422);
    if (clips.every(clip => clipConfirmed(yp.shortsConfirmed, clip))) throw new GateError("SHORTS_NOTHING_NEW", "새로 확정할 쇼츠가 없어요.");
    // The gate keeps who confirmed and when (the 대표 메뉴 list reads it); it is never requested or waited on.
    next = { ...yp, shortsConfirmed: { at: now, by: who.id, clips: Object.fromEntries(clips.map(clip => [clip.id, clipSignature(clip)])) },
      gates: { ...yp.gates, shorts: { state: "ok", round: yp.gates.shorts.round + 1, requestedAt: now, requestedBy: who.id, decidedAt: now, decidedBy: who.id } } };
    count = clips.length;
  }
  const entry = { at: now, by: who.id, byName: who.name, kind: input.action, text: (input.action === "confirm" ? input.note ?? "" : input.text).trim(), ...(count ? { count } : {}) };
  return { ...next, shortsLog: [...(next.shortsLog ?? []), entry].slice(-SHORTS_LOG_MAX) };
}
/** All parts → cuts in source time (the render plays them in this order), within the renderer's 20 cuts. */
export const partsCuts = (cues: { start: number; end: number; text: string }[], parts: YpClipPart[], fallback: string) =>
  parts.flatMap(part => clipCuts(cues, part.start, part.end, fallback, Math.max(1, Math.floor(20 / parts.length))));
/** "05:30-05:36, 02:10-02:50" ↔ parts (the screen's 구간 field). */
export const formatParts = (parts: YpClipPart[]) => parts.map(part => `${clock(part.start)}-${clock(part.end)}`).join(", ");
export function parseParts(text: string): YpClipPart[] | null {
  const parts = text.split(/[,\n]/).map(item => item.trim()).filter(Boolean).map(item => {
    const [start, end] = item.split(/\s*[-~]\s*/).map(shortSeconds);
    return { start, end };
  });
  return parts.length && parts.every(part => Number.isFinite(part.start) && Number.isFinite(part.end) && part.end > part.start) ? parts : null;
}
const clock = (seconds: number) => {
  const tenths = Math.round(seconds * 10) / 10, whole = Math.floor(tenths);
  return `${String(Math.floor(whole / 60)).padStart(2, "0")}:${String(whole % 60).padStart(2, "0")}${tenths % 1 ? `.${Math.round((tenths % 1) * 10)}` : ""}`;
};

/**
 * 숏폼 내보내기 (2026-10-25): the AI's title and description fill an empty (or untouched AI) field; what a person wrote stays and the
 * draft waits beside it (9-5). Throws GateError for a wrong shape (the job gets it back as issues).
 */
export function applyShortCopy(current: YpUpload, value: unknown, author: { userId: string; name: string; model: string; jobId: string }, at: string): YpUpload {
  const result = (value ?? {}) as { title?: unknown; description?: unknown };
  const title = typeof result.title === "string" ? result.title.trim() : "";
  const description = typeof result.description === "string" ? result.description.trim() : "";
  if (!title || title.length > 100 || !description || description.length > 4000 || Object.keys(result).some(key => !["title", "description"].includes(key)))
    throw new GateError("SHORT_COPY_INVALID", "result는 { \"title\": 100자 이내, \"description\": 4000자 이내 } 두 칸이에요.", 422);
  const keepDesc = Boolean(current.desc.trim()) && current.desc !== current.descBy?.draft;
  const keepTitle = Boolean(current.title?.trim()) && current.title !== current.descBy?.title;
  return { ...current, descBy: { ...author, at, draft: description, title }, ...(keepDesc ? {} : { desc: description }), ...(keepTitle ? {} : { title }) };
}

