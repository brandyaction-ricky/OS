"use client";
import { useState } from "react";
import type { KnowledgeDocument } from "@/lib/types";
import { documentDraft, draftChanged, rebaseKnowledgeDraft, type KnowledgeDraft } from "@/lib/knowledge-workspace-state";

export function useKnowledgeDraft(document: KnowledgeDocument | null) {
  const [entries, setEntries] = useState<Record<string, { draft: KnowledgeDraft; baseline: KnowledgeDraft; version: number }>>({});
  const entry = document ? entries[document.id] : undefined;
  const baseline = document?.content_md !== undefined ? documentDraft(document) : null;
  const draft = entry?.draft ?? baseline;
  const dirty = Boolean(entry && draftChanged(entry.draft, entry.baseline));
  const setDraft = (value: KnowledgeDraft) => {
    if (!document || !baseline) return;
    setEntries(current => {
      const original = current[document.id]?.baseline ?? baseline;
      const next = { ...current };
      if (!draftChanged(value, original)) delete next[document.id];
      else next[document.id] = { baseline: original, version: current[document.id]?.version ?? document.current_version, draft: value };
      return next;
    });
  };
  const discard = (id = document?.id) => { if (id) setEntries(current => { const next = { ...current }; delete next[id]; return next; }); };
  const rebase = (latest: KnowledgeDocument) => {
    if (!draft) return;
    setEntries(current => {
      const latestDraft = documentDraft(latest);
      const original = current[latest.id]?.baseline ?? latestDraft;
      return {...current, [latest.id]: {draft: rebaseKnowledgeDraft(draft, original, latestDraft), baseline: latestDraft, version: latest.current_version}};
    });
  };
  return { rebase, draft, setDraft, dirty, discard, expectedVersion: entry?.version ?? document?.current_version };
}
