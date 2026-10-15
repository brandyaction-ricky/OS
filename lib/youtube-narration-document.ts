/**
 * Temporary bridge until the content-flow project publishes its approved-script
 * contract: a person approves a knowledge script document by setting its OS status
 * (os_set_document_status, audited) to reviewed or canonical, and the automation
 * reads that exact version. File names are never treated as approval.
 */
export const APPROVED_SCRIPT_STATUSES = ["reviewed", "canonical"] as const;

/** Keep only the spoken paragraphs of a markdown script document. */
export function narrationFromMarkdown(markdown: string) {
  const body = markdown.replace(/\r\n?/g, "\n").replace(/^---\n[\s\S]*?\n---\n/, "").replace(/<!--[\s\S]*?-->/g, "");
  const kept = body.split("\n").map((line) => line.trim()).map((line) => {
    if (/^(#{1,6}\s|[-*_]{3,}$|\||```)/.test(line)) return "";
    return line.replace(/^>\s?/, "").replace(/^(?:[-*+]|\d+[.)])\s+/, "")
      .replace(/\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g, (_, target, alias) => alias ?? target)
      .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1").replace(/(\*\*|__|\*|_|`)(?=\S)([^*_`]+?)\1/g, "$2");
  });
  return kept.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}
