import { z } from "zod";
import { loadSystemOneContentHead, recheckSystemOneContentHead } from "@/lib/server/system-one-content-source";
import { recheckSystemOneDocumentBundle } from "@/lib/server/system-one-document-source";
import { resolveSystemOneRegistryRoles } from "@/lib/server/system-one-registry";
import type { SystemOneContentBundleDependencies } from "@/lib/server/system-one-content-bundle";

const inputSchema = z.object({ id: z.string().uuid(), expectedVersion: z.number().int().positive().max(2_147_483_647) }).strict();
export function planningRegistryConfig(env: Readonly<Record<string, string | undefined>>) {
  const parsed = inputSchema.safeParse({ id: env.SYSTEM_ONE_REGISTRY_DOCUMENT_ID,
    expectedVersion: Number(env.SYSTEM_ONE_REGISTRY_DOCUMENT_VERSION) });
  return parsed.success ? parsed.data : null;
}

// Conditional references remain references, not mandatory business rules.
export function planningEntryRoles(markdown: string): string[] | null {
  let fence = "";
  const lines = markdown.replace(/\r\n/g, "\n").split("\n").map((line) => {
    const marker = line.match(/^ {0,3}(`{3,}|~{3,})/)?.[1];
    if (fence) {
      if (marker && marker[0] === fence[0] && marker.length >= fence.length && line.trim() === marker) fence = "";
      return "";
    }
    if (marker) { fence = marker; return ""; }
    return line;
  });
  if (fence) return null;
  const starts = lines.flatMap((line, index) => line === "## 0. 기획 진입 계약" ? [index] : []);
  if (starts.length !== 1) return null;
  const start = starts[0] + 1;
  const end = lines.findIndex((line, index) => index >= start && /^#{1,2}\s/.test(line));
  const section = lines.slice(start, end < 0 ? undefined : end).join("\n");
  if (/```|~~~/.test(section) || section.length > 12_000) return null;
  const roles = [...new Set([...section.matchAll(/`OS_ROLE: ([a-z][a-z0-9]*(?:[.-][a-z0-9]+)+)`/g)].map((match) => match[1]))];
  return roles.length > 0 && roles.length <= 9 ? roles : null;
}

export async function checkPlanningReferences(input: unknown, registry: { id: string; expectedVersion: number }, deps: SystemOneContentBundleDependencies) {
  const parsed = inputSchema.safeParse(input);
  if (!parsed.success) return { status: "stopped", code: "invalid_input" } as const;
  const content = await loadSystemOneContentHead({ kind: "content_topic", ...parsed.data }, deps.content);
  if (content.status === "stopped") return content;
  if (content.head.brand !== "브랜디액션") return { status: "stopped", code: "unsupported_context" } as const;
  const entry = await resolveSystemOneRegistryRoles(registry, ["youtube.planning"], deps.documents);
  if (entry.status === "stopped") return entry;
  if (entry.documents.principal.id !== content.head.principalId) return { status: "stopped", code: "unavailable" } as const;
  const roles = planningEntryRoles(entry.documents.criteria[0].content_md);
  if (!roles) return { status: "stopped", code: "invalid_entry_contract" } as const;
  const references = await resolveSystemOneRegistryRoles(registry, [...new Set(["youtube.planning", ...roles])], deps.documents);
  if (references.status === "stopped") return references;
  if (references.documents.principal.id !== content.head.principalId) return { status: "stopped", code: "unavailable" } as const;
  if (references.documents.source.fingerprint !== entry.documents.source.fingerprint ||
    references.documents.criteria[0].fingerprint !== entry.documents.criteria[0].fingerprint) return { status: "stopped", code: "stale" } as const;
  const latestContent = await recheckSystemOneContentHead(content.head, deps.content);
  if (latestContent.status === "stopped") return latestContent;
  const latestDocuments = await recheckSystemOneDocumentBundle(references.documents, deps.documents);
  if (latestDocuments.status === "stopped") return latestDocuments;
  // Safe projection: no body/identity/hash or policy qualification. These
  // SELECTs are not an atomic cross-table transaction or persistent approval.
  return { status: "ready", policyStatus: "unverified", judgment: null, executionAllowed: false,
    source: { id: content.head.id, version: content.head.version },
    registryVersion: latestDocuments.bundle.source.current_version,
    referenceCount: references.references.length,
  } as const;
}
