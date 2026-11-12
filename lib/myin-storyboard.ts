// 마이인 v13 stage 2: the storyboard (myin_storyboard.json, Logan's manual §D) a staff AI writes against the frozen
// transcription. The OS checks it before anyone renders: the shape, and every cue phrase found exactly where Logan's
// renderer will look (his resolve() in myin_engine.py). His renderer also accepts a fuzzy match (ratio ≥ 0.62) that can land
// on the wrong sentence without a log line, so the OS asks for exact phrases.
import { z } from "zod";

// Logan's scene types (scene-types.md, structure-v2.md). A new metaphor needs Python code first, so an unknown type is
// reported for Logan instead of being rejected outright.
export const MYIN_SCENE_TYPES = ["opening", "hero", "statement", "strike", "steps", "versus", "list", "layers", "darkstat", "bigcircle",
  "need", "profiles", "bars", "quote", "outro", "iceberg", "apple", "puzzle", "cycle", "ripple", "button", "scale", "people", "compass",
  "venn", "site_ad", "summary", "endscreen", "situation"] as const;  // situation: 로건 QA 기준 E8 (2026-10-27), drawn by s_situation
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

/** Python difflib.SequenceMatcher(None, a, b).get_matching_blocks() without the final sentinel, in order: [i in a, j in b, size]. */
export function matchingBlocks(a: string, b: string) {
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
  const blocks: [number, number, number][] = [];
  const queue: [number, number, number, number][] = [[0, a.length, 0, b.length]];
  while (queue.length) {
    const [alo, ahi, blo, bhi] = queue.pop()!;
    const [i, j, k] = longest(alo, ahi, blo, bhi);
    if (!k) continue;
    blocks.push([i, j, k]);
    if (alo < i && blo < j) queue.push([alo, i, blo, j]);
    if (i + k < ahi && j + k < bhi) queue.push([i + k, ahi, j + k, bhi]);
  }
  return blocks.sort((x, y) => x[0] - y[0]);
}

