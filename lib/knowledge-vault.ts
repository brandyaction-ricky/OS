// Folder shortcuts are not documents or categories. Existing paths are never remapped.
export const PERSONAL_VAULT_ROOTS = [
  "00_Skills", "01_Raw", "02_Wiki", "03_Content", "04_개인", "05_Projects", "06_학습",
] as const;

export function stableWikiLink(document: { id: string; title: string }) {
  const label = document.title.replace(/[\[\]|\r\n]/g, " ").trim();
  return `[[${document.id}|${label || document.id}]]`;
}
