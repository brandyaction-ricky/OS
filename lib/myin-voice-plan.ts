// 음성 고치기 범위 (유쓰 요청 0dfd9a37 보완 ①, 2026-11-03): before a fix is sent, which sentences will be made again, which memos point
// at the same one (sent once, paid once), which the OS cannot place, and how many sentences stay as they are. It finds a sentence the way
// Logan's voice_fix does — by the words heard (4+ Hangul, 60% of them in one sentence), then by the time — so the plan matches the run.

export interface VoiceSentence { at: number; text: string }
export interface VoiceMemo { memo: string; say?: string; read?: string; video?: true }
export interface VoiceTarget { index: number; at: number; text: string; memos: VoiceMemo[] }

const han = (text: string) => text.replace(/[^가-힣]/g, "");
const mmss = (text: string) => { const m = /^\s*(\d+):(\d+(?:\.\d+)?)/.exec(text); return m ? Number(m[1]) * 60 + Number(m[2]) : null; };
/** The words heard, as voice_fix reads them: the memo without its leading time, up to a bracket or an arrow. */
export const heardOf = (memo: string) => memo.replace(/^\s*\d+:\d+(?:\.\d+)?\s*/, "").split(/[(（]|->|→/)[0];

/** How much of `heard` one stretch of `sentence` holds (the longest run of Hangul in common), 0–1. */
function cover(heard: string, sentence: string) {
  let best = 0;
  for (let i = 0; i < heard.length; i++) for (let j = heard.length; j > i + best; j--) if (sentence.includes(heard.slice(i, j))) { best = j - i; break; }
  return heard.length ? best / heard.length : 0;
}

/**
 * A video-time memo (최종 검토) is placed by the render PC, which knows how the video's time maps to the voice; here it stays as written,
 * and two at the same second are one. A sentence with two different 「읽는 글」 or 발음 is a conflict for someone to settle first.
 */
export function planVoiceFix(memos: VoiceMemo[], sentences: VoiceSentence[]) {
  const targets = new Map<number, VoiceTarget>();
  const unplaced = new Map<string, VoiceMemo[]>();
  for (const memo of memos) {
    const heard = han(heardOf(memo.memo));
    let index = -1;
    if (heard.length >= 4) {
      const scores = sentences.map((sentence) => cover(heard, han(sentence.text)));
      const best = scores.indexOf(Math.max(...scores, 0));
      if (best >= 0 && scores[best] >= 0.6) index = best;
    }
    const at = mmss(memo.memo);
    if (index < 0 && !memo.video && at !== null && sentences.length) { index = 0; sentences.forEach((sentence, i) => { if (sentence.at <= at + 0.3) index = i; }); }
    if (index < 0) { const key = at === null ? memo.memo : `t${Math.round(at)}`; unplaced.set(key, [...(unplaced.get(key) ?? []), memo]); continue; }
    const target = targets.get(index) ?? { index, at: sentences[index].at, text: sentences[index].text, memos: [] };
    target.memos.push(memo);
    targets.set(index, target);
  }
  const groups = [...[...targets.values()].sort((a, b) => a.at - b.at).map((target) => target.memos), ...unplaced.values()];
  const one = (group: VoiceMemo[], key: "say" | "read") => [...new Set(group.map((memo) => memo[key]).filter(Boolean))] as string[];
  const conflicts = groups.filter((group) => one(group, "say").length > 1 || one(group, "read").length > 1).map((group) => group.map((memo) => memo.memo));
  // One fix per sentence: its first memo (voice_fix finds the sentence from it), with the 읽는 글 and 발음 any memo of it gave.
  const fixes = groups.map((group) => {
    const [say] = one(group, "say"), [read] = one(group, "read");
    return { ...group[0], ...(say ? { say } : {}), ...(read ? { read } : {}) };
  });
  return { targets: [...targets.values()].sort((a, b) => a.at - b.at), unplaced: [...unplaced.values()], conflicts, fixes,
    keep: Math.max(0, sentences.length - targets.size) };
}
