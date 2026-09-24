import { createHmac } from "node:crypto";
import { resolvePlanningReferences } from "@/lib/server/system-one-planning";
import { loadSystemOneContentBundle, type SystemOneContentBundleDependencies } from "@/lib/server/system-one-content-bundle";
import { recheckSystemOneContentHead } from "@/lib/server/system-one-content-source";
import { loadSystemOneProductionDocumentSet, recheckSystemOneDocumentBundle } from "@/lib/server/system-one-document-source";
import { readProductionLinks } from "@/lib/content-production-links";

// Session-scoped equality markers, NOT authorization tokens or approvals.
// Reuse only with the same authenticated session; never persist them.
export async function readReviewContext(input: unknown, registry: { id: string; expectedVersion: number }, deps: SystemOneContentBundleDependencies, sessionKey: string) {
  const resolved = await resolvePlanningReferences(input, registry, deps);
  if (resolved.status === "stopped") return resolved;
  const links = readProductionLinks(resolved.content.productionDocumentLinks);
  if (!links || links.some(link => link.sourceVersion > resolved.content.version)) return { status: "stopped", code: "invalid_linked_documents" } as const;
  const production = links.length ? await loadSystemOneProductionDocumentSet(links.map(link => link.documentId), deps.documents) : null;
  if (production?.status === "stopped") return { status: "stopped", code: "linked_documents_unavailable" } as const;
  if (production && production.bundle.principal.id !== resolved.content.principalId) return { status: "stopped", code: "unavailable" } as const;
  const bundled = await loadSystemOneContentBundle({
    content: { kind: "content_topic", id: resolved.content.id, expectedVersion: resolved.content.version },
    registry: { kind: "knowledge_document", ...registry },
    criteria: resolved.references.map(ref => ({ kind: "knowledge_document", id: ref.id, expectedVersion: ref.version,
      requestedRole: ref.role, requestedSection: ref.scope })), packaging: "owner-visible-set",
  }, deps);
  if (bundled.status === "stopped") return bundled;
  const content = await recheckSystemOneContentHead(resolved.content, deps.content);
  if (content.status === "stopped") return content;
  const documents = await recheckSystemOneDocumentBundle(resolved.documents, deps.documents);
  if (documents.status === "stopped") return documents;
  if (production) {
    const latest = await recheckSystemOneDocumentBundle(production.bundle, deps.documents);
    if (latest.status === "stopped") return { status: "stopped", code: "linked_documents_unavailable" } as const;
  }
  const marker = (scope: string, value: string) => createHmac("sha256", sessionKey).update(scope + ":" + value).digest("hex");
  const productionHeads = production ? [production.bundle.source, ...production.bundle.criteria] : [];
  const linkedDocuments = productionHeads.map((document, index) => ({
    id: document.id, title: document.title, role: links[index].role, version: document.current_version,
    linkedVersion: links[index].documentVersion, linkedSourceVersion: links[index].sourceVersion,
    marker: marker("production-document", document.fingerprint),
  }));
  return { status: "ready", policyStatus: "unverified", judgment: null, executionAllowed: false,
    source: { id: content.head.id, version: content.head.version },
    registryVersion: documents.bundle.source.current_version, referenceCount: bundled.snapshot.criteria.length,
    packageCount: bundled.snapshot.packaging!.length,
    linkedDocuments,
    markers: { source: marker("source", content.head.fingerprint), criteria: marker("criteria", documents.bundle.fingerprint),
      bundle: marker("bundle", JSON.stringify([bundled.snapshot.fingerprint, production?.bundle.fingerprint ?? null])) },
  } as const;
}
