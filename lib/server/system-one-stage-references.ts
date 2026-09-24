import { z } from "zod";
import { loadSystemOneContentHead, recheckSystemOneContentHead, type SystemOneContentDependencies } from "@/lib/server/system-one-content-source";
import { recheckSystemOneDocumentBundle, type SystemOneDocumentDependencies } from "@/lib/server/system-one-document-source";
import { resolveSystemOneRegistryRoles } from "@/lib/server/system-one-registry";

const inputSchema = z.object({
  id: z.string().uuid(), expectedVersion: z.number().int().positive().max(2_147_483_647),
  stage: z.enum(["packaging", "writing"]),
}).strict();

// Entry-point routing only, NOT a list of all mandatory criteria. Procedure
// dependencies, format exceptions and approvals must still be resolved separately.
const entryRoles = { packaging: "youtube.packaging", writing: "youtube.writing" } as const;

export async function readStageReferences(input: unknown, registry: { id: string; expectedVersion: number },
  deps: { content: SystemOneContentDependencies; documents: SystemOneDocumentDependencies }) {
  const parsed = inputSchema.safeParse(input);
  if (!parsed.success) return { status: "stopped", code: "invalid_input" } as const;
  const { id, expectedVersion, stage } = parsed.data;
  const source = await loadSystemOneContentHead({ kind: "content_topic", id, expectedVersion }, deps.content);
  if (source.status === "stopped") return source;
  if (source.head.brand !== "브랜디액션") return { status: "stopped", code: "unsupported_context" } as const;
  const references = await resolveSystemOneRegistryRoles(registry, [entryRoles[stage]], deps.documents);
  if (references.status === "stopped") return references;
  if (references.documents.principal.id !== source.head.principalId) return { status: "stopped", code: "unavailable" } as const;
  const currentSource = await recheckSystemOneContentHead(source.head, deps.content);
  if (currentSource.status === "stopped") return currentSource;
  const currentDocuments = await recheckSystemOneDocumentBundle(references.documents, deps.documents);
  if (currentDocuments.status === "stopped") return currentDocuments;
  const document = currentDocuments.bundle.criteria[0];
  return {
    status: "ready", stage, source: { id: currentSource.head.id, version: currentSource.head.version },
    registryVersion: currentDocuments.bundle.source.current_version,
    entryDocument: { role: entryRoles[stage], id: document.id, title: document.title, version: document.current_version },
    dependenciesStatus: "unresolved", approvalStatus: "unverified",
    policyStatus: "unverified", judgment: null, executionAllowed: false,
  } as const;
}
