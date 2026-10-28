// 1단계 자막 내려받기 (owner request 2026-10-28): Logan's 방송 자막 (ASS) as an SRT any editor or YouTube opens.
const srtTime = (ass: string) => {
  const [h, m, s] = ass.trim().split(":");
  const [sec, cs = ""] = s.split(".");
  return `${h.padStart(2, "0")}:${m.padStart(2, "0")}:${sec.padStart(2, "0")},${(cs + "000").slice(0, 3)}`;
};

/** Each Dialogue line in order: its start and end, and the text without styling tags ({\…}) and with \N as a line break. */
export function assToSrt(ass: string) {
  const cues = ass.split(/\r?\n/).filter((line) => line.startsWith("Dialogue:")).map((line) => {
    const fields = line.slice("Dialogue:".length).split(",");
    const text = fields.slice(9).join(",").replace(/\{[^}]*\}/g, "").replace(/\\[Nn]/g, "\n").replace(/\\h/g, " ").trim();
    return { start: srtTime(fields[1]), end: srtTime(fields[2]), text };
  }).filter((cue) => cue.text);
  return cues.map((cue, i) => `${i + 1}\n${cue.start} --> ${cue.end}\n${cue.text}\n`).join("\n");
}
