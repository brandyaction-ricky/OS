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

/** Shape and cue problems as a list the staff AI can fix (empty = passes), plus notes for Logan that do not block.
 *  catalogTypes: the lib_ diagrams the render PC reported (도식 창고); they count as known types. */
// 로건 운영 시험 (2026-10-23) 제작 기본값: 본문 장면의 절반 이상이 도식 · 이미지(창고 lib_ 도식, v13 비유 도식, 사진이 붙은 장면),
// 같은 무대(lib_stage_)는 영상당 2번까지 · 연달아 쓰지 않기. The first storyboard at ~15% read as too wordy; the approved 퇴사 전 순서 is 62%.
const FRAME_TYPES = new Set(["opening", "outro", "summary", "endscreen", "site_ad"]);
export const MYIN_MIN_VISUAL_SHARE = 0.5;
export function myinVisualShare(scenes: { type: string; photo?: unknown }[]) {
  const body = scenes.filter((sc) => !FRAME_TYPES.has(sc.type));
  const visual = body.filter((sc) => sc.type.startsWith("lib_") || MYIN_METAPHOR_TYPES.includes(sc.type) || Boolean(sc.photo));
  return { body: body.length, visual: visual.length };
}
function stageReuseIssues(types: string[]) {
  const issues: string[] = [];
  const counts = new Map<string, number>();
  types.forEach((type, index) => {
    if (!type.startsWith("lib_stage_")) return;
    counts.set(type, (counts.get(type) ?? 0) + 1);
    if (types[index - 1] === type) issues.push(`"${type}" 무대가 ${index}번째와 ${index + 1}번째 장면에 연달아 나와요. 사이에 다른 장면을 넣어 주세요.`);
  });
  for (const [type, count] of counts) if (count > 2) issues.push(`"${type}" 무대를 ${count}번 썼어요. 같은 무대는 영상당 2번까지예요.`);
  return issues;
}

export function checkMyinStoryboard(value: unknown, words: [number, number, string][], catalogTypes: readonly string[] = []) {
  const parsed = myinStoryboardSchema.safeParse(value);
  if (!parsed.success) return { issues: parsed.error.issues.slice(0, 20).map((issue) => `${issue.path.join(".") || "기획표"}: ${issue.message}`), notes: [] as string[], fuzzy: [] as string[], story: null };
  const story = parsed.data;
  const issues: string[] = [];
  const types = story.scenes.map((sc) => sc.type);
  if (types[0] !== "opening") issues.push("첫 장면은 opening이어야 합니다.");
  for (const required of ["outro", "summary", "endscreen"]) if (!types.includes(required)) issues.push(`${required} 장면이 없습니다.`);
  const cues = myinCueMisses(story, words);
  issues.push(...cues.misses);
  const known = new Set<string>([...MYIN_SCENE_TYPES, ...catalogTypes]);
  const unknown = [...new Set(types.filter((type) => !known.has(type)))];
  // A lib_ type outside the render PC's list would fail the render, so the staff AI must swap it; other new types stay notes for Logan.
  issues.push(...unknown.filter((type) => type.startsWith("lib_")).map((type) => `"${type}"는 렌더 PC가 그릴 수 없는 도식입니다. 도식 창고 목록에 있는 것으로 바꿔 주세요.`));
  const share = myinVisualShare(story.scenes as { type: string; photo?: unknown }[]);
  if (share.body && share.visual / share.body < MYIN_MIN_VISUAL_SHARE)
    issues.push(`도식 · 이미지 장면이 본문 ${share.body}개 중 ${share.visual}개(${Math.round(share.visual / share.body * 100)}%)예요. 절반 이상이 되게 글자 장면을 무대형 도식 · 창고 도식 · 사진 장면으로 바꿔 주세요.`);
  issues.push(...stageReuseIssues(types));
  const notes = unknown.filter((type) => !type.startsWith("lib_"))
    .map((type) => `새 장면 종류 "${type}": 로건님 코드에 그리는 방법을 먼저 추가해야 합니다.`);
  return { issues: issues.slice(0, 40), notes, fuzzy: cues.fuzzy, story };
}

/** The credits block appended to the YouTube description: the run's credit lines without the render PC's file names. */
export function myinCreditsBlock(credits: string[]) {
  const lines = credits.map((line) => line.replace(/^\S+\s+—\s+/, "").replace(/[<>]/g, "").trim()).filter(Boolean);
  return lines.length ? `\n\n사진·음악 출처\n${lines.map((line) => `- ${line}`).join("\n")}` : "";
}
