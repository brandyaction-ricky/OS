// 마이인 v13 stage 2: the storyboard (myin_storyboard.json, Logan's manual §D) a staff AI writes against the frozen
// transcription. The OS checks it before anyone renders: the shape, and every cue phrase found exactly where Logan's
// renderer will look (his resolve() in myin_engine.py). His renderer also accepts a fuzzy match (ratio ≥ 0.62) that can land
// on the wrong sentence without a log line, so the OS asks for exact phrases.
import { z } from "zod";

// Logan's scene types (scene-types.md, structure-v2.md). A new metaphor needs Python code first, so an unknown type is
// reported for Logan instead of being rejected outright.
export const MYIN_SCENE_TYPES = ["opening", "hero", "statement", "strike", "steps", "versus", "list", "layers", "darkstat", "bigcircle",
  "need", "profiles", "bars", "quote", "outro", "iceberg", "apple", "puzzle", "cycle", "ripple", "button", "scale", "people", "compass",
  "venn", "site_ad", "summary", "endscreen"] as const;
export const MYIN_METAPHOR_TYPES = ["iceberg", "apple", "puzzle", "cycle", "ripple", "button", "scale", "people", "compass", "venn"];

const scene = z.object({ type: z.string().min(1), at: z.string().min(1).optional(), at_time: z.number().nonnegative().optional() })
  .passthrough().refine((value) => value.at !== undefined || value.at_time !== undefined, "at 또는 at_time이 필요합니다.");
export const myinStoryboardSchema = z.object({
  title: z.string().optional(),
  end: z.number().positive(),
  scenes: z.array(scene).min(5).max(200),
  music_cues: z.record(z.object({ file: z.string().min(1), start: z.number().nonnegative().optional() }).passthrough()).optional(),
  reel: z.object({ dur: z.number().positive() }).passthrough().optional(),
  cta: z.array(z.object({ after: z.string().min(1), line: z.string().min(1) }).passthrough()).min(1).max(3),
}).passthrough();
export type MyinStoryboard = z.infer<typeof myinStoryboardSchema>;

/** Logan's _norm(): only digits, Latin letters and Hangul count. */
export const myinNorm = (value: string) => value.replace(/[^0-9A-Za-z가-힣]/g, "");

/** Python difflib.SequenceMatcher(None, a, b).ratio() (no junk: Logan's segments are shorter than autojunk's 200). */
export function seqRatio(a: string, b: string) {
  if (!a.length && !b.length) return 1;
  const longest = (alo: number, ahi: number, blo: number, bhi: number) => {
    // find_longest_match: longest block, earliest in a, then earliest in b.
    let bi = alo, bj = blo, size = 0;
    let lengths = new Map<number, number>();
    for (let i = alo; i < ahi; i++) {
      const next = new Map<number, number>();
      for (let j = blo; j < bhi; j++) {
        if (a[i] !== b[j]) continue;
        const k = (lengths.get(j - 1) ?? 0) + 1;
        next.set(j, k);
        if (k > size) { bi = i - k + 1; bj = j - k + 1; size = k; }
      }
      lengths = next;
    }
    return [bi, bj, size] as const;
  };
  let matches = 0;
  const queue: [number, number, number, number][] = [[0, a.length, 0, b.length]];
  while (queue.length) {
    const [alo, ahi, blo, bhi] = queue.pop()!;
    const [i, j, k] = longest(alo, ahi, blo, bhi);
    if (!k) continue;
    matches += k;
    if (alo < i && blo < j) queue.push([alo, i, blo, j]);
    if (i + k < ahi && j + k < bhi) queue.push([i + k, ahi, j + k, bhi]);
  }
  return (2 * matches) / (a.length + b.length);
}

