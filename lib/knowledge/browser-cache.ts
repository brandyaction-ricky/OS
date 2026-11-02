// 회사 문서 목록 브라우저 저장 (대표 결정 2026-11-02): a company PC keeps the last document list — titles, folders, dates, never
// bodies — so the knowledge screens open at once and ask the server only for what changed since. One person's list per browser;
// signing out clears it. Storage can be missing or refused (private window): every call then quietly does nothing.
import type { KnowledgeActor } from "./access";
import type { KnowledgeDocument } from "../types";

export interface CachedWorkspace { syncedAt: string; actor: KnowledgeActor; documents: KnowledgeDocument[] }
const DB_NAME = "brandyos", STORE = "knowledge";

/** Opens the store and places the requests in the same task, so the transaction is still active when they run. */
function withStore<T>(mode: IDBTransactionMode, place: (store: IDBObjectStore) => IDBRequest<T>) {
  return new Promise<T>((resolve, reject) => {
    if (typeof indexedDB === "undefined") return reject(new Error("no indexedDB"));
    const open = indexedDB.open(DB_NAME, 1);
    open.onupgradeneeded = () => open.result.createObjectStore(STORE);
    open.onerror = () => reject(open.error);
    open.onsuccess = () => {
      const request = place(open.result.transaction(STORE, mode).objectStore(STORE));
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    };
  });
}

export async function readWorkspaceCache(ownerId: string): Promise<CachedWorkspace | undefined> {
  try { return await withStore("readonly", store => store.get(ownerId)) as CachedWorkspace | undefined; } catch { return undefined; }
}
/** Keeps only this person's list: whoever used the browser before is cleared first. */
export async function writeWorkspaceCache(ownerId: string, value: CachedWorkspace) {
  const kept = { ...value, documents: value.documents.map(doc => doc.content_md ? { ...doc, content_md: "" } : doc) };
  try { await withStore("readwrite", store => { store.clear(); return store.put(kept, ownerId); }); } catch { /* the next visit simply reads everything */ }
}
export async function clearWorkspaceCache() {
  try { await withStore("readwrite", store => store.clear()); } catch { /* nothing kept */ }
}

/**
 * The kept list with the server's changes, in the server's order: documents no longer visible drop out, changed ones replace
 * theirs. null when a visible document is missing from the kept list (access granted to an older page) — then read everything.
 */
export function mergeWorkspaceDocuments(kept: KnowledgeDocument[], changed: KnowledgeDocument[], visibleIds: string[]) {
  const byId = new Map(kept.map(doc => [doc.id, doc]));
  for (const doc of changed) byId.set(doc.id, doc);
  const merged: KnowledgeDocument[] = [];
  for (const id of visibleIds) { const doc = byId.get(id); if (!doc) return null; merged.push(doc); }
  return merged;
}
