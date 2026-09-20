import { createHash } from "node:crypto";
import { z } from "zod";

// Server-side preflight only. No route, persistence, model call, or conversion to
// MockInput/state="current". A readable DB head is NOT a verified company policy.
export const SYSTEM_ONE_DOCUMENT_FIELDS = "id,title,content_md,status,owner_id,team,brand,folder,current_version,content_hash,updated_at";
export const SYSTEM_ONE_DOCUMENT_LIMITS = Object.freeze({ bodyBytes: 120_000, bundleBytes: 512_000 });

const uuid = z.string().uuid().transform((id) => id.toLowerCase());
const referenceSchema = z.object({ id: uuid, expectedVersion: z.number().int().positive().max(2_147_483_647) }).strict();
const selectionSchema = z.object({
  source: referenceSchema,
  criteria: z.array(referenceSchema).min(1).max(10),
}).strict().refine((value) => {
  const ids = [value.source.id, ...value.criteria.map((item) => item.id)];
  return new Set(ids).size === ids.length;
});
const principalSchema = z.object({
  type: z.literal("user"), id: uuid, role: z.enum(["member", "lead", "admin"]),
  team: z.string().max(300), active: z.literal(true), mustChangePassword: z.literal(false),
}).strict();
const rowSchema = z.object({
  id: uuid, title: z.string().min(1).max(300), content_md: z.string().min(1).max(120_000),
  status: z.enum(["draft", "team", "review", "reviewed", "canonical", "archived"]),
  owner_id: uuid, team: z.string().max(300), brand: z.string().max(300).nullable(),
  folder: z.string().max(2_000), current_version: z.number().int().positive().max(2_147_483_647),
  content_hash: z.string().regex(/^[a-f0-9]{32}$/), updated_at: z.string().datetime({ offset: true }),
}).strict();

type Selection = z.infer<typeof selectionSchema>;
type Principal = Readonly<z.infer<typeof principalSchema>>;
type DocumentRow = z.infer<typeof rowSchema>;
type DocumentHead = Readonly<DocumentRow & { state: "head_verified"; fingerprint: string }>;
export type SystemOneDocumentBundle = Readonly<{
  source: DocumentHead;
  criteria: readonly DocumentHead[];
  principal: Principal;
  checkedAt: string;
  fingerprint: string;
  policyStatus: "unverified";
}>;

export interface SystemOneDocumentDependencies {
  // Authenticate afresh on EVERY call. The returned reader must be bound to that
  // human's JWT and RLS, never a service-role client. Do not cache this session.
  authenticate: () => Promise<{
    principal: unknown;
    readHeads: (ids: readonly string[]) => Promise<unknown>;
  }>;
  now?: () => Date;
}

type StopCode = "invalid_input" | "authentication_failed" | "unavailable" | "invalid_metadata" | "stale" | "read_failed";
type Stopped = Readonly<{ status: "stopped"; code: StopCode }>;
export type SystemOneDocumentResult = Readonly<{ status: "ready"; bundle: SystemOneDocumentBundle }> | Stopped;
const stop = (code: StopCode): Stopped => Object.freeze({ status: "stopped", code });
const digest = (value: string, algorithm = "sha256") => createHash(algorithm).update(value, "utf8").digest("hex");

// Process-local handles only: JSON/client-supplied or reconstructed snapshots may
// not be used as a freshness proof. Future durable results need an authenticated,
// atomic server-side storage protocol; these hashes are not signatures.
const issuedBundles = new WeakMap<SystemOneDocumentBundle, Selection>();

function mayRead(principal: Principal, row: DocumentRow) {
  if (row.status === "archived") return false;
  if (principal.role === "admin" || row.owner_id === principal.id) return true;
  if (row.status === "draft") return false;
  if (row.status === "team") return row.team === "" || row.team === principal.team || principal.role === "lead";
  return true;
}

function snapshot(row: DocumentRow): DocumentHead {
  // All read fields, including policy/access metadata, participate. content_hash
  // in the existing database is only body MD5, not an access/version proof.
  const fingerprint = digest(JSON.stringify([
    row.id, row.current_version, row.title, row.content_hash, digest(row.content_md),
    row.status, row.owner_id, row.team, row.brand, row.folder, row.updated_at,
  ]));
  return Object.freeze({ ...row, state: "head_verified", fingerprint });
}

