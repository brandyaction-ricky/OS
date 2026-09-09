export interface MarkdownSection { title: string; level: number; body: string; children: MarkdownSection[] }

export function markdownSections(content: string) {
  const root: MarkdownSection = { title: "", level: 0, body: "", children: [] };
  const stack = [root];
  let fence = "";
  for (const line of content.split("\n")) {
    const marker = line.match(/^\s{0,3}(`{3,}|~{3,})/);
    if (marker) {
      if (!fence) fence = marker[1];
      else if (marker[1][0] === fence[0] && marker[1].length >= fence.length) fence = "";
      stack.at(-1)!.body += `${line}\n`;
      continue;
    }
    const heading = !fence && line.match(/^(#{1,6})\s+(.+?)(?:\s+#+)?\s*$/);
    if (heading) {
      while (stack.length > 1 && stack.at(-1)!.level >= heading[1].length) stack.pop();
      const section: MarkdownSection = { title: heading[2], level: heading[1].length, body: "", children: [] };
      stack.at(-1)!.children.push(section); stack.push(section);
    } else stack.at(-1)!.body += `${line}\n`;
  }
  return root;
}

export function markdownBlocks(content: string) {
  const blocks: string[] = []; let block: string[] = []; let fence = "";
  const flush = () => { if (block.length) blocks.push(block.join("\n")); block = []; };
  for (const line of content.split("\n")) {
    const marker = line.match(/^\s{0,3}(`{3,}|~{3,})/);
    if (marker) {
      if (!fence) { flush(); fence = marker[1]; block.push(line); }
      else { block.push(line); if (marker[1][0] === fence[0] && marker[1].length >= fence.length) { fence = ""; flush(); } }
    } else if (!fence && !line.trim()) flush();
    else block.push(line);
  }
  flush(); return blocks;
}

export function treeWidth(value: number) { return Number.isFinite(value) ? Math.max(220, Math.min(460, Math.round(value))) : 280; }

export function markdownCodeBody(block: string) {
  const lines = block.split("\n");
  const opening = lines[0]?.trim().match(/^(`{3,}|~{3,})/);
  if (!opening) return block;
  const closing = lines.at(-1)?.trim();
  const closed = closing && closing.length >= opening[1].length && [...closing].every((char) => char === opening[1][0]);
  return lines.slice(1, closed ? -1 : undefined).join("\n");
}

export function insertTag(content: string, caret: number, tag: string) {
  const prefix = content.slice(0, caret); const match = prefix.match(/(^|\s)#([^\s#]*)$/u);
  if (!match || !/^[\p{L}\p{N}_/-]+$/u.test(tag)) return { content, caret };
  const start = caret - match[2].length - 1; const replacement = `#${tag} `;
  return { content: content.slice(0, start) + replacement + content.slice(caret), caret: start + replacement.length };
}
