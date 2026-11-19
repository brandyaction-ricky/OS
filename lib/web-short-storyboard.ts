// 웹 숏폼 기획표 (2026-11-19, 「롱폼 재활용 숏폼 정본」 §3~§8 편집 스타일): the staff AI picks scene templates of the web short renderer
// (tools/web-short/engine.js) and writes every moment as a phrase of the transcript, the way it writes cues for the longform. The OS checks
// the slots and letter limits, finds each phrase in the words and hands the renderer seconds; the subtitles are the AI's one-line cuts of the
// script, timed by aligning the script with the transcript. Layout problems the letter limits miss are caught again by the page's own check.
import { matchingBlocks, myinCueFinder, myinNorm } from "./myin-storyboard.ts";
import { shortLineWidth } from "./myin-short-storyboard.ts";

type Words = [number, number, string][];
type F = { opt?: boolean } & ({ k: "text"; max: number } | { k: "cue" } | { k: "photo" } | { k: "enum"; of: readonly (string | number | boolean)[] }
  | { k: "obj"; f: Record<string, F> } | { k: "list"; min: number; max: number; item: F });
const text = (max: number, opt = false): F => ({ k: "text", max, opt });
const cue = (opt = false): F => ({ k: "cue", opt });
const photo: F = { k: "photo" };
const obj = (f: Record<string, F>, opt = false): F => ({ k: "obj", f, opt });
const list = (min: number, max: number, item: F, opt = false): F => ({ k: "list", min, max, item, opt });
const oneOf = (of: readonly (string | number | boolean)[]): F => ({ k: "enum", of, opt: true });

