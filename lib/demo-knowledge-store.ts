import { DEMO_DOCUMENTS } from "./demo-data";
import type { DocumentStatus, KnowledgeDocument } from "./types";

// Demo-only browser memory. No production content or credentials enter storage.
let documents = DEMO_DOCUMENTS;
type DemoEvent = {id: string; to_status: DocumentStatus; note: string; created_at: string};
const events = new Map<string, DemoEvent[]>();
export function getDemoKnowledgeDocuments() { return documents; }
export function saveDemoKnowledgeDocument(document: KnowledgeDocument) {
  documents = [document, ...documents.filter(item => item.id !== document.id)];
}
export function addDemoKnowledgeEvent(document: KnowledgeDocument, note = "") {
  events.set(document.id, [{ id: `${document.id}-${Date.now()}`, to_status: document.status, note, created_at: document.updated_at }, ...(events.get(document.id) ?? [])]);
}
export function getDemoKnowledgeEvents(id: string) { return events.get(id) ?? []; }