/** Python difflib.SequenceMatcher(None, a, b).ratio() (no junk: Logan's segments are shorter than autojunk's 200). */
export function seqRatio(a: string, b: string) {
  if (!a.length && !b.length) return 1;
  return (2 * matchingBlocks(a, b).reduce((sum, [, , k]) => sum + k, 0)) / (a.length + b.length);
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

/**
 * 원고 ↔ 받아쓰기 정렬표 (로건 개발 문서 v3 7.2-4): the AI writes cues as the script spells them, the engine finds them in the
 * transcript, which hears some words otherwise (굼떠요 → 군떠요, 지안 씨 → 지한 씨, 세 가지 → 3가지). A cue the transcript does not hold
 * exactly is found in the script, carried over the alignment to the words it was read as, and written as those — only when the engine
 * will then find exactly that place. Scene starts, cue / cue_* keys, [text, cue] pieces and CTA anchors; shown text is never touched.
 */
export function anchorMyinCues(raw: unknown, words: [number, number, string][], speech: string) {
  const changed: string[] = [];
  const S = myinNorm(speech.split("\n").filter((line) => !line.startsWith("#SECTION")).join(""));
  const T = words.map(([, , word]) => myinNorm(word)).join("");
  if (!S || !T || !raw || typeof raw !== "object" || !Array.isArray((raw as { scenes?: unknown }).scenes)) return { storyboard: raw, changed };
  const story = structuredClone(raw) as { scenes: Record<string, unknown>[]; cta?: { after?: unknown }[] };
  const blocks = matchingBlocks(S, T);
  const toT = (si: number) => {
    let pe = 0, te = 0;
    for (const [i, j, k] of blocks) {
      if (si < i) return te + Math.round((si - pe) * (j - te) / Math.max(1, i - pe));
      if (si < i + k) return j + si - i;
      pe = i + k; te = j + k;
    }
    return Math.min(T.length, te + si - pe);
  };
  const fix = (phrase: string, tpos: number, spos: number, limit: number, label: string) => {
    const p = myinNorm(phrase);
    const exact = p ? T.indexOf(p, tpos) : -1;
    if (!p || (exact >= 0 && exact <= tpos + limit)) return phrase;
    const s0 = S.indexOf(p, spos);
    if (s0 < 0) return phrase;
    const t0 = toT(s0), cand = T.slice(t0, toT(s0 + p.length));
    if (!cand || cand.length * 2 < p.length || cand.length > p.length * 2 || T.indexOf(cand, tpos) !== t0 || t0 > tpos + limit) return phrase;
    changed.push(`${label} 「${phrase}」 → 받아쓰기 「${cand}」`);
    return cand;
  };
  let pos = 0, spos = 0;
  story.scenes.forEach((sc, n) => {
    if (sc.at_time !== undefined || typeof sc.at !== "string") return;
    const at = sc.at;
    sc.at = fix(at, pos, spos, 2500, `[장면 ${n + 1}] 시작 문구`);
    const scp = T.indexOf(myinNorm(String(sc.at)), pos);
    const sp = S.indexOf(myinNorm(at), spos);
    const tStart = scp >= 0 && scp <= pos + 2500 ? scp : pos, sStart = sp >= 0 ? sp : spos;
    const walk = (o: unknown): void => {
      if (Array.isArray(o)) {
        for (const v of o) {
          if (Array.isArray(v) && v.length >= 2 && typeof v[0] === "string" && typeof v[1] === "string") v[1] = fix(v[1], tStart, sStart, 1400, `[장면 ${n + 1}] 문구`);
          else walk(v);
        }
      } else if (o && typeof o === "object") {
        const obj = o as Record<string, unknown>;
        for (const [k, v] of Object.entries(obj)) {
          if ((k === "cue" || k.startsWith("cue_")) && typeof v === "string") obj[k] = fix(v, tStart, sStart, 1400, `[장면 ${n + 1}] 문구`);
          else if (k !== "at") walk(v);
        }
      }
    };
    walk(sc);
    pos = tStart + 1; spos = sStart + 1;
  });
  (story.cta ?? []).forEach((cta, k) => { if (typeof cta.after === "string") cta.after = fix(cta.after, 0, 0, 400_000, `[구독 ${k + 1}] after 문구`); });
  return { storyboard: story as unknown, changed };
}

/** When each scene starts (seconds), found the way resolve() finds its at; at_time scenes keep theirs, an unfound one is null. */
export function myinSceneStarts(scenes: { at?: unknown; at_time?: unknown }[], words: [number, number, string][]) {
  const lookup = finder(words);
  const offsets: number[] = [];
  let length = 0;
  for (const [, , word] of words) { offsets.push(length); length += myinNorm(word).length; }
  let pos = 0;
  return scenes.map((sc) => {
    if (typeof sc.at_time === "number") return sc.at_time;
    const hit = lookup(String(sc.at ?? ""), pos, 2500);
    pos = (hit?.at ?? pos) + 1;
    if (!hit) return null;
    let k = 0;
    while (k + 1 < offsets.length && offsets[k + 1] <= hit.at) k++;
    return words[k]?.[0] ?? 0;
  });
}

/** Shape and cue problems as a list the staff AI can fix (empty = passes), plus notes for Logan that do not block.
 *  catalogTypes: the lib_ diagrams the render PC reported (도식 창고); they count as known types. */
const FRAME_TYPES = new Set(["opening", "outro", "summary", "endscreen", "site_ad"]);
// ── 덱 배치 기준 v2 (2026-11-10 request; replaces the 10-23 「본문 절반 이상 도식 · 이미지」 share, which split scenes per sentence to fill it).
// Checked on a new storyboard from the staff AI or GPT only: storyboards made before it (editor saves of older runs) have no beat or why. ──
/** Text a diagram prints when its field is left empty (도식 뜻 관계표 「고정 글자 … 기본」), which the script never says. */
const DEFAULT_TEXT: Record<string, [string, string][]> = {
  lib_row_contrast: [["a_cap", "흔한 생각"], ["b_cap", "진짜 답"]], lib_col_contrast: [["a_cap", "겉"], ["b_cap", "속"]],
  lib_question_typing: [["button", "검색"]], lib_receipt: [["title", "RECEIPT"], ["total_label", "TOTAL"]], lib_gauge: [["left", "E"], ["right", "F"]],
  lib_scale_compare: [["ratio", "×365"]], lib_apple_fall: [["sky_label", "재능?"]], lib_apple: [["sky_label", "재능?"], ["root_label", "결핍"], ["fruit_label", "강점"]],
  lib_toggle_switch: [["on_word", "ON"], ["off_word", "OFF"]], lib_decision_tree: [["yes_word", "예"], ["no_word", "아니오"]],
  lib_big_number: [["tag", "예시"]], lib_donut_ratio: [["tag", "예시"]], lib_stage_split: [["names", "지현 · 도윤"]],
  lib_stage_calendar: [["month", "11월"]], lib_desk_calendar: [["month", "11월"]], lib_seed_grow: [["now_word", "지금"]],
};
/** Drawn with an arrow, an A→B curve or a struck-out side (도식 뜻 관계표): they read as change or correction, never as a plain contrast. */
const ARROWED = new Set(["lib_two_cards", "lib_fusion", "lib_apple_fall", "lib_apple", "lib_cross_out", "lib_swap_places", "lib_dominoes", "lib_loop_break",
  "lib_route_map", "lib_row_contrast", "lib_col_contrast", "lib_button_press", "lib_connect", "lib_before_after", "lib_strike_list", "lib_text_reveal", "lib_one_letter"]);
const filled = (value: unknown) => typeof value === "string" ? value.trim() !== "" : Array.isArray(value) ? value.length > 0 : value !== undefined && value !== null;
/** One screen, for 「같은 화면이 되돌아옴」: the same photo, or the same diagram with the same label. */
const screenKey = (sc: Record<string, unknown>) => {
  const photo = sc.photo as { file?: unknown } | undefined;
  if (photo?.file) return `photo:${String(photo.file)}`;
  const type = String(sc.type);
  return type.startsWith("lib_") || MYIN_METAPHOR_TYPES.includes(type) ? `${type}:${String(sc.label ?? "")}` : null;
};
export function myinDeckIssues(scenes: Record<string, unknown>[]) {
  const issues: string[] = [];
  const body = scenes.map((sc, n) => ({ sc, n })).filter(({ sc }) => !FRAME_TYPES.has(String(sc.type)));
  let beat = 0;
  for (const { sc, n } of body) {
    const where = `[장면 ${n + 1}]`;
    if (!(Number.isInteger(sc.beat) && (sc.beat as number) >= 1)) issues.push(`${where} "beat"(비트 번호, 1부터)를 적어 주세요.`);
    else if ((sc.beat as number) < beat) issues.push(`${where} beat ${sc.beat}가 앞 장면(${beat})보다 작아요 — 비트 번호는 줄지 않게 적어요.`);
    else beat = sc.beat as number;
    if (typeof sc.why !== "string" || !sc.why.trim()) issues.push(`${where} "why"(원고 관계 → 고른 화면 → 이유)를 적어 주세요.`);
    else if (ARROWED.has(String(sc.type)) && /대조/.test(sc.why.split("→")[0]) && !/교정|바뀜/.test(sc.why.split("→")[0]))
      issues.push(`${where} why가 「대조」인데 ${sc.type}는 화살표 · 지움이 그려지는 도식이에요 — 방향 없는 대조는 lib_vs_pick · lib_stage_split 등으로(도식 뜻 관계표).`);
    for (const [field, text] of DEFAULT_TEXT[String(sc.type)] ?? [])
      if (!filled(sc[field])) issues.push(`${where} ${sc.type}의 ${field}가 비어 있어 원고에 없는 「${text}」가 떠요 — 원고 말로 채우거나 다른 도식으로 바꿔 주세요.`);
  }
  for (let i = 2; i < scenes.length; i++) {
    const a = screenKey(scenes[i - 2]), b = screenKey(scenes[i - 1]);
    if (a && a === screenKey(scenes[i]) && b !== a) issues.push(`[장면 ${i - 1} → ${i} → ${i + 1}] 같은 화면이 한 장면 건너 되돌아와요 — 가운데 장면을 그 화면 위에 더하거나 순서를 바꿔 주세요.`);
  }
  return issues;
}
/**
 * Logan's puzzle (v13 기본 도식): pieces of ≤ 4 letters and a word under them of ≤ 4 letters that must be set — left empty,
 * the engine shows his sample video's 「조건」 (로건 피드백 A-10).
 */
function puzzleIssues(scenes: { type: string; pieces?: unknown; word?: unknown }[]) {
  const issues: string[] = [];
  const letters = (value: unknown) => String(value ?? "").replace(/\s/g, "").length;
  scenes.forEach((sc, index) => {
    if (sc.type !== "puzzle") return;
    const where = `[장면 ${index + 1}] 퍼즐`;
    if (!letters(sc.word)) issues.push(`${where}: 조각 아래 단어(word, 4자 이하)를 꼭 씁니다. 비우면 「조건」이 그대로 떠요.`);
    else if (letters(sc.word) > 4) issues.push(`${where}: word 「${sc.word}」는 4자 이하로 줄여 주세요.`);
    for (const piece of Array.isArray(sc.pieces) ? sc.pieces as { text?: unknown }[] : [])
      if (letters(piece?.text) > 4) issues.push(`${where}: 조각 「${piece.text}」는 4자 이하로 줄여 주세요.`);
  });
  return issues;
}
/**
 * What Logan's drawers read with no fallback (s_<type> in myin_engine.py · myin_metaphors.py, and render_myin's scale timing):
 * a scene without one stops 자료 준비 with KeyError. 2026-10-28: a scale scene with a label but no title failed it six times.
 */
const SCENE_NEEDS: Record<string, string[]> = {
  bars: ["title"], bigcircle: ["title"], hero: ["title"], layers: ["title"], list: ["title"], people: ["title"], profiles: ["title"],
  steps: ["title"], summary: ["title", "points"], versus: ["title", "left", "right"], scale: ["title", "left", "right", "cue_tilt"],
};
function sceneFieldIssues(scenes: Record<string, unknown>[]) {
  return scenes.flatMap((sc, index) => (SCENE_NEEDS[String(sc.type)] ?? []).filter((key) => sc[key] === undefined || sc[key] === null || sc[key] === "")
    .map((key) => `[장면 ${index + 1}] ${sc.type}: ${key} 칸이 비었어요. 비우면 렌더 PC가 이 장면을 그리지 못하고 멈춰요.`));
}
// ── 로건 「마이인 기획표 QA 기준 v1」 3부 (2026-10-27): what any AI's storyboard must pass, from the 연봉 video's QA. ──
type Piece = { text: string; cue?: string };
/** Text pieces of a field: [text, cue, style?] arrays and { text, cue } objects, at any depth (title → lines → pieces). */
function textPieces(value: unknown): Piece[] {
  if (Array.isArray(value)) {
    if (typeof value[0] === "string" && typeof value[1] === "string") return value[0].trim() ? [{ text: value[0], cue: value[1] }] : [];
    return value.flatMap(textPieces);
  }
  if (value && typeof value === "object") {
    const o = value as { text?: unknown; cue?: unknown };
    return typeof o.text === "string" && o.text.trim() ? [{ text: o.text, cue: typeof o.cue === "string" ? o.cue : undefined }] : [];
  }
  return [];
}
/** Where each scene starts in the transcription, the way myinCueMisses (and Logan's resolve()) walks it. */
function sceneStarts(story: MyinStoryboard, find: ReturnType<typeof finder>) {
  let pos = 0;
  return story.scenes.map((sc) => {
    if (sc.at_time !== undefined) return pos;
    const start = find(String(sc.at), pos, 2500)?.at ?? pos;
    pos = start + 1;
    return start;
  });
}
// Top to bottom on screen: the title lines, chip, source, subtitle, row list, quote author, tag.
const SCREEN_ORDER: [string, string][] = [["title", "제목"], ["lines", "제목"], ["q", "제목"], ["chip", "칩"], ["source", "출처"], ["sub", "소제목"], ["rows", "줄"], ["items", "줄"], ["author", "인용 출처"], ["tag", "꼬리표"]];
/** QA 1: in a scene, nothing lower on the screen appears before what is above it (a piece without a cue shows at the scene start). */
function screenOrderIssues(story: MyinStoryboard, words: [number, number, string][]) {
  const find = finder(words);
  const starts = sceneStarts(story, find);
  const issues: string[] = [];
  story.scenes.forEach((sc, n) => {
    if (sc.type === "opening" || sc.at_time !== undefined) return;
    const shown = SCREEN_ORDER.flatMap(([key, name]) => textPieces((sc as Record<string, unknown>)[key])
      .map((piece) => ({ name, text: piece.text.trim(), at: piece.cue ? find(piece.cue, starts[n], 1400)?.at ?? null : starts[n] })))
      .filter((item): item is { name: string; text: string; at: number } => item.at !== null);
    let top = shown[0];
    for (const item of shown.slice(1)) {
      if (top && item.at < top.at) { issues.push(`[장면 ${n + 1}] 화면 아래 「${item.text.slice(0, 20)}」(${item.name})가 위 「${top.text.slice(0, 20)}」(${top.name})보다 먼저 떠요 — 위에서 아래 순서로 뜨게 글 배치나 등장 문구를 바꿔요`); return; }
      if (!top || item.at >= top.at) top = item;
    }
  });
  return issues;
}
/** QA 2: before the reel there are no subtitles, so every spoken sentence of the opening gets text on screen. */
export function openingTextIssues(story: MyinStoryboard, words: [number, number, string][], speech: string) {
  const opening = story.scenes[0];
  if (!speech.trim() || opening?.type !== "opening" || story.scenes.length < 2) return [];
  const find = finder(words);
  const [start, end] = sceneStarts(story, find);
  const shown: number[] = [];
  for (const act of ((opening as { acts?: unknown }).acts ?? []) as Record<string, unknown>[]) {
    const actAt = typeof act.cue === "string" ? find(act.cue, start, 2500)?.at ?? null : start;
    for (const [key, value] of Object.entries(act)) {
      if (key === "cue" || key === "image") continue;
      for (const piece of textPieces(value)) { const at = piece.cue ? find(piece.cue, start, 2500)?.at ?? null : actAt; if (at !== null) shown.push(at); }
    }
  }
  const sentences = speech.replace(/\r/g, "").split("\n").filter((line) => line.trim() && !line.startsWith("#SECTION")).join(" ")
    .split(/(?<=[.?!…])\s+/).map((text) => text.trim()).filter((text) => myinNorm(text).length >= 4);
  const issues: string[] = [];
  let cursor = 0;
  const spans: { text: string; at: number }[] = [];
  for (const text of sentences) {
    const at = find(myinNorm(text).slice(0, 10), cursor, 600)?.at;
    if (at === undefined) continue;
    spans.push({ text, at });
    cursor = at + 1;
    if (at >= end) break;
  }
  spans.forEach((span, i) => {
    const next = spans[i + 1]?.at ?? end;
    if (span.at < start || span.at >= end) return;
    if (!shown.some((at) => at >= span.at && at < next)) issues.push(`[오프닝] 「${span.text.slice(0, 24)}」 문장에 화면 글자가 없어요 — 쇼릴 전에는 자막이 없으니 그 문장 첫 말을 cue로 줄 하나를 붙여요`);
  });
  return issues;
}
/** QA 3: a row list with two or more % figures is a chart (bars, donut, big number), not text rows. */
function statListIssues(story: MyinStoryboard) {
  return story.scenes.flatMap((sc, n) => {
    const rows = [...textPieces((sc as Record<string, unknown>).rows), ...textPieces((sc as Record<string, unknown>).items),
      ...(["list", "lib_numbered"].includes(sc.type) ? textPieces((sc as Record<string, unknown>).lines) : [])];
    const figures = rows.reduce((count, piece) => count + (piece.text.match(/\d\s*%/g)?.length ?? 0), 0);
    return figures >= 2 ? [`[장면 ${n + 1}] 줄 목록에 % 수치가 ${figures}개예요 — 수치는 그래프 장면(막대 · 도넛 · 큰 숫자 · 사람 그림)으로 바꾸고 출처를 맨 위 라벨에 둬요`] : [];
  });
}
/** A photo's crop: focus_y (vertical) and, from Logan's engine v15.3 (2026-10-27), focus_x (horizontal) are 0–1. */
function photoFocusIssues(story: MyinStoryboard) {
  return story.scenes.flatMap((sc, n) => {
    const photo = (sc as { photo?: Record<string, unknown> }).photo;
    if (!photo || typeof photo !== "object") return [];
    return (["focus_x", "focus_y"] as const).filter((key) => key in photo && !(typeof photo[key] === "number" && (photo[key] as number) >= 0 && (photo[key] as number) <= 1))
      .map((key) => `[장면 ${n + 1}] photo.${key}는 0~1 사이 숫자예요(0.5 = 가운데)`);
  });
}
/** QA 5: the subscribe line says 「눌러 주세요」, not 「눌러 두고 들어 주세요」. */
const ctaWordingIssues = (story: MyinStoryboard) => story.cta.flatMap((cta, k) => /눌러\s*두/.test(cta.line) ? [`[구독 ${k + 1}] 「눌러 두…」 대신 「눌러 주세요」로 써요`] : []);

/**
 * A stage (lib_stage_) at most twice a video, never twice in a row — but a 나열형 기준 판 brought back for its next item (덱 배치 기준 v2 §4:
 * the same board, its rooms re-added with the same ids) is that one board again, not another use of the stage.
 */
function stageReuseIssues(scenes: Record<string, unknown>[]) {
  const issues: string[] = [];
  const boards = new Map<string, Set<string>>();
  const board = (sc: Record<string, unknown>, index: number) => {
    const ids = [...new Set((Array.isArray(sc.beats) ? sc.beats as { id?: unknown }[] : []).map((beat) => beat?.id).filter((id): id is string => typeof id === "string"))].sort();
    return ids.length ? ids.join(",") : `#${index}`;
  };
  scenes.forEach((sc, index) => {
    const type = String(sc.type);
    if (!type.startsWith("lib_stage_")) return;
    const key = board(sc, index);
    boards.set(type, (boards.get(type) ?? new Set()).add(key));
    const prev = scenes[index - 1];
    if (prev && prev.type === type && board(prev, index - 1) !== key) issues.push(`"${type}" 무대가 ${index}번째와 ${index + 1}번째 장면에 연달아 나와요. 사이에 다른 장면을 넣어 주세요.`);
  });
  for (const [type, keys] of boards) if (keys.size > 2) issues.push(`"${type}" 무대를 ${keys.size}번 썼어요. 같은 무대는 영상당 2번까지예요(같은 기준 판을 되부르는 건 한 번으로 세요).`);
  return issues;
}

// ── 읽을 시간 (수정 요청 2026-11-08 2순위). Eight recent videos (11-01~11-06, 395 timed scenes): screen text came at a median 2.6 and
// a 90th percentile 5.8 characters a second; 0–6 scenes a video went past 8, mostly fast openings and chat screens. A note for the
// person who checks the storyboard, never a stop: no voice, subtitle or scene time is changed. ──
const READ_RATE = 8, READ_MIN = 15;
const NOT_SHOWN = /^(cue.*|at|at_time|type|mood|music|bg|file|image|images|kind|panel|focus.*|slam|size|accent|blue|cup|x|y|w|h|box|top|rowh|credit|link|url|next_video|sound|ambience|gain_db|beat|why|recall|t|t_.*|_.*)$/;
const FLAG = new Set(["accent", "blue", "strike", ""]);
/** The words a scene puts on screen: no cue phrases, file names, links or notes; a title cell [shown, cue, flag] counts its first word. */
function shownWords(value: unknown): string[] {
  if (typeof value === "string") return [value];
  if (Array.isArray(value)) {
    if ((value.length === 2 || (value.length === 3 && FLAG.has(String(value[2])))) && value.every((item) => typeof item === "string")) return [value[0] as string];
    return value.flatMap(shownWords);
  }
  if (value && typeof value === "object") return Object.entries(value).filter(([key]) => !NOT_SHOWN.test(key)).flatMap(([, item]) => shownWords(item));
  return [];
}
const mmss = (seconds: number) => `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, "0")}`;
/** Scenes whose screen text comes faster than READ_RATE characters a second for as long as the scene stays (from the voice). */
export function myinReadingNotes(scenes: Record<string, unknown>[], words: [number, number, string][], end?: number) {
  const starts = myinSceneStarts(scenes, words), last = end ?? words.at(-1)?.[1] ?? 0;
  return scenes.flatMap((scene, index) => {
    const start = starts[index];
    // 한 장 정리 is there to be captured (and held at least 5 s); the end card and the site capture are not read line by line.
    if (start === null || ["summary", "endscreen", "site_ad"].includes(String(scene.type))) return [];
    const seconds = (starts.slice(index + 1).find((value) => value !== null) ?? last) - start;
    if (seconds <= 0.3) return [];        // a 0-second opening placeholder (intro off)
    const chars = myinNorm(shownWords(scene).join("")).length;
    return chars >= READ_MIN && chars / seconds > READ_RATE
      ? [`${index + 1}번 장면 (${mmss(start)}) · 화면 글자 ${chars}자가 ${seconds.toFixed(1)}초 동안 — 1초에 ${Math.round(chars / seconds)}자. 글자를 줄일지, 그대로 둘지 정해 주세요`] : [];
  });
}

export function checkMyinStoryboard(value: unknown, words: [number, number, string][], catalogTypes: readonly string[] = [], speech = "", options: { deck?: boolean } = {}) {
  const parsed = myinStoryboardSchema.safeParse(value);
  if (!parsed.success) return { issues: parsed.error.issues.slice(0, 20).map((issue) => `${issue.path.join(".") || "기획표"}: ${issue.message}`), notes: [] as string[], fuzzy: [] as string[], reading: [] as string[], story: null };
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
  issues.push(...unknown.filter((type) => type.startsWith("lib_")).map((type) => `"${type}"는 영상 만드는 컴퓨터가 그릴 수 없는 도식입니다. 도식 창고 목록에 있는 것으로 바꿔 주세요.`));
  if (options.deck) issues.push(...myinDeckIssues(story.scenes as Record<string, unknown>[]));
  issues.push(...stageReuseIssues(story.scenes as Record<string, unknown>[]), ...puzzleIssues(story.scenes as { type: string; pieces?: unknown; word?: unknown }[]), ...sceneFieldIssues(story.scenes));
  issues.push(...screenOrderIssues(story, words), ...openingTextIssues(story, words, speech), ...statListIssues(story), ...ctaWordingIssues(story), ...photoFocusIssues(story));
  const notes = unknown.filter((type) => !type.startsWith("lib_"))
    .map((type) => `새 장면 종류 "${type}": 로건님 코드에 그리는 방법을 먼저 추가해야 합니다.`);
  return { issues: issues.slice(0, 40), notes, fuzzy: cues.fuzzy, reading: myinReadingNotes(story.scenes as Record<string, unknown>[], words, typeof story.end === "number" ? story.end : undefined), story };
}

/** Where the render PC fetches a storyboard photo, or null when it cannot fetch it by itself. An Unsplash page link is refused:
 * its unsplash.com/…/download address answered the render PC with 429 (2026-10-26, owner chose file links only). */
export function myinPhotoFetchUrl(link: string) {
  let url: URL;
  try { url = new URL(link); } catch { return null; }
  if (url.protocol !== "https:") return null;
  if (url.hostname === "images.unsplash.com" || url.hostname === "upload.wikimedia.org") return link;
  if (url.hostname === "commons.wikimedia.org" && url.pathname.startsWith("/wiki/File:")) return `https://commons.wikimedia.org/wiki/Special:FilePath/${url.pathname.slice("/wiki/File:".length)}`;
  return null;
}

/**
 * The asset folders each photo must sit in for Logan's engine, which reads a scene's `photo.file` from assets/people (side photo and
 * situation card alike) and an opening act's `image` from assets/situations, whatever kind the storyboard gave the photo. A photo
 * filed under its kind alone stopped the v13 preview with FileNotFoundError (2026-10-26).
 */
export function myinPhotoFolders(storyboard: unknown) {
  const folders = new Map<string, ("people" | "situations")[]>();
  const add = (file: unknown, folder: "people" | "situations") => {
    if (typeof file === "string" && !folders.get(file)?.includes(folder)) folders.set(file, [...(folders.get(file) ?? []), folder]);
  };
  const walk = (o: unknown) => {
    if (Array.isArray(o)) o.forEach(walk);
    else if (o && typeof o === "object") for (const [k, v] of Object.entries(o)) {
      if (k === "photo" && v && typeof v === "object") add((v as { file?: unknown }).file, "people");
      else if (k === "image") add(v, "situations");
      else if (k === "broll" && Array.isArray(v)) for (const cut of v) add((cut as { file?: unknown })?.file, "situations");   // 숏폼 사진 컷: 오프닝 사진과 같은 폴더
      walk(v);
    }
  };
  walk(storyboard);
  return folders;
}

/** What the PC that prepares downloads, into each folder the engine reads the file from: the listed photos it may use (③ all, ④ the
 * approved ones) it can fetch, except where staff uploaded our own image of that name (우리 이미지, 2026-10-28), which goes instead. */
export function myinPrepPhotos(folders: Map<string, string[]>, listed: { kind: string; file: string; url: string }[], usable: (file: string) => boolean,
  ours: Record<string, string>) {
  const photos: { kind: string; file: string; url: string }[] = [];
  for (const asset of listed) {
    const url = !ours[asset.file] && usable(asset.file) ? myinPhotoFetchUrl(asset.url) : null;
    // A photo used in both places is sent twice.
    if (url) for (const kind of folders.get(asset.file) ?? [asset.kind]) photos.push({ kind, file: asset.file, url });
  }
  for (const [file, url] of Object.entries(ours)) for (const kind of folders.get(file) ?? []) photos.push({ kind, file, url });
  return photos;
}

/** Logan's engine reads an opening act's `cam.drift` as an [x, y] pair; a staff AI wrote a bare number and the opening clip
 * stopped with TypeError (2026-10-27). A number is the horizontal drift (the engine never drifts vertically), so it becomes [n, 0]. */
export function myinDriftPairs<T extends { scenes: Record<string, unknown>[] }>(story: T) {
  for (const act of story.scenes.flatMap((sc) => (Array.isArray(sc.acts) ? sc.acts : []) as { cam?: { drift?: unknown } }[]))
    if (typeof act?.cam?.drift === "number") act.cam.drift = [act.cam.drift, 0];
  return story;
}

/**
 * A lib_ diagram's {text, cue} slot written as plain words (11-12: a question-typing "q": "…" stopped the engine at ③) is wrapped as the
 * 도식 창고 example has it, cued at the scene's start. Changes the story in place; returns the scene numbers it changed.
 */
export function myinTextPairs(story: { scenes: Record<string, unknown>[] }, examples: Map<string, Record<string, unknown>>) {
  const fixed = new Set<number>();
  story.scenes.forEach((sc, i) => {
    for (const [key, shape] of Object.entries(examples.get(String(sc.type)) ?? {}))
      if (shape && typeof shape === "object" && !Array.isArray(shape) && "text" in shape && typeof sc[key] === "string") {
        sc[key] = { text: sc[key], ...("cue" in shape ? { cue: String(sc.cue ?? sc.at ?? "") } : {}) };
        fixed.add(i + 1);
      }
  });
  return [...fixed];
}

/** ③: Logan's music match (music_match.py) changed only the sound — its storyboard and ours agree without the sound fields. It got ours
 * with drift pairs, and it also sets an ambience's offset, variation and level (amb_off · amb_var · amb_db, 2026-10-28 유쓰·로건). */
export function myinOnlySoundChanged(matched: { scenes?: unknown }, ours: { scenes: Record<string, unknown>[] }) {
  const skip = [...SOUND_FIELDS, "amb_off", "amb_var", "amb_db"];
  const bare = (story: { scenes?: unknown }) => JSON.stringify((Array.isArray(story.scenes) ? story.scenes as Record<string, unknown>[] : []).map((sc) =>
    Object.fromEntries(Object.entries(sc).filter(([k]) => !skip.includes(k)))));
  return bare(matched) === bare(myinDriftPairs(JSON.parse(JSON.stringify(ours))));
}

// ── 사운드 창고 (로건 2026-10-27): 장면의 "music" {key, start} · "amb" · "sfx" [{cue, key}]. ③ 시안 준비 때 렌더 PC가 로건님 자동 선곡
// (music_match.py)으로 적고, ④ 자료 준비에서 사람이 고친다(2026-10-27 대표). 곡은 그 장면부터 다음 "music"까지 깔린다. ──
export type MyinSoundPlan = {
  music: { scene: number; key: string; start?: number }[];
  amb: { scene: number; key: string; dur?: number; cue?: string; cueEnd?: string }[];
  sfx: { scene: number; cue: string; key: string }[];
};
export type MyinSoundItem = { kind: "music" | "sfx" | "amb"; key: string; title: string; note?: string };
const SOUND_FIELDS = ["music", "music_start", "amb", "amb_dur", "cue_amb", "cue_amb_end", "sfx"];
const num = (value: unknown) => typeof value === "number" && Number.isFinite(value) ? value : undefined;

/** The sound plan as the storyboard has it (scene numbers from 1). An old 「C1」 cue-sheet name reads as its name. */
export function myinSoundPlan(story: { scenes: Record<string, unknown>[] }): MyinSoundPlan {
  const plan: MyinSoundPlan = { music: [], amb: [], sfx: [] };
  story.scenes.forEach((sc, n) => {
    const scene = n + 1, m = sc.music as unknown;
    if (typeof m === "string" && m) plan.music.push({ scene, key: m, start: num(sc.music_start) });
    else if (m && typeof m === "object" && typeof (m as { key?: unknown }).key === "string") plan.music.push({ scene, key: (m as { key: string }).key, start: num((m as { start?: unknown }).start) });
    if (typeof sc.amb === "string" && sc.amb) plan.amb.push({ scene, key: sc.amb, dur: num(sc.amb_dur),
      cue: typeof sc.cue_amb === "string" ? sc.cue_amb : undefined, cueEnd: typeof sc.cue_amb_end === "string" ? sc.cue_amb_end : undefined });
    for (const fx of Array.isArray(sc.sfx) ? sc.sfx as { cue?: unknown; key?: unknown }[] : [])
      if (typeof fx?.cue === "string" && typeof fx.key === "string") plan.sfx.push({ scene, cue: fx.cue, key: fx.key });
  });
  return plan;
}

/** The storyboard with its sound fields replaced by `plan` (the ④ editor sends the whole plan); every other field stays as written. */
export function applyMyinSoundPlan<T extends { scenes: Record<string, unknown>[]; music_cues?: unknown }>(story: T, plan: MyinSoundPlan): T {
  const next = JSON.parse(JSON.stringify(story)) as T;
  const legacy = (key: string) => Boolean(next.music_cues && typeof next.music_cues === "object" && key in (next.music_cues as object));
  for (const sc of next.scenes) for (const field of SOUND_FIELDS) delete sc[field];
  const at = (scene: number) => next.scenes[scene - 1];
  for (const m of plan.music) if (at(m.scene)) at(m.scene).music = legacy(m.key) && m.start === undefined ? m.key : { key: m.key, ...(m.start === undefined ? {} : { start: m.start }) };
  for (const a of plan.amb) if (at(a.scene)) Object.assign(at(a.scene), { amb: a.key }, a.dur === undefined ? {} : { amb_dur: a.dur },
    a.cue ? { cue_amb: a.cue } : {}, a.cueEnd ? { cue_amb_end: a.cueEnd } : {});
  for (const fx of plan.sfx) if (at(fx.scene)) at(fx.scene).sfx = [...((at(fx.scene).sfx as unknown[]) ?? []), { cue: fx.cue, key: fx.key }];
  return next;
}

/** What would stop or silently drop a sound: a key the render PC does not have, an effect line not in the transcription after its scene start. */
export function myinSoundIssues(story: MyinStoryboard, words: [number, number, string][], catalog: MyinSoundItem[] | null) {
  const plan = myinSoundPlan(story);
  const has = (kind: MyinSoundItem["kind"], key: string) => !catalog || catalog.some((item) => item.kind === kind && item.key === key);
  const legacy = (key: string) => Boolean(story.music_cues && key in story.music_cues);
  const find = finder(words); const starts = sceneStarts(story, find);
  const issues: string[] = [];
  for (const m of plan.music) {
    if (!legacy(m.key) && !has("music", m.key)) issues.push(`[장면 ${m.scene}] 음악 키 「${m.key}」가 영상 만드는 컴퓨터의 사운드 창고에 없어요`);
    if (m.start !== undefined && m.start < 0) issues.push(`[장면 ${m.scene}] 음악 시작점은 0초 이상이에요`);
  }
  for (const a of plan.amb) {
    if (!has("amb", a.key)) issues.push(`[장면 ${a.scene}] 앰비언스 키 「${a.key}」가 사운드 창고에 없어요`);
    if (a.dur !== undefined && a.dur <= 0) issues.push(`[장면 ${a.scene}] 앰비언스 길이는 0초보다 길어야 해요`);
  }
  for (const fx of plan.sfx) {
    if (!has("sfx", fx.key)) issues.push(`[장면 ${fx.scene}] 효과음 키 「${fx.key}」가 사운드 창고에 없어요`);
    if (!find(fx.cue, starts[fx.scene - 1] ?? 0, 1400)) issues.push(`[장면 ${fx.scene}] 효과음 문구 「${fx.cue}」를 그 장면 뒤 받아쓰기에서 못 찾았어요`);
  }
  return issues;
}

/** The credits block appended to the YouTube description: the run's credit lines without the render PC's file names. */
export function myinCreditsBlock(credits: string[]) {
  const lines = credits.map((line) => line.replace(/^\S+\s+—\s+/, "").replace(/[<>]/g, "").trim()).filter(Boolean);
  return lines.length ? `\n\n사진·음악 출처\n${lines.map((line) => `- ${line}`).join("\n")}` : "";
}