/** The renderer's scene templates as the staff AI fills them. Letter limits keep each text inside its box at the theme's sizes. */
export const WEB_SHORT_SCENES: Record<string, { name: string; use: string; f: Record<string, F> }> = {
  opening: { name: "첫 화면", use: "첫 장면 하나만. 사진 위에 헤드 카피가 크게 뜨고, 다음 장면부터 화면 맨 위 두 줄로 끝까지 남아요.", f: { photo } },
  photo: { name: "상황 사진", use: "[장면] 줄. 그 상황 사진이 화면을 채우고 천천히 움직여요. 사람이 처음 나오면 persona(인물 카드), 장소 · 상황 꼬리표는 tape, 차례로 일어나는 일은 steps를 얹어요. 아무것도 얹지 않은 사진만도 좋아요. enter/exit \"whip\" = 휙 밀고 들어옴/위로 휙 빠짐.",
    f: { photo, persona: obj({ name: text(6), desc: text(12), cue: cue() }, true), tape: obj({ lines: list(1, 2, text(9)), accent: oneOf([0, 1]), cue: cue() }, true),
      steps: list(2, 3, obj({ text: text(8), cue: cue() }), true), enter: oneOf(["whip"]), exit: oneOf(["whip"]) } },
  react: { name: "자극과 두 반응", use: "[관계] 줄. 한 자극(stimulus)에 얼굴이 바뀌고, 한 사람(a)은 알아채고(시선이 그어짐) 다른 사람들(b)은 못 봐요. 이어서 그 사람이 가운데로 와서 준비한 말이 반으로 줄거나(bubble) 막대가 끝까지 몰려 「끝」 도장이 찍히는(progress) 데까지 한 카드에서 이어져요.",
    f: { photo, stimulus: obj({ label: text(6), cue: cue(), cue_change: cue() }), a: obj({ label: text(6), cue: cue() }), b: obj({ label: text(4), cue: cue(), cue_close: cue(true), cue_dim: cue(true) }),
      bubble: obj({ label: text(8), cue: cue(), cue_move: cue(true), cue_lines: cue(true), cue_shrink: cue(true) }, true),
      progress: obj({ label: text(8), cue: cue(), cue_fill: cue(), cue_stamp: cue(true), stamp: text(2, true) }, true) } },
  messenger: { name: "메신저", use: "[목록] 메시지 줄. 메시지마다 말하는 동안 글자가 쳐지고(cue = 그 메시지를 말하는 문구 전체), cue_del에서 지워지거나 cue_send에서 보내져요.",
    f: { photo, name: text(8), messages: list(1, 3, obj({ text: text(24), cue: cue(), cue_del: cue(true), cue_send: cue(true) })), cue_pulse: cue(true) } },
  list: { name: "목록 카드", use: "[목록] 줄. 항목이 말할 때마다 체크와 함께 하나씩 나와요. pick(0부터)을 쓰면 cue_pick에서 그 항목만 밝아지고 나머지는 흐려져요.",
    f: { photo, title: text(12, true), items: list(2, 4, obj({ text: text(12), cue: cue() })), pick: oneOf([0, 1, 2, 3]), cue_pick: cue(true) } },
  compare: { name: "비교 카드", use: "[관계] 비교 · 전후 줄. 두 칸이 말할 때마다 뒤집혀 나와요. arrow true = 가운데 화살표(전→후), 아니면 vs. pick(0 왼쪽, 1 오른쪽)을 쓰면 cue_pick에서 그 칸이 채워지고 다른 칸은 흐려져요.",
    f: { photo, a: obj({ label: text(6), text: text(8), cue: cue() }), b: obj({ label: text(6), text: text(8), cue: cue() }), arrow: oneOf([true, false]), pick: oneOf([0, 1]), cue_pick: cue(true) } },
  clock: { name: "시간이 흐름", use: "시간이 지나가는 줄. 사진 위에서 시계 바늘이 빠르게 돌고, label(큰 글자 4자까지)이 cue_label에 튀어나와요.",
    f: { photo, label: text(4, true), cue_label: cue(true), cue_spin: cue(true) } },
  spotlight: { name: "한 곳 비추기", use: "[장면] 줄. 사진의 한 사람 · 한 곳에 조명이 좁혀져요(cue_focus). 그 사진 가운데에 비출 대상이 있는 사진을 골라요.", f: { photo, cue_focus: cue(true) } },
  push: { name: "빠르게 다가가기", use: "[장면] 강조 줄. 사진으로 확 다가가며 속도선이 지나가요(cue_push).", f: { photo, cue_push: cue(true) } },
  vignette: { name: "천천히 어두워짐", use: "[장면] 무거운 줄. 사진에 천천히 다가가며 가장자리가 어두워져요(cue_dark).", f: { photo, cue_dark: cue(true) } },
  split: { name: "위아래 두 사진", use: "앞에서 나온 두 장면을 다시 묶는 줄(정리). 위 사진, 아래 사진이 차례로 들어와요.", f: { top: obj({ photo, cue: cue() }), bottom: obj({ photo, cue: cue() }) } },
  endcard: { name: "마지막 행동 카드", use: "광고 숏폼의 마지막 장면(꼭 하나). 상품 이름(name), 한 줄 설명(line), 할 행동 버튼(button)이 사진 위 카드로 뜨고 버튼이 계속 살짝 뛰어요.",
    f: { photo, name: text(10), line: text(16, true), button: text(10), cue_button: cue(true) } },
};

/** Subtitles (정본 §3): one line, at most 14 letters without spaces. Title lines must fit 960 px at 96 px (1080 minus 60 px each side). */
export const WEB_SUB_MAX = 14;
const TITLE_SIZE = 96, TITLE_MAX_PX = 960;
const SCENE_MIN_SECONDS = 0.7;
const letters = (s: string) => s.replace(/\s/g, "").length;

/** The slots of one template as the card lists them: "persona.name ≤ 6자 · steps 2~3개 · steps.text ≤ 8자 · cue_pulse(선택)". */
function limits(f: Record<string, F>, path = ""): string[] {
  return Object.entries(f).flatMap(([key, spec]) => {
    const at = path ? `${path}.${key}` : key, opt = spec.opt ? "(선택)" : "";
    if (spec.k === "text") return [`${at} ≤ ${spec.max}자${opt}`];
    if (spec.k === "cue" || spec.k === "photo") return [`${at}${opt}`];
    if (spec.k === "enum") return [`${at}: ${spec.of.join("|")}${opt}`];
    if (spec.k === "obj") return [...(opt ? [`${at}${opt}`] : []), ...limits(spec.f, at)];
    return [`${at} ${spec.min}~${spec.max}개${opt}`, ...(spec.item.k === "obj" ? limits(spec.item.f, at) : spec.item.k === "text" ? [`${at} 한 줄 ≤ ${spec.item.max}자`] : [])];
  });
}
export const webShortSceneList = () => Object.entries(WEB_SHORT_SCENES).map(([type, s]) => `- ${type} (${s.name}): ${limits(s.f).join(" · ")} — ${s.use}`).join("\n");

