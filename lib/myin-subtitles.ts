// 자막 한꺼번에 고치기 (유쓰 요청 1/8, 2026-11-02). Logan's engine draws the video's subtitles and writes the YouTube SRT from the same
// subs_myin.ass (render_myin.py load → M.load_subs · write_srt), so changing only the words of its Dialogue lines changes both alike and
// leaves the script, the voice and every time as they are. An edit keeps the words it replaced: on a re-made voice a line that no longer
// reads that way is not changed and is shown as 확인 필요.
export interface SubtitleEdit { i: number; from: string; to: string }
export interface SubtitleLine { i: number; start: string; end: string; text: string }

const DIALOGUE = /^(Dialogue: (?:[^,\n]*,){9})(.*)$/;
/** The Dialogue lines in order (their number is what Logan's 자막 검수 calls them by). */
export function subtitleLines(ass: string): SubtitleLine[] {
  const lines: SubtitleLine[] = [];
  for (const row of ass.replace(/\r/g, "").split("\n")) {
    const match = row.match(DIALOGUE);
    if (!match) continue;
    const [, start = "", end = ""] = match[1].split(",");
    lines.push({ i: lines.length, start, end, text: match[2] });
  }
  return lines;
}

/** The ASS with the edits whose line still reads `from`; the rest are conflicts. */
export function applySubtitleEdits(ass: string, edits: SubtitleEdit[]) {
  const byLine = new Map(edits.map((edit) => [edit.i, edit]));
  const conflicts: number[] = [];
  let i = -1, applied = 0;
  const out = ass.replace(/\r/g, "").split("\n").map((row) => {
    const match = row.match(DIALOGUE);
    if (!match) return row;
    const edit = byLine.get(++i);
    if (!edit) return row;
    if (match[2] !== edit.from) { conflicts.push(edit.i); return row; }
    applied++;
    return match[1] + edit.to;
  }).join("\n");
  for (const edit of edits) if (edit.i > i) conflicts.push(edit.i);
  return { ass: out, applied, conflicts };
}

/** Words only: no line breaks or ASS override braces (the engine would draw them), not empty. */
export const subtitleTextProblem = (text: string) => !text.trim() ? "빈 자막은 둘 수 없어요." : /[\n\r{}]/.test(text) ? "줄바꿈과 { } 는 쓸 수 없어요." : text.length > 80 ? "한 줄은 80자까지예요." : "";

/** Logan's 자막 검수 (subs_qc.md) rule lines — 「  - 99: 짧은 꼬리 줄 '맞아요'」 — by line number. */
export function subtitleIssues(qc: string) {
  return [...qc.matchAll(/^\s*-\s*(\d+):\s*(.+)$/gm)].map((match) => ({ i: Number(match[1]), note: match[2].trim().slice(0, 120) }));
}
