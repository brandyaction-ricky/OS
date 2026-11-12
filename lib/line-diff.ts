export type LineChange = { kind: "same" | "added" | "removed"; text: string; oldLine: number | null; newLine: number | null };

// A bounded LCS keeps the common 2,000-line review case exact and fast. Very
// large documents still get a lossless prefix/middle/suffix comparison instead
// of allocating an unbounded quadratic table.
export function diffMarkdownLines(before: string, after: string): LineChange[] {
  const oldLines = before.split("\n");
  const newLines = after.split("\n");
  const n = oldLines.length;
  const m = newLines.length;
  const result: LineChange[] = [];
  const add = (kind: LineChange["kind"], text: string, oldLine: number | null, newLine: number | null) => result.push({ kind, text, oldLine, newLine });
  if (n * m > 4_000_000) {
    let start = 0;
    while (start < Math.min(n, m) && oldLines[start] === newLines[start]) { add("same", oldLines[start], start + 1, start + 1); start += 1; }
    let tail = 0;
    while (tail < Math.min(n - start, m - start) && oldLines[n - 1 - tail] === newLines[m - 1 - tail]) tail += 1;
    for (let i = start; i < n - tail; i += 1) add("removed", oldLines[i], i + 1, null);
    for (let j = start; j < m - tail; j += 1) add("added", newLines[j], null, j + 1);
    for (let i = 0; i < tail; i += 1) add("same", oldLines[n - tail + i], n - tail + i + 1, m - tail + i + 1);
    return result;
  }
  const width = m + 1;
  const table = new Uint16Array((n + 1) * width);
  for (let i = n - 1; i >= 0; i -= 1) {
    for (let j = m - 1; j >= 0; j -= 1) {
      const index = i * width + j;
      table[index] = oldLines[i] === newLines[j]
        ? table[(i + 1) * width + j + 1] + 1
        : Math.max(table[(i + 1) * width + j], table[i * width + j + 1]);
    }
  }
  let i = 0;
  let j = 0;
  while (i < n || j < m) {
    if (i < n && j < m && oldLines[i] === newLines[j]) { add("same", oldLines[i], i + 1, j + 1); i += 1; j += 1; }
    else if (i < n && (j === m || table[(i + 1) * width + j] >= table[i * width + j + 1])) { add("removed", oldLines[i], i + 1, null); i += 1; }
    else { add("added", newLines[j], null, j + 1); j += 1; }
  }
  return result;
}

/**
 * 정본 변경 제안 (2026-11-12): the rich editor writes every line back in its own style (escaped `*`, `*` bullets, padded tables,
 * HTML as text) even when one line changed. Given the text the editor was opened with (`original`), what the editor made of it
 * untouched (`normalized`) and what it holds now (`edited`), keep the original wording of every part the person did not change and
 * take the editor's text only where they did. A part the editor rewrote and the person also edited takes the edited text.
 */
export function keepOriginalLines(original: string, normalized: string, edited: string) {
  if (normalized === edited) return original;
  const base = normalized.split("\n");
  // Units over the normalized lines: one line the editor left alone, or a run it rewrote, with the original lines behind it.
  // A run rewritten line for line (escapes, bullets, table padding) is split back into single lines, so editing one bullet or one
  // table row keeps the rest of the list or table as it was.
  const units: { from: number; to: number; text: string[] }[] = [];
  let at = 0, run: { from: number; to: number; text: string[] } | null = null;
  const close = () => {
    if (!run) return;
    if (run.to - run.from === run.text.length) run.text.forEach((line, k) => units.push({ from: run!.from + k, to: run!.from + k + 1, text: [line] }));
    else units.push(run);
    run = null;
  };
  for (const change of diffMarkdownLines(normalized, original)) {
    if (change.kind === "same") { close(); units.push({ from: at, to: at + 1, text: [change.text] }); at += 1; }
    else {
      run ??= { from: at, to: at, text: [] };
      if (change.kind === "removed") { at += 1; run.to = at; } else run.text.push(change.text);
    }
  }
  close();
  // What the person did to each normalized line: kept or not, and the lines they added before it (index base.length = the end).
  const kept = new Array<boolean>(base.length).fill(false);
  const added: string[][] = Array.from({ length: base.length + 1 }, () => []);
  at = 0;
  for (const change of diffMarkdownLines(normalized, edited)) {
    if (change.kind === "added") added[at].push(change.text);
    else { if (change.kind === "same") kept[at] = true; at += 1; }
  }
  const out: string[] = [];
  for (const unit of units) {
    out.push(...added[unit.from].splice(0));
    const untouched = kept.slice(unit.from, unit.to).every(Boolean) && added.slice(unit.from + 1, unit.to).every((lines) => !lines.length);
    if (untouched) { out.push(...unit.text); continue; }
    for (let k = unit.from; k < unit.to; k += 1) {
      if (k > unit.from) out.push(...added[k].splice(0));
      if (kept[k]) out.push(base[k]);
    }
  }
  out.push(...added[base.length]);
  return out.join("\n");
}
