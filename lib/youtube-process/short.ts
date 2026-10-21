// 유튜브 공정 v1 숏폼 (owner decision 2026-10-21): the screens edit scenes by length; the render PC (shortform_render_v1)
// takes Codex's cut list — start · end as MM:SS.mmm, 00:00 to the chosen length without gaps.
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
