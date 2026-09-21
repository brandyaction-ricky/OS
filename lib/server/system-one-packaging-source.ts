import { createHash } from "node:crypto";
import { z } from "zod";

// Read-only, owner-visible package set. Empty is an observation, not completion.
export const SYSTEM_ONE_PACKAGING_FIELDS = "id,record_type,parent_id,owner_id,metadata,version,created_at,updated_at,archived_at";
const id = z.string().uuid().transform(value => value.toLowerCase());
const principalSchema = z.object({ id, type: z.literal("user"), active: z.literal(true), mustChangePassword: z.literal(false) }).strict();
const rowSchema = z.object({ id, record_type: z.literal("content_package"), parent_id: id, owner_id: id,
  metadata: z.record(z.unknown()), version: z.number().int().positive().max(2_147_483_647),
  created_at: z.string().datetime({ offset: true }), updated_at: z.string().datetime({ offset: true }), archived_at: z.null(),
}).strict();
export interface SystemOnePackagingDependencies {
  // Same human JWT/RLS; return ALL owner-visible active packages, up to 101.
  // The extra row detects overflow; never silently return a truncated set.
  authenticate(): Promise<{ principal: unknown; readPackages(sourceId: string): Promise<unknown> }>;
}
export async function loadSystemOnePackagingSet(sourceId: string, principalId: string, deps: SystemOnePackagingDependencies) {
  const stop = (code: "invalid_input" | "authentication_failed" | "unavailable" | "read_failed" | "invalid_metadata") => ({ status: "stopped" as const, code });
  if (!id.safeParse(sourceId).success || !id.safeParse(principalId).success) return stop("invalid_input");
  let session: Awaited<ReturnType<SystemOnePackagingDependencies["authenticate"]>>;
  try {
    session = await deps.authenticate();
    const principal = principalSchema.parse(session.principal);
    if (principal.id !== principalId) return stop("unavailable");
    if (typeof session.readPackages !== "function") return stop("authentication_failed");
  } catch { return stop("authentication_failed"); }
  let raw: unknown;
  try { raw = await session.readPackages(sourceId); } catch { return stop("read_failed"); }
  const parsed = z.array(rowSchema).max(100).safeParse(raw);
  if (!parsed.success) return stop("invalid_metadata");
  const rows = parsed.data;
  if (rows.some(row => row.parent_id !== sourceId || row.owner_id !== principalId)) return stop("unavailable");
  if (new Set(rows.map(row => row.id)).size !== rows.length) return stop("invalid_metadata");
  rows.sort((a, b) => a.id.localeCompare(b.id));
  let fingerprint: string;
  try {
    const serialized = JSON.stringify(rows);
    if (Buffer.byteLength(serialized, "utf8") > 240_000) return stop("invalid_metadata");
    fingerprint = createHash("sha256").update(serialized).digest("hex");
  } catch { return stop("invalid_metadata"); }
  return { status: "ready" as const, fingerprint,
    references: Object.freeze(rows.map(row => Object.freeze({ kind: "content_package" as const, id: row.id, version: row.version }))) };
}
