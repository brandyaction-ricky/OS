import { createHash } from "node:crypto";
import { z } from "zod";
import { loadSystemOneContentHead, recheckSystemOneContentHead, type SystemOneContentDependencies } from "@/lib/server/system-one-content-source";
import { loadSystemOneDocumentBundle, type SystemOneDocumentDependencies } from "@/lib/server/system-one-document-source";

// Internal, read-only observation contract. Requested roles/sections are NOT
// qualified policies: a server-owned registry resolver must establish them later.
export const SYSTEM_ONE_CONTENT_CONTRACT = "content-reference-observation-v1";
const id = z.string().uuid().transform((value) => value.toLowerCase());
const version = z.number().int().positive().max(2_147_483_647);
const documentRef = z.object({ kind: z.literal("knowledge_document"), id, expectedVersion: version }).strict();
const criterionRef = documentRef.extend({
  requestedRole: z.string().regex(/^[a-z][a-z0-9]*(?:[.-][a-z0-9]+)+$/).max(100),
  requestedSection: z.string().trim().min(1).max(500),
}).strict();
const selectionSchema = z.object({
  content: z.object({ kind: z.literal("content_topic"), id, expectedVersion: version }).strict(),
  registry: documentRef,
  criteria: z.array(criterionRef).min(1).max(10),
}).strict().refine((input) => {
  const ids = [input.registry.id, ...input.criteria.map((item) => item.id)];
  const roles = input.criteria.map((item) => item.requestedRole);
  return new Set(ids).size === ids.length && new Set(roles).size === roles.length;
});
type Selection = z.infer<typeof selectionSchema>;
type Reference = Readonly<{ kind: "knowledge_document"; id: string; version: number }>;
type Snapshot = Readonly<{
  contractVersion: typeof SYSTEM_ONE_CONTENT_CONTRACT;
  content: Readonly<{ kind: "content_topic"; id: string; version: number }>;
  registry: Reference;
  criteria: readonly Readonly<Reference & { requestedRole: string; requestedSection: string }>[];
  fingerprint: string;
  policyStatus: "unverified";
  judgment: null;
  executionAllowed: false;
}>;
type Code = "invalid_input" | "authentication_failed" | "unavailable" | "invalid_metadata" | "stale" | "read_failed";
type Result = { status: "ready"; snapshot: Snapshot } | { status: "stopped"; code: Code };
export type SystemOneContentBundleDependencies = {
  content: SystemOneContentDependencies;
  documents: SystemOneDocumentDependencies;
};
// Only server-issued process-local objects can be rechecked. Fingerprints are
// not signatures, persistent approvals, or an atomic cross-table transaction.
const issued = new WeakMap<Snapshot, Selection>();
const stop = (code: Code): Result => ({ status: "stopped", code });

export async function loadSystemOneContentBundle(input: unknown, deps: SystemOneContentBundleDependencies): Promise<Result> {
  const parsed = selectionSchema.safeParse(input);
  if (!parsed.success) return stop("invalid_input");
  const selection = parsed.data;
  const content = await loadSystemOneContentHead(selection.content, deps.content);
  if (content.status === "stopped") return content;
  const documents = await loadSystemOneDocumentBundle({
    source: { id: selection.registry.id, expectedVersion: selection.registry.expectedVersion },
    criteria: selection.criteria.map(({ id, expectedVersion }) => ({ id, expectedVersion })),
  }, deps.documents);
  if (documents.status === "stopped") return documents;
  if (content.head.principalId !== documents.bundle.principal.id) return stop("unavailable");
  // Catch material/auth changes observed while the documents were being read.
  // This is still a point-in-time observation, not continuing authorization.
  const latestContent = await recheckSystemOneContentHead(content.head, deps.content);
  if (latestContent.status === "stopped") return latestContent;
  const registry = Object.freeze({ kind: "knowledge_document" as const, id: documents.bundle.source.id,
    version: documents.bundle.source.current_version });
  const criteria = Object.freeze(documents.bundle.criteria.map((document, index) => Object.freeze({
    kind: "knowledge_document" as const, id: document.id, version: document.current_version,
    requestedRole: selection.criteria[index].requestedRole, requestedSection: selection.criteria[index].requestedSection,
  })));
  const fingerprint = createHash("sha256").update(JSON.stringify([
    SYSTEM_ONE_CONTENT_CONTRACT, content.head.fingerprint, documents.bundle.fingerprint,
    criteria.map(({ requestedRole, requestedSection }) => [requestedRole, requestedSection]),
  ])).digest("hex");
  const snapshot: Snapshot = Object.freeze({ contractVersion: SYSTEM_ONE_CONTENT_CONTRACT,
    content: Object.freeze({ kind: "content_topic", id: content.head.id, version: content.head.version }),
    registry, criteria, fingerprint, policyStatus: "unverified", judgment: null, executionAllowed: false });
  issued.set(snapshot, selection);
  return { status: "ready", snapshot };
}

export async function recheckSystemOneContentBundle(snapshot: Snapshot, deps: SystemOneContentBundleDependencies): Promise<Result> {
  const selection = issued.get(snapshot);
  if (!selection) return stop("invalid_input");
  const result = await loadSystemOneContentBundle(selection, deps);
  if (result.status === "stopped") return result;
  return result.snapshot.fingerprint === snapshot.fingerprint ? result : stop("stale");
}
