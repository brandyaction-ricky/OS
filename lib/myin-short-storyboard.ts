// 숏폼 기획표 (2026-10-28): the same myin_storyboard.json as a longform, drawn 9:16 by the render PC's vertical copy of Logan's engine
// (owner 2026-10-27: shorts are the longform engine in portrait). Opening scenes of big type (acts) on the first and the last screen
// and at most one emphasis line between, the rest lib_ scenes from the diagrams that have a vertical layout and Logan's persona card
// (owner 2026-10-29: text-only screens lose viewers, at least 8 in 10 seconds are diagrams; big type that stays still loses them too).
// No reel, music or CTA voice. The OS checks what would break the render, the first screen and the diagram share.
import { myinCueMisses, myinNorm, myinSceneStarts, openingTextIssues, type MyinStoryboard } from "./myin-storyboard.ts";

/** A vertical diagram as the render PC's catalog lists it (lib/shortform-diagram-catalog.json): its slots and their letter limits. */
export interface ShortDiagram { type: string; name: string; slots: string; spec: SlotSpec }
/** required: slots the new vertical diagrams (2026-10-30 GPT) stop the render without; a cue_ slot may also come as its t_ time. */
interface SlotSpec { kind: string; fields?: Record<string, SlotSpec>; item?: SlotSpec; min?: number; max?: number; required?: string[] }
/** 인물 카드: Logan's persona scene (myin_persona.py), centred in the vertical frame by the render PC — for the first time the script
 *  brings in a person (시안 2: 「6년 차 디자이너 수진 씨」). His drawer reads every person's name and desc. */
export const SHORT_PERSONA: ShortDiagram = { type: "persona", name: "인물 카드", slots: "사람 1~2명, name ≤ 6자, desc ≤ 12자, prop(선택): hair · glasses · tie · bag",
  spec: { kind: "object", fields: { people: { kind: "array", min: 1, max: 2, item: { kind: "object", fields: { name: { kind: "text", max: 6 }, desc: { kind: "text", max: 12 } } } } } } };
/** Diagram screen time in a short (owner 2026-10-29: 8할 이상). A clip under 20 s is exempt: its first sentence alone passes 20 %. */
export const SHORT_DIAGRAM_SHARE = 0.8;
const SHARE_FROM_SECONDS = 20;
/** Big type always moves (owner 2026-10-29 「글자만 딱 나오기보다는 효과가 들어가야」): each piece slams in and the camera punches in at
 *  every act. No slow push — 「아주 살짝씩 움직이는 부분은 어색해」; the render PC cuts the zoom every 1.7 s instead (viral shorts change the
 *  picture every 1.3–1.8 s, 2026-10-29 reference count). */
const SHORT_PUNCH = 0.07;
/** A photo cut inside a diagram scene (owner 2026-10-29 「사진도 넣어보자」): the render PC fills the diagram area with it for 1.4 s. */
const BROLL_MAX = 2;

// Big type in 1080 px: a slam grows a line ×1.28, so lines stay inside ~0.8 W (A1–A3 pilots: 777–805 px passed at 360 px).
export const SHORT_LINE_MAX_PX = 860;
const OPENING_SIZE = 120;   // Logan's opening default when an act sets no size
/** A line's width in Pretendard at `size` px: Hangul ≈ 0.8 em, Latin and digits 0.55, spaces 0.25, marks 0.35 (measured on A1). */
export function shortLineWidth(text: string, size: number) {
  let em = 0;
  for (const ch of text) em += /[가-힣]/.test(ch) ? 0.8 : /\s/.test(ch) ? 0.25 : /[0-9A-Za-z]/.test(ch) ? 0.55 : 0.35;
  return em * size;
}

type Act = { cue?: unknown; size?: unknown; lines?: unknown; cam?: unknown; text_y?: unknown; [key: string]: unknown };
type Scene = Record<string, unknown> & { type: string; acts?: Act[] };
type Piece = { text?: unknown; size?: unknown; cue?: unknown; t?: unknown; [key: string]: unknown };
/** An act's lines as Logan's opening drawer reads them, [[{text, cue | t, …}, …], …], from either spelling ([text, cue] pairs too). */
const actLines = (act: Act): Piece[][] => (Array.isArray(act.lines) ? act.lines : []).map((line) =>
  (Array.isArray(line) && !(typeof line[0] === "string" && typeof line[1] === "string") ? line : [line]).flatMap((piece): Piece[] => typeof piece === "string" ? [{ text: piece }]
    : Array.isArray(piece) && typeof piece[0] === "string" ? [{ text: piece[0], ...(typeof piece[1] === "string" ? { cue: piece[1] } : {}) }]
    : piece && typeof piece === "object" ? [piece as Piece] : []));