async function readBundle(
  selection: Selection,
  dependencies: SystemOneDocumentDependencies,
  previous?: SystemOneDocumentBundle,
): Promise<SystemOneDocumentResult> {
  let session: Awaited<ReturnType<SystemOneDocumentDependencies["authenticate"]>>;
  let principal: Principal;
  try {
    session = await dependencies.authenticate();
    const parsed = principalSchema.safeParse(session.principal);
    if (!parsed.success || typeof session.readHeads !== "function") return stop("authentication_failed");
    principal = Object.freeze(parsed.data);
  } catch {
    // Never return tokens, database messages, titles, or partial document bodies.
    return stop("authentication_failed");
  }
  if (previous && principal.id !== previous.principal.id) return stop("unavailable");
  const references = [selection.source, ...selection.criteria];
  const ids = references.map((reference) => reference.id);
  let raw: unknown;
  try {
    raw = await session.readHeads(Object.freeze(ids));
  } catch {
    return stop("read_failed");
  }
  if (!Array.isArray(raw) || raw.length !== ids.length) return stop("unavailable");
  const parsedIds = z.array(z.object({ id: uuid })).safeParse(raw);
  if (!parsedIds.success) return stop("invalid_metadata");
  const returnedIds = parsedIds.data.map((row) => row.id);
  if (new Set(returnedIds).size !== ids.length || returnedIds.some((id) => !ids.includes(id))) return stop("unavailable");

  const parsedRows = z.array(rowSchema).safeParse(raw);
  if (!parsedRows.success) return stop("invalid_metadata");
  const rows = parsedRows.data;
  if (rows.some((row) => !mayRead(principal, row))) return stop("unavailable");
  let bytes = 0;
  for (const row of rows) {
    const bodyBytes = Buffer.byteLength(row.content_md, "utf8");
    bytes += bodyBytes;
    if (!row.title.trim() || !row.content_md.trim() || bodyBytes > SYSTEM_ONE_DOCUMENT_LIMITS.bodyBytes ||
      bytes > SYSTEM_ONE_DOCUMENT_LIMITS.bundleBytes || digest(row.content_md, "md5") !== row.content_hash ||
      !Number.isFinite(Date.parse(row.updated_at))) return stop("invalid_metadata");
  }
  const byId = new Map(rows.map((row) => [row.id, row]));
  const ordered = references.map((reference) => byId.get(reference.id)!);
  if (ordered.some((row, index) => row.current_version !== references[index].expectedVersion)) return stop("stale");
  const [source, ...criteria] = ordered.map(snapshot);
  const fingerprint = digest(JSON.stringify([
    principal.id, principal.role, principal.team, source.fingerprint, criteria.map((row) => row.fingerprint),
  ]));
  if (previous && fingerprint !== previous.fingerprint) return stop("stale");
  let checkedAt: string;
  try {
    checkedAt = (dependencies.now?.() ?? new Date()).toISOString();
  } catch {
    return stop("invalid_metadata");
  }
  const bundle: SystemOneDocumentBundle = Object.freeze({
    source, criteria: Object.freeze(criteria), principal, checkedAt, fingerprint, policyStatus: "unverified",
  });
  issuedBundles.set(bundle, selection);
  return Object.freeze({ status: "ready", bundle });
}

export async function loadSystemOneDocumentBundle(
  selection: unknown, dependencies: SystemOneDocumentDependencies,
): Promise<SystemOneDocumentResult> {
  const parsed = selectionSchema.safeParse(selection);
  if (!parsed.success) return stop("invalid_input");
  return readBundle(parsed.data, dependencies);
}

export async function recheckSystemOneDocumentBundle(
  previous: SystemOneDocumentBundle, dependencies: SystemOneDocumentDependencies,
): Promise<SystemOneDocumentResult> {
  const selection = issuedBundles.get(previous);
  if (!selection) return stop("invalid_input");
  return readBundle(selection, dependencies, previous);
}

// A successful read is a point-in-time preflight, not continuing authorization.
// Re-read before any future display/decision. Auth/profile and SELECT are separate
// statements; a future write must validate version/access atomically at commit.
