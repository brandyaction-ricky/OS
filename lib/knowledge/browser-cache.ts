// 회사 문서 목록 브라우저 저장 (대표 결정 2026-11-02): a company PC keeps the last document list and 연결 map — titles, folders,
// dates and links, never bodies — so the knowledge screens ask the server only for what changed since and the map opens at once. One
// person's copy per browser; signing out clears it. Storage can be missing or refused (private window): every call then quietly does nothing.
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
      // Listeners, not onsuccess: a caller may already handle this request's success (writeKept puts after reading keys).
      request.addEventListener("success", () => resolve(request.result));
      request.addEventListener("error", () => reject(request.error));
    };
  });
}

// The sync time sits in localStorage beside the list so the next read can ask for changes at once, before the list is loaded.
const syncKey = (ownerId: string) => `brandyos:knowledge-synced:${ownerId}`;
export function keptSyncedAt(ownerId: string) {
  try { return typeof localStorage === "undefined" ? null : localStorage.getItem(syncKey(ownerId)); } catch { return null; }
}
const forgetSyncTimes = () => {
  try { if (typeof localStorage !== "undefined") for (const key of Object.keys(localStorage)) if (key.startsWith("brandyos:knowledge-synced:")) localStorage.removeItem(key); } catch { /* nothing kept */ }
};

/** What this browser keeps for a person: the document list and the 연결 map (titles, folders and links — never bodies). */
type KeptKind = "workspace" | "graph";
export async function readKept<T>(ownerId: string, kind: KeptKind): Promise<T | undefined> {
  try { return await withStore("readonly", store => store.get(`${ownerId}:${kind}`)) as T | undefined; } catch { return undefined; }
}
/** Keeps this person's copy and clears whatever anyone else left in this browser. */
export async function writeKept(ownerId: string, kind: KeptKind, value: unknown) {
  await withStore("readwrite", store => {
    const keys = store.getAllKeys();
    keys.addEventListener("success", () => { for (const key of keys.result) if (!String(key).startsWith(`${ownerId}:`)) store.delete(key); store.put(value, `${ownerId}:${kind}`); });
    return keys;
  });
}

export const readWorkspaceCache = (ownerId: string) => readKept<CachedWorkspace>(ownerId, "workspace");
export async function writeWorkspaceCache(ownerId: string, value: CachedWorkspace) {
  const kept = { ...value, documents: value.documents.map(doc => doc.content_md ? { ...doc, content_md: "" } : doc) };
  try {
    await writeKept(ownerId, "workspace", kept);
    forgetSyncTimes(); localStorage.setItem(syncKey(ownerId), value.syncedAt);
  } catch { forgetSyncTimes(); /* the next visit simply reads everything */ }
}
export async function clearWorkspaceCache() {
  forgetSyncTimes();
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