/** His drawer reads act.t and every piece's t (from cue): a missing one stops the render with KeyError 't' (2026-10-28 test). */
const timed = (o: { cue?: unknown; t?: unknown }) => typeof o.cue === "string" || typeof o.t === "number";
const lineText = (line: Piece[]) => line.map((piece) => String(piece.text ?? "")).join(" ").replace(/\s+/g, " ").trim();

/** Letter limits and item counts of a diagram's slots (catalog spec), at any depth. */
function slotIssues(spec: SlotSpec, value: unknown, where: string, path = ""): string[] {
  if (spec.kind === "object" && value && typeof value === "object" && !Array.isArray(value)) {
    const o = value as Record<string, unknown>;
    const missing = (spec.required ?? []).filter((key) => o[key] === undefined && !(key.startsWith("cue_") && o[`t_${key.slice(4)}`] !== undefined));
    return [...missing.map((key) => `${where} ${path ? `${path}.` : ""}${key} 칸이 없어요.`),
      ...Object.entries(spec.fields ?? {}).flatMap(([key, child]) => slotIssues(child, o[key], where, path ? `${path}.${key}` : key))];
  }
  if (spec.kind === "array" && Array.isArray(value)) {
    if (value.length < (spec.min ?? 1) || value.length > (spec.max ?? 6)) return [`${where} ${path}는 ${spec.min ?? 1}~${spec.max ?? 6}개예요(지금 ${value.length}개).`];
    return value.flatMap((item, i) => spec.item ? slotIssues(spec.item, item, where, `${path}.${i}`) : []);
  }
  if (spec.kind === "text" && typeof value === "string" && spec.max && value.length > spec.max)
    return [`${where} ${path} 「${value}」은 ${spec.max}자 이하로 줄여 주세요(세로 도식 칸).`];
  return [];
}

/**
 * The 숏폼 storyboard as the render PC will draw it, or the problems the staff AI must fix. The OS fills what every short shares
 * (white background, the big-type motion) and removes what a short has none of.
 */