function slotIssues(f: Record<string, F>, value: Record<string, unknown>, where: string, path = ""): string[] {
  const out: string[] = [];
  for (const key of Object.keys(value)) if (!(key in f) && !(path === "" && (key === "type" || key === "at"))) out.push(`${where} ${path}${key}: 이 장면에는 없는 칸이에요.`);
  for (const [key, spec] of Object.entries(f)) {
    const v = value[key], at = `${path}${key}`;
    if (v === undefined || v === null) { if (!spec.opt) out.push(`${where} ${at} 칸이 없어요.`); continue; }
    if (spec.k === "text" && !(typeof v === "string" && v.trim())) out.push(`${where} ${at}는 글자예요.`);
    else if (spec.k === "text" && letters(v as string) > spec.max) out.push(`${where} ${at} 「${v}」은 ${spec.max}자 이하로 줄여요(띄어쓰기 빼고).`);
    else if ((spec.k === "cue" || spec.k === "photo") && !(typeof v === "string" && v.trim())) out.push(`${where} ${at}는 ${spec.k === "cue" ? "받아쓰기 문구" : "사진 파일 이름"}예요.`);
    else if (spec.k === "photo" && /[/\\]/.test(v as string)) out.push(`${where} ${at}는 파일 이름만 써요(경로 없이).`);
    else if (spec.k === "enum" && !spec.of.includes(v as string)) out.push(`${where} ${at}는 ${spec.of.join(" · ")} 중 하나예요.`);
    else if (spec.k === "obj") { if (typeof v === "object" && !Array.isArray(v)) out.push(...slotIssues(spec.f, v as Record<string, unknown>, where, `${at}.`)); else out.push(`${where} ${at}는 { } 묶음이에요.`); }
    else if (spec.k === "list") {
      if (!Array.isArray(v) || v.length < spec.min || v.length > spec.max) out.push(`${where} ${at}는 ${spec.min}~${spec.max}개예요.`);
      else v.forEach((item, i) => spec.item.k === "obj" ? (item && typeof item === "object" ? out.push(...slotIssues(spec.item.f, item as Record<string, unknown>, where, `${at}.${i}.`)) : out.push(`${where} ${at}.${i}는 { } 묶음이에요.`))
        : out.push(...slotIssues({ x: spec.item }, { x: item }, where, `${at}.${i}`).map((s) => s.replace(`${at}.${i}x`, `${at}.${i}`))));
    }
  }
  return out;
}

/** Character offsets of each word in the normalised transcript, and a lookup from an offset to its word. */
function wordIndex(words: Words) {
  const offsets: number[] = [];
  let length = 0;
  for (const [, , word] of words) { offsets.push(length); length += myinNorm(word).length; }
  const at = (char: number) => { let lo = 0, hi = offsets.length - 1; while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (offsets[mid] <= char) lo = mid; else hi = mid - 1; } return lo; };
  return { at, length };
}
const camelAt = (key: string) => `${key.slice(4).replace(/_(\w)/g, (_, c: string) => c.toUpperCase())}At`;
const round = (n: number) => Math.round(n * 100) / 100;

/**
 * The 웹 숏폼 storyboard as the renderer takes it (seconds, subtitles timed), or the problems for the staff AI. ad: the last scene is the
 * endcard (and only an ad has one). script: the spoken script the subtitles must cover, in order, letter for letter.
 */
