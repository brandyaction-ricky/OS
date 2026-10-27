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

// The block editor reads Markdown as MDX, where any "<name" starts a JSX tag: "<작업>" or
// "<API 키>" in plain prose then fails the whole document ("Expected a closing tag"). Escape
// every "<" that does not open a real HTML tag or comment, outside code, so it reads as text.
const HTML_TAG = /^<\/?(?:a|abbr|audio|b|blockquote|br|caption|center|cite|code|col|colgroup|dd|del|details|div|dl|dt|em|figcaption|figure|font|h[1-6]|hr|i|iframe|img|ins|kbd|li|mark|ol|p|picture|pre|q|s|section|small|source|span|strong|sub|summary|sup|table|tbody|td|th|thead|tr|u|ul|video)(?=[\s/>])/i;
// JSX also needs void tags closed: "<br>" → "<br />".
const VOID_TAG = /<(br|hr|img|col|source)\b([^<>]*?)>/gi;
export function escapeLooseAngles(markdown: string): string {
  let fence = "";
  return markdown.split("\n").map(line => {
    const marker = line.match(/^\s{0,3}(`{3,}|~{3,})/)?.[1];
    if (fence) { if (marker && marker[0] === fence[0] && marker.length >= fence.length) fence = ""; return line; }
    if (marker) { fence = marker; return line; }
    // "<details><summary>…" on one line is read as inline JSX that never closes; split it.
    line = line.replace(/^(\s{0,3}<details\b[^<>]*>)(?=<summary)/i, "$1\n");
    return line.split(/(`+[^`]*`+)/).map((part, index) => index % 2 ? part
      : part.replace(/(\\?)<(?!!--)/g, (match, escaped, offset) => escaped || HTML_TAG.test(part.slice(offset + escaped.length)) ? match : "\\<")
        .replace(VOID_TAG, (_tag, name: string, rest: string) => `<${name}${rest.replace(/\s*\/?$/, "")} />`)).join("");
  }).join("\n");
}