export function checkShortStoryboard(value: unknown, input: { words: [number, number, string][]; speech: string; headCopy: string; durationSeconds: number; diagrams: ShortDiagram[] }) {
  const issues: string[] = [];
  const raw = value && typeof value === "object" ? value as Record<string, unknown> : {};
  const scenes = (Array.isArray(raw.scenes) ? raw.scenes : []).filter((sc): sc is Scene => Boolean(sc) && typeof sc === "object" && typeof (sc as Scene).type === "string");
  if (scenes.length < 2 || scenes.length > 60) issues.push(`장면은 2~60개예요(지금 ${scenes.length}개).`);
  const end = Number(raw.end);
  if (!Number.isFinite(end) || end < input.durationSeconds || end > input.durationSeconds + 3) issues.push(`end는 마지막 말이 끝난 뒤 0~3초 안의 초예요(낭독 ${input.durationSeconds.toFixed(1)}초).`);
  const diagrams = new Map([...input.diagrams, SHORT_PERSONA].map((d) => [d.type, d]));
  const emphasis = scenes.findIndex((sc, n) => sc.type === "opening" && n > 0 && n < scenes.length - 1);
  scenes.forEach((sc, n) => {
    const where = `[장면 ${n + 1}]`;
    if (sc.at === undefined && sc.at_time === undefined) issues.push(`${where} at(시작 문구)이 없어요.`);
    if (sc.type === "opening" && n > 0 && n < scenes.length - 1 && (n !== emphasis || (Array.isArray(sc.acts) && sc.acts.length > 1)))
      issues.push(`${where} 가운데 큰 글자(opening)는 꼭 강조할 한 문장에 한 번(막 하나)만 써요. 이 구간은 세로 도식이나 인물 카드로 그려요.`);
    if (sc.broll !== undefined && (sc.type === "opening" || !Array.isArray(sc.broll) || !sc.broll.length || sc.broll.length > BROLL_MAX
      || !sc.broll.every((b) => b && typeof b === "object" && typeof (b as Piece).file === "string" && typeof (b as Piece).cue === "string")))
      issues.push(`${where} broll(사진 컷)은 도식 · 인물 장면에 [{ "file", "cue" }] ${BROLL_MAX}개까지예요.`);
    if (sc.type === "persona" && !(Array.isArray(sc.people) && sc.people.length && sc.people.every((p) => typeof p?.name === "string" && typeof p?.desc === "string")))
      issues.push(`${where} persona는 people(사람마다 name · desc)이 있어야 해요.`);
    if (sc.type === "opening") {
      const acts = Array.isArray(sc.acts) ? sc.acts : [];
      if (!acts.length) issues.push(`${where} opening에 acts가 없어요.`);
      acts.forEach((act, k) => {
        const lines = actLines(act);
        if (!lines.some((line) => lineText(line))) issues.push(`${where} ${k + 1}번째 막에 글자 줄이 없어요.`);
        if (k > 0 && !timed(act) && !lines.flat().some(timed)) issues.push(`${where} ${k + 1}번째 막에 cue(그 막이 시작되는 말)가 없어요.`);
        for (const line of lines) {
          const size = Number(line.find((piece) => typeof piece.size === "number")?.size ?? act.size ?? OPENING_SIZE);
          const px = shortLineWidth(lineText(line), size);
          if (px > SHORT_LINE_MAX_PX) issues.push(`${where} ${k + 1}번째 막 「${lineText(line)}」이 화면보다 넓어요(약 ${Math.round(px)}px, ${SHORT_LINE_MAX_PX}px까지) — 줄을 나누거나 size를 줄여요.`);
        }
      });
    } else if (diagrams.has(sc.type)) {
      issues.push(...slotIssues(diagrams.get(sc.type)!.spec, sc, `${where} ${sc.type}`));
      // 공통점 찾기 marks the same words in every card; the render PC stops when a card lacks them or has them twice.
      const cards = sc.type === "lib_common_thread" && Array.isArray(sc.cards) ? sc.cards as Piece[] : [];
      if (cards.length && (new Set(cards.map((c) => c?.mark)).size !== 1 || cards.some((c) => typeof c?.mark !== "string" || !c.mark || String(c.text ?? "").split(String(c.mark)).length !== 2)))
        issues.push(`${where} lib_common_thread는 카드마다 같은 mark가 text 안에 꼭 한 번 들어가요.`);
    }
    else issues.push(`${where} "${sc.type}"는 세로로 그릴 수 없어요. 큰 글자는 opening, 관계와 사람은 아래 세로 도식 목록에서 골라요.`);
  });
  // 헤드 카피 (숏폼 대본 정본, owner 2026-10-28: the most important): the first screen's big words are the confirmed ones.
  const first = scenes[0];
  const head = first?.type === "opening" && Array.isArray(first.acts) && first.acts[0] ? actLines(first.acts[0]).map(lineText).join(" ") : "";
  if (first?.type !== "opening") issues.push("첫 장면은 opening이에요 — 첫 화면에 헤드 카피를 크게 띄워요.");
  else if (input.headCopy.trim() && myinNorm(head) !== myinNorm(input.headCopy)) issues.push(`첫 장면 첫 막의 글자는 확정한 헤드 카피 「${input.headCopy}」 그대로예요(지금 「${head}」).`);
  if (issues.length) return { issues: issues.slice(0, 40), story: null, fuzzy: [] as string[], share: 0 };

  const story = { ...raw, end, cta: [] as { after: string; line: string }[],
    scenes: scenes.map((sc) => sc.type !== "opening" ? { bg: "white", ...timedSlots(sc, sceneStart(sc)) as Scene }
      : { bg: "white", ...sc, acts: (sc.acts ?? []).map((act, k) => shortAct(act, k, sc)) }) } as unknown as MyinStoryboard;
  delete (story as Record<string, unknown>).reel;
  delete (story as Record<string, unknown>).music_cues;
  const cues = myinCueMisses(story, input.words);
  issues.push(...cues.misses, ...openingTextIssues(story, input.words, input.speech).map((issue) => issue.replace("쇼릴 전에는 자막이 없으니", "첫 장면에는 자막이 없으니")));
  const share = diagramShare(story.scenes, input.words, input.durationSeconds);
  if (input.durationSeconds >= SHARE_FROM_SECONDS && share < SHORT_DIAGRAM_SHARE)
    issues.push(`도식 화면이 ${Math.round(share * 100)}%예요. ${SHORT_DIAGRAM_SHARE * 100}% 이상이 되게 첫 장면은 첫 문장까지만 두고, 그 뒤는 세로 도식 · 인물 카드로 그려요.`);
  return { issues: issues.slice(0, 40), story: issues.length ? null : story, fuzzy: cues.fuzzy, share };
}

