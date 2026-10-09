import { PERSONAL_VAULT_ROOTS } from "./knowledge-vault.ts";

interface VaultRecord {
  id: string; owner_id: string; folder: string; source_ref?: string | null;
  current_version: number; status: string; parent_document_id?: string | null;
}

/** Read-only planning. Callers must supply an authorized snapshot, never a guessed owner. */
export function planVaultRestoration(documents: VaultRecord[]) {
  const sourceFolder = (doc: VaultRecord) => {
    const path = doc.source_ref?.normalize("NFC").replace(/\\/g, "/").replace(/^\.\//, "") ?? "";
    const parts = path.split("/");
    if (!(PERSONAL_VAULT_ROOTS as readonly string[]).includes(parts[0]) || parts.length < 2 ||
      !/\.md$/i.test(parts.at(-1)!) || parts.some(p => !p || p === "." || p === "..") || /[\u0000-\u001f]/.test(path)) return null;
    const folder = parts.slice(0, -1).join("/");
    return folder.length <= 160 ? { path, folder } : null;
  };
  const sources = new Map(documents.map(doc => [doc.id, sourceFolder(doc)]));
  const sourceCounts = new Map<string, number>();
  for (const doc of documents) {
    const source = sources.get(doc.id);
    if (source && doc.status !== "archived") {
      const key = `${doc.owner_id}:${source.path}`;
      sourceCounts.set(key, (sourceCounts.get(key) ?? 0) + 1);
    }
  }
  const changes: { id: string; expectedVersion: number; from: string; to: string; sourceRef: string }[] = [];
  const held: { id: string; reason: "missing-original-path" | "duplicate-original-path" | "parent-conflict" }[] = [];
  let unchanged = 0;
  for (const doc of documents) {
    if (doc.status === "archived") continue;
    const source = sources.get(doc.id);
    if (!source) { held.push({id: doc.id, reason: "missing-original-path"}); continue; }
    if (sourceCounts.get(`${doc.owner_id}:${source.path}`)! > 1) { held.push({id: doc.id, reason: "duplicate-original-path"}); continue; }
    if (doc.parent_document_id) {
      const parent = documents.find(row => row.id === doc.parent_document_id);
      const parentSource = parent && sources.get(parent.id);
      if (!parent || parent.status === "archived" || !parentSource || parent.folder !== source.folder || parentSource.folder !== source.folder || parent.owner_id !== doc.owner_id) {
        held.push({id: doc.id, reason: "parent-conflict"}); continue;
      }
    }
    if (doc.folder === source.folder) { unchanged++; continue; }
    changes.push({id: doc.id, expectedVersion: doc.current_version, from: doc.folder, to: source.folder, sourceRef: doc.source_ref!});
  }
  return { changes, held, unchanged };
}