/** Logan's Cues.find: an exact hit starting within `limit` characters after `pos`, else the best window with ratio ≥ 0.62. */
function finder(words: [number, number, string][]) {
  const text = words.map(([, , word]) => myinNorm(word)).join("");
  return (phrase: string, pos: number, limit: number): { at: number; fuzzy: boolean } | null => {
    const p = myinNorm(phrase);
    if (!p) return null;
    const i = text.indexOf(p, pos);
    if (i >= 0 && i <= pos + limit) return { at: i, fuzzy: false };
    const seg = text.slice(pos, pos + limit + p.length);
    let best = 0, bi = -1;
    for (let j = 0; j < Math.max(1, seg.length - p.length + 1); j++) {
      const r = seqRatio(p, seg.slice(j, j + p.length));
      if (r > best) { best = r; bi = j; }
    }
    return best >= 0.62 && bi >= 0 ? { at: pos + bi, fuzzy: true } : null;
  };
}

/**
 * What Logan's resolve() reports as "문구 못 찾음" (misses), and the phrases it only placed by similarity (fuzzy), which can
 * sit on the wrong sentence: scene starts, cue / cue_* keys, [text, cue] title pieces and the CTA anchors.
 */
export function myinCueMisses(story: MyinStoryboard, words: [number, number, string][]) {
  const lookup = finder(words);
  const misses: string[] = [];
  const fuzzy: string[] = [];
  let scene = 0;
  const find = (phrase: string, pos: number, limit: number) => {
    const hit = lookup(phrase, pos, limit);
    if (hit?.fuzzy) fuzzy.push(`[장면 ${scene}] ${phrase}`);
    return hit ? hit.at : null;
  };
  let pos = 0;
  story.scenes.forEach((sc, n) => {
    scene = n + 1;
    if (sc.at_time !== undefined) return;
    const start = find(String(sc.at), pos, 2500);
    if (start === null) misses.push(`[장면 ${n + 1}] 시작 문구 못 찾음: ${sc.at}`);
    const scp = start ?? pos;
    const missed: string[] = [];
    const walk = (o: unknown) => {
      if (Array.isArray(o)) {
        for (const v of o) {
          if (Array.isArray(v) && v.length >= 2 && typeof v[0] === "string" && typeof v[1] === "string") { if (find(v[1], scp, 1400) === null) missed.push(v[1]); }
          else walk(v);
        }
      } else if (o && typeof o === "object") {
        for (const [k, v] of Object.entries(o)) {
          if ((k === "cue" || k.startsWith("cue_")) && typeof v === "string") { if (find(v, scp, 1400) === null) missed.push(v); }
          else walk(v);
        }
      }
    };
    walk(sc);
    if (missed.length) misses.push(`[장면 ${n + 1}] 문구 못 찾음: ${missed.join(" / ")}`);
    pos = scp + 1;
  });
  story.cta.forEach((cta, k) => { scene = 0; if (find(cta.after, 0, 400_000) === null) misses.push(`[구독 ${k + 1}] after 문구 못 찾음: ${cta.after}`); });
  return { misses, fuzzy };
}

/** Shape and cue problems as a list the staff AI can fix (empty = passes), plus notes for Logan that do not block. */
export function checkMyinStoryboard(value: unknown, words: [number, number, string][]) {
  const parsed = myinStoryboardSchema.safeParse(value);
  if (!parsed.success) return { issues: parsed.error.issues.slice(0, 20).map((issue) => `${issue.path.join(".") || "기획표"}: ${issue.message}`), notes: [] as string[], fuzzy: [] as string[], story: null };
  const story = parsed.data;
  const issues: string[] = [];
  const types = story.scenes.map((sc) => sc.type);
  if (types[0] !== "opening") issues.push("첫 장면은 opening이어야 합니다.");
  for (const required of ["outro", "summary", "endscreen"]) if (!types.includes(required)) issues.push(`${required} 장면이 없습니다.`);
  const cues = myinCueMisses(story, words);
  issues.push(...cues.misses);
  const notes = [...new Set(types.filter((type) => !(MYIN_SCENE_TYPES as readonly string[]).includes(type)))]
    .map((type) => `새 장면 종류 "${type}": 로건님 코드에 그리는 방법을 먼저 추가해야 합니다.`);
  return { issues: issues.slice(0, 40), notes, fuzzy: cues.fuzzy, story };
}
