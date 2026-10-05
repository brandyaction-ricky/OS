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
