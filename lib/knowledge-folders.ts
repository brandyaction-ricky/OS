export function normalizeKnowledgeFolder(raw: string) {
  const path = raw.trim().replace(/\\/g, "/").replace(/\/{2,}/g, "/").replace(/^\/+|\/+$/g, "");
  if (!path) throw new Error("저장할 폴더를 선택해 주세요.");
  if (path.length > 160) throw new Error("폴더 경로는 160자 이하로 입력해 주세요.");
  const parts = path.split("/");
  if (parts.some((part) => !part || part === "." || part === ".." || /[\u0000-\u001f]/.test(part))) {
    throw new Error("폴더 이름에는 빈 경로, 마침표 경로, 줄바꿈을 사용할 수 없습니다.");
  }
  return path;
}

export function knowledgeFolderOptions(paths: string[]) {
  const options = new Set<string>();
  for (const raw of paths) {
    let path: string;
    try { path = normalizeKnowledgeFolder(raw); } catch { continue; }
    const parts = path.split("/");
    for (let index = 1; index <= parts.length; index += 1) options.add(parts.slice(0, index).join("/"));
  }
  return [...options].sort((a, b) => a.localeCompare(b, "ko", { numeric: true }));
}

export function renameKnowledgeFolderPath(path: string, from: string, to: string) {
  const current = normalizeKnowledgeFolder(path);
  const source = normalizeKnowledgeFolder(from);
  const target = normalizeKnowledgeFolder(to);
  if (current !== source && !current.startsWith(`${source}/`)) return current;
  const suffix = current.slice(source.length);
  return normalizeKnowledgeFolder(`${target}${suffix}`);
}
