import { createHash } from "node:crypto";
import { z } from "zod";

// Initial, owner-only topic adapter. Not wired to a route, model or approval.
// Content records and knowledge documents must never share an implicit ID type.
export const SYSTEM_ONE_CONTENT_FIELDS = "id,record_type,title,description,status,stage,brand,team,owner_id,source_url,metadata,version,updated_at,archived_at";
const uuid = z.string().uuid().transform((value) => value.toLowerCase());
const version = z.number().int().positive().max(2_147_483_647);
const selectionSchema = z.object({ kind: z.literal("content_topic"), id: uuid, expectedVersion: version }).strict();
const principalSchema = z.object({ id: uuid, type: z.literal("user"), active: z.literal(true), mustChangePassword: z.literal(false) }).strict();
const rowSchema = z.object({
  id: uuid, record_type: z.literal("content_topic"), title: z.string().trim().min(1).max(300),
  description: z.string().max(120_000), status: z.string().min(1).max(100), stage: z.string().max(300),
  brand: z.string().max(300), team: z.string().max(300), owner_id: uuid,
  source_url: z.string().max(4_000).nullable(), metadata: z.record(z.unknown()),
  version, updated_at: z.string().datetime({ offset: true }), archived_at: z.null(),
}).strict();
type Selection = z.infer<typeof selectionSchema>;
type Head = Readonly<{
  kind: "content_topic"; id: string; version: number; fingerprint: string;
  principalId: string; checkedAt: string; policyStatus: "unverified";
  judgment: null; executionAllowed: false;
}>;
type Code = "invalid_input" | "authentication_failed" | "unavailable" | "invalid_metadata" | "stale" | "read_failed";
type Result = { status: "ready"; head: Head } | { status: "stopped"; code: Code };
export interface SystemOneContentDependencies {
  // Fresh human Auth; readHead must use that same user's JWT/RLS, not service role.
  authenticate(): Promise<{ principal: unknown; readHead(id: string): Promise<unknown> }>;
  now?: () => Date;
}
const issued = new WeakMap<Head, Selection>();
const stop = (code: Code): Result => ({ status: "stopped", code });

async function read(selection: Selection, deps: SystemOneContentDependencies, previous?: Head): Promise<Result> {
  let session: Awaited<ReturnType<SystemOneContentDependencies["authenticate"]>>;
  let principal: z.infer<typeof principalSchema>;
  try {
    session = await deps.authenticate();
    principal = principalSchema.parse(session.principal);
    if (typeof session.readHead !== "function") return stop("authentication_failed");
  } catch { return stop("authentication_failed"); }
  if (previous && previous.principalId !== principal.id) return stop("unavailable");
  let raw: unknown;
  try { raw = await session.readHead(selection.id); } catch { return stop("read_failed"); }
  if (!raw) return stop("unavailable");
  const access = z.object({ id: uuid, owner_id: uuid.nullable(), archived_at: z.unknown() }).safeParse(raw);
  if (!access.success) return stop("invalid_metadata");
  if (access.data.id !== selection.id || access.data.owner_id !== principal.id || access.data.archived_at !== null) return stop("unavailable");
  const parsed = rowSchema.safeParse(raw);
  if (!parsed.success) return stop("invalid_metadata");
  const row = parsed.data;
  if (row.version !== selection.expectedVersion) return stop("stale");
  let fingerprint: string;
  let checkedAt: string;
  try {
    // Preserve all metadata until the domain projection is specified; never silently
    // truncate it. Hash changes conservatively invalidate the prior observation.
    const serialized = JSON.stringify(row);
    if (Buffer.byteLength(serialized, "utf8") > 120_000) return stop("invalid_metadata");
    fingerprint = createHash("sha256").update(serialized).digest("hex");
    checkedAt = (deps.now?.() ?? new Date()).toISOString();
  } catch { return stop("invalid_metadata"); }
  if (previous && previous.fingerprint !== fingerprint) return stop("stale");
  const head: Head = Object.freeze({ kind: "content_topic", id: row.id, version: row.version, fingerprint,
    principalId: principal.id, checkedAt, policyStatus: "unverified", judgment: null, executionAllowed: false });
  issued.set(head, selection);
  return { status: "ready", head };
}
export async function loadSystemOneContentHead(input: unknown, deps: SystemOneContentDependencies): Promise<Result> {
  const parsed = selectionSchema.safeParse(input);
  return parsed.success ? read(parsed.data, deps) : stop("invalid_input");
}
export async function recheckSystemOneContentHead(head: Head, deps: SystemOneContentDependencies): Promise<Result> {
  const selection = issued.get(head);
  return selection ? read(selection, deps, head) : stop("invalid_input");
}
