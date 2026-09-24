import { z } from "zod";
import { loadSystemOneDocumentBundle, loadSystemOneRegistryHead, type SystemOneDocumentDependencies } from "@/lib/server/system-one-document-source";

const uuid = z.string().uuid().transform((value) => value.toLowerCase());
const version = z.number().int().positive().max(2_147_483_647);
const role = z.string().regex(/^[a-z][a-z0-9]*(?:[.-][a-z0-9]+)+$/).max(100);
const rolesSchema = z.array(role).min(1).max(10).refine((roles) => new Set(roles).size === roles.length);
const rowSchema = z.object({ role, id: uuid, scope: z.string().trim().min(1).max(500) }).strict();
type Entry = Readonly<z.infer<typeof rowSchema>>;

// Parse only the current role registry section and its exact table, never old
// aliases/history/prose matches. A format change requires review, not guessing.
export function parseSystemOneRegistry(markdown: string): readonly Entry[] | null {
  if (Buffer.byteLength(markdown, "utf8") > 120_000) return null;
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
  const starts = lines.flatMap((line, index) => line.trim() === "### 9-2. 역할 → 원문 등록부" ? [index] : []);
  if (starts.length !== 1) return null;
  const start = starts[0] + 1;
  const boundary = lines.findIndex((line, index) => index >= start && /^#{1,3}\s/.test(line));
  const section = lines.slice(start, boundary < 0 ? undefined : boundary);
  if (section.some((line) => /```|~~~/.test(line))) return null;
  const header = "| 역할키 | 대상 doc_id | 담당 범위 | 검색 별칭·옛 이름 |";
  const headers = section.flatMap((line, index) => line.trim() === header ? [index] : []);
  if (headers.length !== 1) return null;
  const table = headers[0];
  if (!/^\|\s*:?-+:?\s*\|\s*:?-+:?\s*\|\s*:?-+:?\s*\|\s*:?-+:?\s*\|$/.test(section[table + 1]?.trim() ?? "")) return null;
  const entries: Entry[] = [];
  for (let index = table + 2; index < section.length; index++) {
    const line = section[index].trim();
    if (!line.startsWith("|")) {
      // A second or interrupted table cannot silently hide a role.
      if (section.slice(index).some((later) => later.trim().startsWith("|"))) return null;
      break;
    }
    const cells = line.split("|");
    if (cells.length !== 6 || cells[0] !== "" || cells[5] !== "") return null;
    const key = cells[1].trim().match(/^`([^`]+)`$/)?.[1];
    const target = cells[2].trim().match(/^`([^`]+)`$/)?.[1];
    const parsed = rowSchema.safeParse({ role: key, id: target, scope: cells[3].trim() });
    if (!parsed.success || entries.some((entry) => entry.role === parsed.data.role)) return null;
    entries.push(Object.freeze(parsed.data));
    if (entries.length > 200) return null;
  }
  return entries.length ? Object.freeze(entries) : null;
}

// trustedRegistry is supplied by server configuration, NEVER by a browser or
// model. This function resolves IDs; it does not choose a brand/stage or grant
// scope approval. Canonical status alone is not business applicability.
export async function resolveSystemOneRegistryRoles(
  trustedRegistry: { id: string; expectedVersion: number },
  requestedRoles: unknown,
  dependencies: SystemOneDocumentDependencies,
) {
  const roles = rolesSchema.safeParse(requestedRoles);
  if (!roles.success) return { status: "stopped", code: "invalid_input" } as const;
  const registry = await loadSystemOneRegistryHead(trustedRegistry, dependencies);
  if (registry.status === "stopped") return registry;
  if (registry.bundle.source.status !== "canonical") return { status: "stopped", code: "approval_required" } as const;
  const entries = parseSystemOneRegistry(registry.bundle.source.content_md);
  if (!entries) return { status: "stopped", code: "invalid_registry" } as const;
  const resolved = roles.data.map((role) => entries.find((entry) => entry.role === role));
  if (resolved.some((entry) => !entry)) return { status: "stopped", code: "missing_role" } as const;
  const selected = resolved as Entry[];
  const ids = selected.map((entry) => entry.id);
  if (new Set(ids).size !== ids.length || ids.includes(registry.bundle.source.id)) {
    return { status: "stopped", code: "ambiguous_mapping" } as const;
  }
  let session: Awaited<ReturnType<SystemOneDocumentDependencies["authenticate"]>>;
  try {
    session = await dependencies.authenticate();
    const principal = z.object({ id: uuid }).safeParse(session.principal);
    if (!principal.success || principal.data.id !== registry.bundle.principal.id) return { status: "stopped", code: "authentication_failed" } as const;
  } catch { return { status: "stopped", code: "authentication_failed" } as const; }
  let raw: unknown;
  try { raw = await session.readHeads(ids); } catch { return { status: "stopped", code: "read_failed" } as const; }
  const heads = z.array(z.object({ id: uuid, current_version: version })).safeParse(raw);
  if (!heads.success || heads.data.length !== ids.length || new Set(heads.data.map((head) => head.id)).size !== ids.length ||
    heads.data.some((head) => !ids.includes(head.id))) return { status: "stopped", code: "unavailable" } as const;
  const criteria = ids.map((id) => ({ id, expectedVersion: heads.data.find((head) => head.id === id)!.current_version }));
  // Validate full rows, access, versions and hashes together with the registry.
  const documents = await loadSystemOneDocumentBundle({ source: trustedRegistry, criteria }, dependencies);
  if (documents.status === "stopped") return documents;
  if (documents.bundle.principal.id !== registry.bundle.principal.id) return { status: "stopped", code: "authentication_failed" } as const;
  if (documents.bundle.source.fingerprint !== registry.bundle.source.fingerprint) return { status: "stopped", code: "stale" } as const;
  if (documents.bundle.criteria.some((document) => document.status !== "canonical")) return { status: "stopped", code: "approval_required" } as const;
  return Object.freeze({ status: "resolved" as const, mappingStatus: "registry_verified" as const,
    policyStatus: "unverified" as const, executionAllowed: false as const,
    references: Object.freeze(selected.map((entry, index) => Object.freeze({ ...entry, version: criteria[index].expectedVersion }))),
    documents: documents.bundle });
}
