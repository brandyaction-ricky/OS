// 버전 비교 (로건 QA 10/30, 편집감독): one offset could not follow a version whose early lines or scenes changed — everything after
// moved by a different amount. Two versions made by the render PC each have their subtitles, so the lines both share become anchors
// (A time = B time) and B follows A piece by piece between them; the lines only one side has are what changed.
export interface Cue { start: number; end: number; text: string }
export type Anchor = [number, number];
export interface VersionChange { a: [number, number]; b: [number, number]; aText: string; bText: string }

const seconds = (stamp: string) => { const [h, m, s] = stamp.trim().replace(",", ".").split(":").map(Number); return h * 3600 + m * 60 + s; };

/** An SRT file's cues in order (a cue's lines joined by a space). */
export function srtCues(srt: string): Cue[] {
  return srt.replace(/\r/g, "").split(/\n\s*\n/).flatMap(block => {
    const lines = block.trim().split("\n"), at = lines.findIndex(line => line.includes("-->"));
    if (at < 0) return [];
    const [from, to] = lines[at].split("-->");
    const text = lines.slice(at + 1).join(" ").trim();
    return text ? [{ start: seconds(from), end: seconds(to), text }] : [];
  });
}

const key = (text: string) => text.replace(/[\s.,!?·…'"“”‘’~\-]/g, "");

/** The lines both versions say in the same order (longest common run) as anchors, and the runs between them as changes. */
export function alignVersions(a: Cue[], b: Cue[]) {
  const ka = a.map(cue => key(cue.text)), kb = b.map(cue => key(cue.text));
  const n = a.length, m = b.length, dp = Array.from({ length: n + 1 }, () => new Uint16Array(m + 1));
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) dp[i][j] = ka[i] === kb[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
  const anchors: Anchor[] = [], changes: VersionChange[] = [];
  let onlyA: Cue[] = [], onlyB: Cue[] = [], i = 0, j = 0;
  const flush = () => {
    if (!onlyA.length && !onlyB.length) return;
    // A side that lost nothing (or gained nothing) is a point: where the other side's lines went in.
    const aAt = a[i]?.start ?? a.at(-1)?.end ?? 0, bAt = b[j]?.start ?? b.at(-1)?.end ?? 0;
    changes.push({ a: onlyA.length ? [onlyA[0].start, onlyA.at(-1)!.end] : [aAt, aAt], b: onlyB.length ? [onlyB[0].start, onlyB.at(-1)!.end] : [bAt, bAt],
      aText: onlyA.map(cue => cue.text).join(" "), bText: onlyB.map(cue => cue.text).join(" ") });
    onlyA = []; onlyB = [];
  };
  while (i < n && j < m) {
    if (ka[i] === kb[j]) { flush(); anchors.push([a[i].start, b[j].start]); i++; j++; }
    else if (dp[i + 1][j] >= dp[i][j + 1]) onlyA.push(a[i++]);
    else onlyB.push(b[j++]);
  }
  onlyA.push(...a.slice(i)); onlyB.push(...b.slice(j)); i = n; j = m; flush();
  return { anchors, changes };
}

/** B's time for A's: straight lines between the anchors around it, the nearest anchor's gap outside them; then the hand offset. */
export function mapTime(aTime: number, anchors: Anchor[], offset: number, bDuration: number) {
  const sorted = [...anchors].sort((x, y) => x[0] - y[0]);
  let b = aTime;
  if (sorted.length) {
    const next = sorted.findIndex(([at]) => at > aTime);
    const [a0, b0] = next <= 0 ? sorted[next === 0 ? 0 : sorted.length - 1] : sorted[next - 1];
    if (next <= 0) b = aTime + (b0 - a0);
    else { const [a1, b1] = sorted[next]; b = b0 + (aTime - a0) * (a1 - a0 > 0 ? (b1 - b0) / (a1 - a0) : 1); }
  }
  return Math.max(0, Math.min(bDuration || Infinity, b + offset));
}