export function checkWebShort(value: unknown, input: { words: Words; script: string; headCopy: string; durationSeconds: number; ad: boolean }) {
  const issues: string[] = [], notes: string[] = [], fuzzy: string[] = [];
  const raw = value && typeof value === "object" ? value as Record<string, unknown> : {};
  // title: the confirmed head copy in one or two lines, an optional accent inside one line
  const title = raw.title && typeof raw.title === "object" ? raw.title as { lines?: unknown; accent?: unknown } : {};
  const lines = Array.isArray(title.lines) && title.lines.every((l) => typeof l === "string" && l.trim()) ? title.lines as string[] : [];
  const accent = typeof title.accent === "string" ? title.accent.trim() : "";
  if (lines.length < 1 || lines.length > 2) issues.push("title.lines는 헤드 카피를 1~2줄로 나눈 글자예요.");
  else if (myinNorm(lines.join("")) !== myinNorm(input.headCopy)) issues.push(`title.lines는 확정한 헤드 카피 「${input.headCopy}」 그대로예요(줄 나눔만 자유, 지금 「${lines.join(" / ")}」).`);
  for (const line of lines) if (shortLineWidth(line, TITLE_SIZE) > TITLE_MAX_PX) issues.push(`title 줄 「${line}」이 화면보다 넓어요 — 줄을 다시 나눠요(한 줄 11자 안팎).`);
  if (accent && !lines.some((l) => l.includes(accent))) issues.push(`title.accent 「${accent}」는 한 줄 안에 그대로 있는 말이에요.`);

  const scenes = (Array.isArray(raw.scenes) ? raw.scenes : []).filter((sc): sc is Record<string, unknown> => Boolean(sc) && typeof sc === "object");
  if (scenes.length < 3 || scenes.length > 30) issues.push(`장면은 3~30개예요(지금 ${scenes.length}개).`);
  scenes.forEach((sc, n) => {
    const where = `[장면 ${n + 1}]`, spec = WEB_SHORT_SCENES[String(sc.type)];
    if (!spec) { issues.push(`${where} "${String(sc.type)}"는 없는 장면 종류예요. 목록에 있는 것만 써요.`); return; }
    if (typeof sc.at !== "string" || !sc.at.trim()) issues.push(`${where} at(시작 문구)이 없어요.`);
    if (sc.type === "opening" && n > 0) issues.push(`${where} opening은 첫 장면에만 써요. 큰 글자는 첫 화면 제목뿐이에요.`);
    if (sc.type === "endcard" && (!input.ad || n !== scenes.length - 1)) issues.push(`${where} endcard는 광고 숏폼의 마지막 장면에만 써요.`);
    issues.push(...slotIssues(spec.f, sc, where));
  });
  if (scenes.length && scenes[0].type !== "opening") issues.push("첫 장면은 opening이에요.");
  if (input.ad && scenes.length && scenes.at(-1)!.type !== "endcard") issues.push("광고 숏폼의 마지막 장면은 endcard(마지막 행동 카드)예요.");

  const subs = Array.isArray(raw.subtitles) && raw.subtitles.every((s) => typeof s === "string" && s.trim()) ? (raw.subtitles as string[]).map((s) => s.trim()) : [];
  if (!subs.length) issues.push("subtitles는 대본을 의미 단위로 끊은 한 줄 자막 목록이에요.");
  for (const s of subs) if (letters(s) > WEB_SUB_MAX) issues.push(`자막 「${s}」은 ${WEB_SUB_MAX}자 이하로 끊어요(띄어쓰기 빼고).`);
  const script = myinNorm(input.script), joined = myinNorm(subs.join(""));
  if (subs.length && joined !== script) {
    let i = 0; while (i < script.length && script[i] === joined[i]) i++;
    issues.push(`자막을 이으면 대본과 같아야 해요(빠지거나 바뀐 말 없이). 처음 달라지는 곳: 대본 「…${script.slice(Math.max(0, i - 6), i + 8)}…」 / 자막 「…${joined.slice(Math.max(0, i - 6), i + 8)}…」`);
  }
  if (issues.length) return { issues: issues.slice(0, 40), story: null, notes, fuzzy };

  // every phrase → seconds: scene starts in order, the rest within its scene (the longform cue rules: 2,500 / 1,400 letters)
  const find = myinCueFinder(input.words), idx = wordIndex(input.words);
  const span = (phrase: string, pos: number, limit: number, where: string) => {
    const hit = find(phrase, pos, limit);
    if (!hit) { issues.push(`${where} 문구 못 찾음: ${phrase}`); return null; }
    if (hit.fuzzy) fuzzy.push(`${where} ${phrase}`);
    const last = idx.at(Math.min(idx.length - 1, hit.at + Math.max(1, myinNorm(phrase).length) - 1));
    return { char: hit.at, from: input.words[idx.at(hit.at)][0], to: input.words[last][1] };
  };
  let pos = 0;
  const starts = scenes.map((sc, n) => { const s = span(String(sc.at), pos, 2500, `[장면 ${n + 1}]`); if (s) pos = s.char + 1; return s; });
  const out = scenes.map((sc, n) => {
    const start = starts[n], where = `[장면 ${n + 1}]`;
    const from = n === 0 ? 0 : start?.from ?? 0, to = starts.slice(n + 1).find(Boolean)?.from ?? input.durationSeconds;
    const timed = (o: unknown): unknown => {
      if (Array.isArray(o)) return o.map(timed);
      if (!o || typeof o !== "object") return o;
      const r: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(o)) {
        if ((k === "cue" || k.startsWith("cue_")) && typeof v === "string") {
          const s = span(v, start?.char ?? 0, 1400, where);
          if (s && (s.from < from - 0.3 || s.from > to)) issues.push(`${where} 「${v}」는 이 장면 밖에서 나오는 말이에요. 이 장면 시작 문구와 다음 장면 시작 문구 사이의 말로 써요.`);
          else if (s && n < scenes.length - 1 && s.from > to - 0.3) issues.push(`${where} 「${v}」는 장면이 넘어가는 순간의 말이라 보이지 않아요. 이 장면 안의 더 앞 말로 써요.`);
          if (k === "cue") { r.at = round(s?.from ?? from); r.atEnd = round(s?.to ?? from); } else r[camelAt(k)] = round(s?.from ?? from);
          r[k] = v;
        } else r[k] = timed(v);
      }
      return r;
    };
    if (start && to - from < SCENE_MIN_SECONDS && n < scenes.length - 1) issues.push(`${where} 장면이 ${round(to - from)}초뿐이에요 — 앞뒤 장면과 합치거나 시작 문구를 바꿔요.`);
    return { ...(timed(sc) as Record<string, unknown>), from: round(from), to: round(to) };
  });
  if (issues.length) return { issues: issues.slice(0, 40), story: null, notes, fuzzy };

  // subtitles: each line's first letter in the script, carried over the script ↔ transcript alignment to the word it was read as
  const words = input.words.map(([, , w]) => myinNorm(w)).join("");
  const blocks = matchingBlocks(script, words);
  const toWords = (i: number) => { let j = 0; for (const [a, b, k] of blocks) { if (a > i) break; j = i < a + k ? b + (i - a) : b + k; } return Math.min(words.length - 1, j); };
  let char = 0;
  const subStarts = subs.map((s) => { const at = input.words[idx.at(toWords(char))][0]; char += myinNorm(s).length; return at; });
  const timedSubs = subs.map((s, i) => {
    const a = i === 0 ? 0 : Math.max(subStarts[i], subStarts[i - 1] + 0.2), b = i + 1 < subs.length ? Math.max(a + 0.2, subStarts[i + 1] - 0.02) : input.durationSeconds;
    return [round(a), round(b), s] as [number, number, string];
  });
  const quick = timedSubs.filter(([a, b]) => b - a < 0.5).map(([, , s]) => s);
  if (quick.length) notes.push(`0.5초 안에 지나가는 자막 ${quick.length}줄: ${quick.slice(0, 6).join(" · ")} — 읽기 어려우면 앞뒤 줄과 합쳐요.`);

  const titleLines = lines.map((line) => { const k = accent ? line.indexOf(accent) : -1; return k < 0 ? [{ text: line }]
    : [{ text: line.slice(0, k).trim() }, { text: accent, accent: true }, { text: line.slice(k + accent.length).trim() }].filter((p) => p.text); });
  const story = { renderer: "web", duration: round(input.durationSeconds), title: { lines: titleLines }, scenes: out, subtitles: timedSubs, cta: [] as never[] };
  return { issues, story, notes, fuzzy };
}

/** The spoken script the subtitles cover: the 대본's screen hints ([장면] · [관계] · [목록] · [사람]) at line starts are never read. */
export const webShortSpoken = (paragraphs: string[]) => paragraphs.join(" ").replace(/\[[^\]\n]{1,6}\]\s*/g, "").replace(/\s+/g, " ").trim();

/** Photo file names a web storyboard uses (for the assets check and the render PC's download). */
export const webShortPhotos = (story: { scenes: Record<string, unknown>[] }) => [...new Set(story.scenes.flatMap((sc) =>
  [sc.photo, (sc.top as { photo?: unknown } | undefined)?.photo, (sc.bottom as { photo?: unknown } | undefined)?.photo].filter((p): p is string => typeof p === "string")))];
