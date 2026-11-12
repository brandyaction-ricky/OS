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
// A table row's cells, or null for any other line. `\|` inside a cell is not a border.
function tableCells(line: string) {
  if (!/^\s*\|.*\|\s*$/.test(line)) return null;
  return line.trim().slice(1, -1).split(/(?<!\\)\|/).map((cell) => cell.trim());
}
const unescape = (cell: string) => cell.replace(/\\([!-/:-@[-`{-~])/g, "$1");
// What a line says, ignoring how the editor spaced or escaped it: one edited cell makes the editor re-pad every row of the
// table and escape `~`, which must not count as the person changing those rows.
function lineKey(line: string) {
  const cells = tableCells(line);
  return cells ? `|${cells.map((cell) => (/^:?-+:?$/.test(cell) ? "---" : unescape(cell))).join("|")}|` : line;
}
const keyed = (lines: string[]) => lines.map(lineKey).join("\n");
// An edited table row: cells the person did not change keep the original cell text, and no padding is added.
function mergeRow(original: string | undefined, normalized: string, edited: string) {
  const o = original === undefined ? null : tableCells(original), n = tableCells(normalized), e = tableCells(edited);
  if (!e) return edited;
  const same = o && n && o.length === e.length && n.length === e.length;
  return `| ${e.map((cell, i) => (same && unescape(cell) === unescape(n![i]) ? o![i] : /^:?-+:?$/.test(cell) ? cell.replace(/-+/, "---") : cell)).join(" | ")} |`;
}

/**
 * 정본 변경 제안 (2026-11-12): the rich editor writes every line back in its own style (escaped `*`, `*` bullets, padded tables,
 * HTML as text) even when one line changed. Given the text the editor was opened with (`original`), what the editor made of it
 * untouched (`normalized`) and what it holds now (`edited`), keep the original wording of every part the person did not change and
 * take the editor's text only where they did. A part the editor rewrote and the person also edited takes the edited text; an
 * edited table row keeps its untouched cells as written and gets no padding.
 */
export function keepOriginalLines(original: string, normalized: string, edited: string) {
  if (normalized === edited) return original;
  const base = normalized.split("\n"), from = original.split("\n"), now = edited.split("\n");
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
  for (const change of diffMarkdownLines(keyed(base), keyed(from))) {
    if (change.kind === "same") { close(); units.push({ from: at, to: at + 1, text: [from[change.newLine! - 1]] }); at += 1; }
    else {
      run ??= { from: at, to: at, text: [] };
      if (change.kind === "removed") { at += 1; run.to = at; } else run.text.push(from[change.newLine! - 1]);
    }
  }
  close();
  // What the person did to each normalized line: kept, replaced (removed lines paired in order with the lines added right after
  // them), or removed; and the lines they added before it (index base.length = the end).
  const kept = new Array<boolean>(base.length).fill(false);
  const replaced = new Array<string | undefined>(base.length);
  const added: string[][] = Array.from({ length: base.length + 1 }, () => []);
  const pending: number[] = [];
  at = 0;
  for (const change of diffMarkdownLines(keyed(base), keyed(now))) {
    const text = now[(change.newLine ?? 1) - 1];
    if (change.kind === "added") { const k = pending.shift(); if (k === undefined) added[at].push(text); else replaced[k] = text; }
    else if (change.kind === "removed") { pending.push(at); at += 1; }
    else { pending.length = 0; kept[at] = true; at += 1; }
  }
  const out: string[] = [];
  for (const unit of units) {
    out.push(...added[unit.from].splice(0).map((line) => mergeRow(undefined, line, line)));
    const untouched = kept.slice(unit.from, unit.to).every(Boolean) && added.slice(unit.from + 1, unit.to).every((lines) => !lines.length);
    if (untouched) { out.push(...unit.text); continue; }
    // One edited line: a table row keeps its untouched cells as written.
    if (unit.to - unit.from === 1 && unit.text.length === 1 && replaced[unit.from] !== undefined) {
      out.push(mergeRow(unit.text[0], base[unit.from], replaced[unit.from]!));
      continue;
    }
    for (let k = unit.from; k < unit.to; k += 1) {
      if (k > unit.from) out.push(...added[k].splice(0).map((line) => mergeRow(undefined, line, line)));
      if (kept[k]) out.push(base[k]);
      else if (replaced[k] !== undefined) out.push(mergeRow(undefined, replaced[k]!, replaced[k]!));
    }
  }
  out.push(...added[base.length].map((line) => mergeRow(undefined, line, line)));
  return out.join("\n");
}
