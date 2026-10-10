import { normalizeKnowledgeFolder } from "./knowledge-folders";
import type { KnowledgeDocument } from "./types";

export const vaultFolderKey = (path: string) => `folder:${path}`;
export function matchesVaultName(value: string, query: string) {
  const normalized = value.normalize("NFC").toLocaleLowerCase("ko-KR");
  const needle = query.normalize("NFC").trim().toLocaleLowerCase("ko-KR");
  if (!needle || normalized.includes(needle)) return true;
  const initials = [...normalized].map(char => {
    const index = char.charCodeAt(0) - 0xac00;
    return index >= 0 && index < 11172 ? "ㄱㄲㄴㄷㄸㄹㅁㅂㅃㅅㅆㅇㅈㅉㅊㅋㅌㅍㅎ"[Math.floor(index / 588)] : char;
  }).join("");
  return initials.includes(needle);
}
export function newVaultFolder(parent: string, name: string, existing: string[]) {
  if (!name.trim() || /[/\\]/.test(name)) throw Error("경로 구분자 없이 폴더 이름을 입력해 주세요.");
  const path = normalizeKnowledgeFolder(parent ? `${parent}/${name.trim()}` : name.trim());
  if (existing.includes(path)) throw Error("같은 위치에 같은 이름의 폴더가 있습니다.");
  return path;
}
export function readVaultStorage<T>(key: string, fallback: T, valid: (value: unknown) => value is T): T {
  try { const value: unknown = JSON.parse(window.localStorage.getItem(key) ?? "null"); return valid(value) ? value : fallback; } catch { return fallback; }
}
export function writeVaultStorage(key: string, value: unknown) {
  try { if (value === null) window.localStorage.removeItem(key); else window.localStorage.setItem(key, JSON.stringify(value)); return true; } catch { return false; }
}
export const isStringArray = (value: unknown): value is string[] => Array.isArray(value) && value.every(item => typeof item === "string");
export function selectedVaultDocuments(documents: KnowledgeDocument[], keys: Set<string>) {
  const folders = [...keys].filter(key => key.startsWith("folder:")).map(key => key.slice(7));
  return documents.filter(item => keys.has(item.id) || folders.some(path => item.folder === path || item.folder.startsWith(`${path}/`)));
}
export function canEditVaultDocument(document: KnowledgeDocument, profile?: { id: string; role: string } | null) {
  return ["draft", "team"].includes(document.status) && Boolean(profile && (document.owner_id === profile.id || profile.role === "admin"));
}