/** The part of the narration (0–1) under a diagram or persona scene: each scene runs from its start to the next found start. */
function diagramShare(scenes: { type: string; at?: unknown; at_time?: unknown }[], words: [number, number, string][], total: number) {
  const starts = myinSceneStarts(scenes, words);
  let shown = 0;
  scenes.forEach((sc, n) => {
    const from = starts[n];
    if (from === null || sc.type === "opening") return;
    const to = starts.slice(n + 1).find((at) => at !== null) ?? total;
    shown += Math.max(0, Math.min(to, total) - Math.min(from, total));
  });
  return total > 0 ? shown / total : 0;
}

/**
 * An act as his drawer needs it: its own cue — else the scene start for a scene's first act (a later piece's cue left the screen
 * empty for a second in the 2026-10-28 test), else its first timed piece's — and every untimed piece timed with the act.
 */
function shortAct(act: Act, k: number, sc: Scene) {
  const lines = actLines(act);
  const first = lines.flat().find(timed);
  const start = timed(act) ? { cue: act.cue, t: act.t } : k > 0 && first ? { cue: first.cue, t: first.t } : { cue: sc.at, t: sc.at_time };
  const when = typeof start.cue === "string" ? { cue: start.cue } : { t: start.t };
  return { text_y: 720, ...act, slam: true, cam: { push: 0, drift: [0, 0], punch: SHORT_PUNCH }, ...(timed(act) ? {} : when),
    lines: lines.map((line) => line.map((piece) => timed(piece) ? piece : { ...piece, ...when })) };
}

const sceneStart = (sc: Scene) => typeof sc.at === "string" ? { cue: sc.at } : { t: sc.at_time };
/** A diagram's slots ({ text, … } or a persona's { name, … } at any depth) without a cue or t appear with the scene, like A1's items
 *  (the V layouts and the persona drawer read every t). */
function timedSlots(value: unknown, when: { cue?: unknown; t?: unknown }, root = true): unknown {
  if (Array.isArray(value)) return value.map((item) => timedSlots(item, when, false));
  if (!value || typeof value !== "object") return value;
  const o = Object.fromEntries(Object.entries(value).map(([key, item]) => [key, timedSlots(item, when, false)]));
  return !root && (typeof o.text === "string" || typeof o.name === "string") && !timed(o) ? { ...o, ...when } : o;
}

/** A diagram's limits as the OS checks them (slotIssues): "a.text ≤ 8자 · items 1~4개 · items.text ≤ 9자". */
function specLimits(spec: SlotSpec, path = ""): string[] {
  if (spec.kind === "object") return Object.entries(spec.fields ?? {}).flatMap(([key, child]) => specLimits(child, path ? `${path}.${key}` : key));
  if (spec.kind === "array") return [`${path} ${spec.min ?? 1}~${spec.max ?? 6}개`, ...(spec.item ? specLimits(spec.item, path) : [])];
  return spec.kind === "text" && spec.max ? [`${path} ≤ ${spec.max}자`] : [];
}
/**
 * The diagram list for the card: type, name, the limits the OS checks, then the catalog's own note. The note's numbers are Logan's
 * layout guide and differ from the checked limits in 66 of 70, mostly tighter (steps_h 5 vs 8) but sometimes looser (strike_list 12 vs 9,
 * 2026-10-28), so the card shows both and the AI keeps to the narrower.
 */
export const shortDiagramList = (diagrams: ShortDiagram[]) => diagrams.map((d) => `- ${d.type} (${d.name}): ${specLimits(d.spec).join(" · ")} — ${d.slots}`).join("\n");
