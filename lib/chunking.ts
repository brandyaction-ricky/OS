export interface MarkdownChunk {
  heading: string;
  text: string;
  index: number;
}

const MAX_CHARS = 1800;
const OVERLAP_CHARS = 220;

export function chunkMarkdown(markdown: string): MarkdownChunk[] {
  const normalized = markdown.replace(/\r\n?/g, "\n").trim();
  if (!normalized) return [];
  const sections: Array<{ heading: string; text: string }> = [];
  let heading = "본문";
  let buffer: string[] = [];
  const flush = () => {
    const text = buffer.join("\n").trim();
    if (text) sections.push({ heading, text });
    buffer = [];
  };
  for (const line of normalized.split("\n")) {
    const match = line.match(/^(#{1,4})\s+(.+)$/);
    if (match) { flush(); heading = match[2].trim(); }
    else buffer.push(line);
  }
  flush();
  const chunks: Array<Omit<MarkdownChunk, "index">> = [];
  for (const section of sections) {
    let remaining = section.text;
    while (remaining.length > MAX_CHARS) {
      let cut = remaining.lastIndexOf("\n\n", MAX_CHARS);
      if (cut < MAX_CHARS * 0.55) cut = remaining.lastIndexOf(". ", MAX_CHARS);
      if (cut < MAX_CHARS * 0.55) cut = MAX_CHARS;
      const text = remaining.slice(0, cut).trim();
      chunks.push({ heading: section.heading, text });
      remaining = `${text.slice(-OVERLAP_CHARS)}\n${remaining.slice(cut)}`.trim();
    }
    if (remaining) chunks.push({ heading: section.heading, text: remaining });
  }
  return chunks.map((chunk, index) => ({ ...chunk, index }));
}
