import { DEMO_DOCUMENTS } from "./demo-data";
import type { DocumentStatus, DocumentVersion, KnowledgeDocument } from "./types";

// Demo-only browser memory. No production content or credentials enter storage.
let documents = DEMO_DOCUMENTS;
type DemoEvent = {id: string; to_status: DocumentStatus; note: string; created_at: string};
const versions = new Map<string, DocumentVersion[]>();
function asVersion(document: KnowledgeDocument): DocumentVersion { return {version_no: document.current_version, title: document.title, content_md: document.content_md, author_id: document.owner_id, author_name: "데모 사용자", reason: "로컬 데모 변경", created_at: document.updated_at}; }
export function getDemoKnowledgeVersions(id: string) { const current = documents.find(row => row.id === id); return versions.get(id) ?? (current ? [asVersion(current)] : []); }
const events = new Map<string, DemoEvent[]>();
export function getDemoKnowledgeDocuments() { return documents; }
export function saveDemoKnowledgeDocument(document: KnowledgeDocument) {
  const previous = documents.find(row => row.id === document.id);
  const history = getDemoKnowledgeVersions(document.id);
  if (!previous || previous.current_version !== document.current_version) versions.set(document.id, [asVersion(document), ...history]);
  documents = [document, ...documents.filter(item => item.id !== document.id)];
}
export function addDemoKnowledgeEvent(document: KnowledgeDocument, note = "") {
  events.set(document.id, [{ id: `${document.id}-${Date.now()}`, to_status: document.status, note, created_at: document.updated_at }, ...(events.get(document.id) ?? [])]);
}
export function getDemoKnowledgeEvents(id: string) { return events.get(id) ?? []; }
