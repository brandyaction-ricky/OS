export function safeMarkdownUrl(raw: string, image = false): string | null {
  const url = raw.trim().replace(/^<|>$/g, "");
  if (!url || /[\u0000-\u0020\u007f]/.test(url) || url.includes("\\")) return null;
  if (/^https?:\/\//i.test(url)) {
    try {
      const parsed = new URL(url);
      if (parsed.username || parsed.password) return null;
      // Document links stay in the current environment (local, Preview or Production).
      if (!image && parsed.hostname === "brandyaction-os.vercel.app" && parsed.pathname === "/knowledge") return `${parsed.pathname}${parsed.search}${parsed.hash}`;
      return url;
    } catch { return null; }
  }
  if (!image && (/^mailto:[^<>]+$/i.test(url) || /^\/(?!\/)/.test(url) || /^#[^\s]*$/.test(url))) return url;
  return null;
}

export type MarkdownInlineToken = { type: "text" | "code" | "bold" | "wiki" | "image" | "link"; text: string; target?: string };
export function markdownInlineTokens(text: string): MarkdownInlineToken[] {
  const tokens: MarkdownInlineToken[] = [];
  const pattern = /`([^`]+)`|!\[\[([^\]]+)\]\]|\[\[([^\]]+)\]\]|(!?)\[([^\]]*)\]\((<[^>]+>|(?:[^\s()]+|\([^()]*\))+)(?:\s+"[^"]*")?\)|\*\*([^*]+)\*\*/g;
  let cursor = 0;
  for (const match of text.matchAll(pattern)) {
    if (match.index! > cursor) tokens.push({ type: "text", text: text.slice(cursor, match.index) });
    if (match[1]) tokens.push({ type: "code", text: match[1] });
    else if (match[2]) { const [target, alt] = match[2].split("|"); tokens.push({ type: "image", text: alt || target, target }); }
    else if (match[3]) { const [target, ...alias] = match[3].split("|"); tokens.push({ type: "wiki", text: alias.join("|") || target.replace(/\.md$/i, ""), target }); }
    else if (match[6]) tokens.push({ type: match[4] ? "image" : "link", text: match[5], target: match[6].replace(/^<|>$/g, "") });
    else tokens.push({ type: "bold", text: match[7] });
    cursor = match.index! + match[0].length;
  }
  if (cursor < text.length) tokens.push({ type: "text", text: text.slice(cursor) });
  return tokens;
}
