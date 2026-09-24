export function normalizeKnowledgeFolder(raw: string) {
  const path = raw.trim().replace(/\\/g, "/").replace(/\/{2,}/g, "/").replace(/^\/+|\/+$/g, "").split("/").map(part => part.trim()).join("/").normalize("NFC");
  if (!path) throw new Error("저장할 폴더를 선택해 주세요.");
  if (path.length > 160) throw new Error("폴더 경로는 160자 이하로 입력해 주세요.");
  const parts = path.split("/");
  if (parts.some((part) => !part || part === "." || part === ".." || /[\u0000-\u001f]/.test(part))) {
    throw new Error("폴더 이름에는 빈 경로, 마침표 경로, 줄바꿈을 사용할 수 없습니다.");
  }
  return path;
}

export type FolderMove = { id: string; title: string; from: string; to: string; version: number };
export function planFolderMove(documents: Array<{id: string; title: string; folder: string; current_version: number}>, source: string, destination: string): FolderMove[] {
  const from = normalizeKnowledgeFolder(source);
  const to = normalizeKnowledgeFolder(destination);
  if (from === to) throw new Error("현재 위치와 다른 이름이나 상위 폴더를 선택해 주세요.");
  if (to.startsWith(`${from}/`)) throw new Error("자기 하위 폴더로 이동할 수 없습니다.");
  return documents.filter(item => item.folder === from || item.folder.startsWith(`${from}/`)).map(item => ({ id: item.id, title: item.title, from: item.folder, to: renameKnowledgeFolderPath(item.folder, from, to), version: item.current_version }));
}

export async function executeFolderMoves<T>(moves: FolderMove[], update: (move: FolderMove) => Promise<T>, onProgress: (done: number) => void) {
  const succeeded: T[] = [];
  const failed: Array<{move: FolderMove; message: string}> = [];
  for (const move of moves) {
    try { succeeded.push(await update(move)); }
    catch (reason) { failed.push({ move, message: reason instanceof Error ? reason.message : "이동하지 못했습니다." }); }
    onProgress(succeeded.length + failed.length);
  }
  return { succeeded, failed };
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
