import { createHmac } from "node:crypto";
import { resolvePlanningReferences } from "@/lib/server/system-one-planning";
import { loadSystemOneContentBundle, type SystemOneContentBundleDependencies } from "@/lib/server/system-one-content-bundle";
import { recheckSystemOneContentHead } from "@/lib/server/system-one-content-source";
import { recheckSystemOneDocumentBundle } from "@/lib/server/system-one-document-source";

// Session-scoped equality markers, NOT authorization tokens or approvals.
// Reuse only with the same authenticated session; never persist them.
export async function readReviewContext(input: unknown, registry: { id: string; expectedVersion: number }, deps: SystemOneContentBundleDependencies, sessionKey: string) {
  const resolved = await resolvePlanningReferences(input, registry, deps);
  if (resolved.status === "stopped") return resolved;
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
  const marker = (scope: string, value: string) => createHmac("sha256", sessionKey).update(scope + ":" + value).digest("hex");
  return { status: "ready", policyStatus: "unverified", judgment: null, executionAllowed: false,
    source: { id: content.head.id, version: content.head.version },
    registryVersion: documents.bundle.source.current_version, referenceCount: bundled.snapshot.criteria.length,
    packageCount: bundled.snapshot.packaging!.length,
    markers: { source: marker("source", content.head.fingerprint), criteria: marker("criteria", documents.bundle.fingerprint),
      bundle: marker("bundle", bundled.snapshot.fingerprint) },
  } as const;
}
