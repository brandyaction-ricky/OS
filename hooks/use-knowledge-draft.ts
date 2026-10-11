"use client";
import { useEffect, useState } from "react";
import { readVaultStorage, writeVaultStorage } from "@/lib/knowledge-vault-interactions";
import type { KnowledgeDocument } from "@/lib/types";
import { documentDraft, draftChanged, rebaseKnowledgeDraft, type KnowledgeDraft } from "@/lib/knowledge-workspace-state";

type StoredDraft = { draft: KnowledgeDraft; baseline: KnowledgeDraft; baseVersion: number; savedAt: string; account: string };
function isStoredDraft(value: unknown): value is StoredDraft {
  if (!value || typeof value !== "object") return false;
  const row = value as StoredDraft;
  return typeof row.account === "string" && Number.isInteger(row.baseVersion) && typeof row.savedAt === "string" && [row.draft, row.baseline].every(draft => draft && ["title", "content", "folder", "team", "brand", "tags"].every(key => typeof draft[key as keyof KnowledgeDraft] === "string"));
}
export function useKnowledgeDraft(document: KnowledgeDocument | null, persistence?: { account: string; enabled: boolean }) {
  const [entries, setEntries] = useState<Record<string, { draft: KnowledgeDraft; baseline: KnowledgeDraft; version: number }>>({});
  const [recovery, setRecovery] = useState<{ id: string; value: StoredDraft } | null>(null);
  const id = document?.id, loaded = document?.content_md !== undefined;
  const account = persistence?.account, enabled = persistence?.enabled;
  useEffect(() => { setEntries({}); setRecovery(null); }, [account]);
  useEffect(() => {
    setRecovery(null);
    if (!id || !loaded || !enabled || !account) return;
    const value = readVaultStorage<StoredDraft | null>(`brandy-vault-v2-draft:${id}`, null, (row): row is StoredDraft | null => row === null || isStoredDraft(row));
    if (value?.account === account) setRecovery({ id, value });
  }, [id, loaded, enabled, account]);
  const entry = document ? entries[document.id] : undefined;
  const baseline = document?.content_md !== undefined ? documentDraft(document) : null;
  const draft = entry?.draft ?? baseline;
  const dirty = Boolean(entry && draftChanged(entry.draft, entry.baseline));
  useEffect(() => {
    if (!id || !entry || !dirty || !enabled || !account) return;
    const timer = window.setTimeout(() => writeVaultStorage(`brandy-vault-v2-draft:${id}`, { draft: entry.draft, baseline: entry.baseline, baseVersion: entry.version, savedAt: new Date().toISOString(), account }), 1500);
    return () => window.clearTimeout(timer);
  }, [id, entry, dirty, enabled, account]);
  const setDraft = (value: KnowledgeDraft) => {
    if (!document || !baseline) return;
    if (enabled && !draftChanged(value, entries[document.id]?.baseline ?? baseline)) writeVaultStorage(`brandy-vault-v2-draft:${document.id}`, null);
    setEntries(current => {
      const original = current[document.id]?.baseline ?? baseline;
      const next = { ...current };
      if (!draftChanged(value, original)) delete next[document.id];
      else next[document.id] = { baseline: original, version: current[document.id]?.version ?? document.current_version, draft: value };
      return next;
    });
  };
  const discard = (id = document?.id) => { if (id) { setEntries(current => { const next = { ...current }; delete next[id]; return next; }); if (enabled) writeVaultStorage(`brandy-vault-v2-draft:${id}`, null); setRecovery(null); } };
  const resume = () => {
    if (!recovery || recovery.id !== document?.id) return;
    const value = recovery.value;
    setEntries(current => ({ ...current, [recovery.id]: { draft: value.draft, baseline: value.baseline, version: value.baseVersion } }));
    setRecovery(null);
  };
  const rebase = (latest: KnowledgeDocument) => {
    if (!draft) return;
    setEntries(current => {
      const latestDraft = documentDraft(latest);
      const original = current[latest.id]?.baseline ?? latestDraft;
      return {...current, [latest.id]: {draft: rebaseKnowledgeDraft(draft, original, latestDraft), baseline: latestDraft, version: latest.current_version}};
    });
  };
  return { rebase, draft, setDraft, dirty, discard, recovery, resume, expectedVersion: entry?.version ?? document?.current_version };
}
