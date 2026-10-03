export interface KnowledgeToggle { title: string; body: string }

const OPEN = /^:::toggle\{title=("(?:\\.|[^"\\])*")\}\s*$/;

export function knowledgeToggleMarkdown(title = "토글 제목", body = "내용을 입력하세요.") {
  return `:::toggle{title=${JSON.stringify(title)}}\n${body}\n:::`;
}

export function parseKnowledgeToggle(block: string): KnowledgeToggle | null {
  const lines = block.trim().split("\n");
  const match = lines[0]?.match(OPEN);
  if (!match || lines.at(-1)?.trim() !== ":::") return null;
  try {
    const title = JSON.parse(match[1]);
    if (typeof title !== "string" || title.length > 200) return null;
    return { title, body: lines.slice(1, -1).join("\n") };
  } catch { return null; }
}
