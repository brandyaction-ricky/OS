import { z } from "zod";
import { myinNorm } from "../myin-storyboard.ts";

// 롱폼에서 나온 숏폼 (「롱폼 재활용 숏폼 정본」 §1~§2, 대표 2026-11-18): a longform's 원고 split into stand-alone stretches; each keeps
// the longform's own voice (cut on silence by the render PC, 1.25×) and is drawn anew by the web short renderer.
export const RECYCLE = { count: 5, tempo: 1.25, minSeconds: 20, maxSeconds: 50, titleLine: 12 } as const;
/** First words that lean on what came before (§2-3): a stretch never starts with them. */
export const RECYCLE_LEANING = ["그럼", "그러면", "예를 들어", "예를들어", "다만", "그래서", "그리고", "하지만", "그런데", "이렇게", "이처럼", "이게", "이건", "이 두", "앞에서", "아까"];

export const recycleResultSchema = z.object({
  shorts: z.array(z.object({
    title: z.array(z.string().trim().min(1).max(30)).min(1).max(2),
    parts: z.array(z.object({ from: z.string().trim().min(2).max(80), to: z.string().trim().min(2).max(80), text: z.string().trim().min(4).max(2000) }).strict()).min(1).max(4),
    why: z.string().trim().max(300).default(""),
  }).strict()).min(1).max(RECYCLE.count),
}).strict();
export type RecycleResult = z.infer<typeof recycleResultSchema>;
export interface RecyclePart { text: string; start: number; end: number }
export interface RecycleShort { title: string[]; parts: RecyclePart[]; seconds: number; why: string }

const letters = (s: string) => s.replace(/\s/g, "").length;
const clock = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;
/** A stretch already made into a 숏폼 (or picked earlier in the same answer): new ones must not cover its voice again. */
export interface RecycleTaken { title: string[]; parts: { start: number; end: number }[] }
const overlaps = (a: RecycleTaken["parts"], b: RecycleTaken["parts"]) => a.some((p) => b.some((q) => p.start < q.end && q.start < p.end));

/**
 * The AI's stretches (phrases in the transcript's spelling, text in the 원고's) as voice times, or what is wrong with them: phrases not
 * heard, parts out of order, text not in the 원고 or not what was said, a leaning first word, a length outside 20–50 s at 1.25×, a
 * stretch that covers one already made into a 숏폼 or another stretch of the same answer.
 */
export function checkRecycle(value: RecycleResult, words: [number, number, string][], script: string, made: RecycleTaken[] = []) {
  const norms = words.map(([, , w]) => myinNorm(w));
  const text = norms.join("");
  const starts: number[] = []; let n = 0;
  for (const w of norms) { starts.push(n); n += w.length; }
  const wordAt = (char: number) => { let lo = 0, hi = starts.length - 1; while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (starts[mid] <= char) lo = mid; else hi = mid - 1; } return lo; };
  const find = (phrase: string, from: number) => { const p = myinNorm(phrase); if (!p) return -1; const i = text.indexOf(p, from); return i < 0 ? -1 : i; };
  const scriptNorm = myinNorm(script);
  const issues: string[] = [];
  const shorts: RecycleShort[] = value.shorts.map((short, k) => {
    const name = `${k + 1}번 숏폼`;
    let pos = 0;
    const parts: RecyclePart[] = [];
    short.parts.forEach((part, j) => {
      const where = `${name} ${j + 1}번째 구간`;
      const a = find(part.from, pos);
      if (a < 0) { issues.push(`${where}: 시작 문구 「${part.from}」를 받아쓰기에서 못 찾았어요(앞 구간보다 뒤에서, 받아쓰기 철자 그대로).`); return; }
      const b = find(part.to, a);
      if (b < 0) { issues.push(`${where}: 끝 문구 「${part.to}」를 시작 문구 뒤에서 못 찾았어요(받아쓰기 철자 그대로).`); return; }
      const endChar = b + myinNorm(part.to).length - 1;
      const wa = wordAt(a), wb = wordAt(endChar);
      if (!scriptNorm.includes(myinNorm(part.text))) issues.push(`${where}: text가 원고에 그대로 있지 않아요 — 원고 문장을 고치지 말고 그대로 옮겨요.`);
      const heard = norms.slice(wa, wb + 1).join("").length, written = myinNorm(part.text).length;
      if (written < heard * 0.75 || written > heard * 1.33) issues.push(`${where}: text(${written}자)가 시작~끝 문구 사이에 말한 양(${heard}자)과 맞지 않아요.`);
      pos = endChar + 1;
      parts.push({ text: part.text.replace(/\s+/g, " ").trim(), start: words[wa][0], end: words[wb][1] });
    });
    const first = short.parts[0]?.text.trim() ?? "";
    const lean = RECYCLE_LEANING.find((w) => first.startsWith(w));
    if (lean) issues.push(`${name}: 「${lean}」로 시작해요 — 앞 내용을 받는 첫 말로 시작하는 문장은 빼요(정본 §2-3).`);
    for (const line of short.title) if (letters(line) > RECYCLE.titleLine) issues.push(`${name}: 제목 줄 「${line}」은 ${RECYCLE.titleLine}자 이하로(띄어쓰기 빼고).`);
    const seconds = Math.round(parts.reduce((sum, p) => sum + p.end - p.start, 0) / RECYCLE.tempo * 10) / 10;
    if (parts.length === short.parts.length && (seconds < RECYCLE.minSeconds || seconds > RECYCLE.maxSeconds))
      issues.push(`${name}: 1.25배로 ${seconds}초예요 — ${RECYCLE.minSeconds}~${RECYCLE.maxSeconds}초로 골라요.`);
    return { title: short.title, parts, seconds, why: short.why };
  });
  shorts.forEach((short, k) => {
    const name = `${k + 1}번 숏폼`;
    const taken = made.find((m) => overlaps(short.parts, m.parts));
    if (taken) issues.push(`${name}: 이미 숏폼으로 만든 「${taken.title.join(" ")}」(롱폼 ${clock(taken.parts[0].start)}~${clock(taken.parts.at(-1)!.end)})과 겹쳐요 — 다른 구간을 골라요.`);
    const twin = shorts.findIndex((other, j) => j < k && overlaps(short.parts, other.parts));
    if (twin >= 0) issues.push(`${name}: ${twin + 1}번 숏폼과 구간이 겹쳐요 — 겹치지 않게 골라요.`);
  });
  return { shorts, issues };
}

/** A recycled 숏폼's 대본: its parts' sentences, one per line (한 줄 = 한 화면). */
export const recycleScript = (parts: { text: string }[]) =>
  parts.map((p) => p.text).join(" ").split(/(?<=[.?!。])\s+/).map((line) => line.trim()).filter(Boolean).join("\n");
