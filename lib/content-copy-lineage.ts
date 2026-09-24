import { z } from "zod";
import type { OsRecord } from "./record-types";

const url = z.string().url().max(2_000).refine(value => new URL(value).protocol === "https:", "HTTPS 주소만 사용할 수 있습니다.");
export const copyDecisionInput = z.object({
  kind: z.literal("decision"), sourceId: z.string().uuid(), expectedSourceVersion: z.number().int().positive(),
  decisionAt: z.string().date(), evidenceUrl: url,
  title: z.string().trim().max(300), thumbnailCopy: z.string().trim().min(1).max(500),
  note: z.string().trim().max(1_000),
}).strict();
export const publicationObservationInput = z.object({
  kind: z.literal("publication"), sourceId: z.string().uuid(), expectedSourceVersion: z.number().int().positive(),
  observedAt: z.string().date(), videoUrl: url,
  title: z.string().trim().min(1).max(300), thumbnailCopy: z.string().trim().min(1).max(500),
  note: z.string().trim().max(1_000),
}).strict();
export const copyLineageInput = z.discriminatedUnion("kind", [copyDecisionInput, publicationObservationInput]);

const decisionMetadata = z.object({
  packageKind: z.literal("copy_decision_evidence"), schemaVersion: z.literal(1),
  decisionAt: z.string().date(), evidenceUrl: url,
  title: z.string().max(300), thumbnailCopy: z.string().min(1).max(500), note: z.string().max(1_000),
  verification: z.literal("user_entered"),
}).passthrough();
const publicationMetadata = z.object({
  packageKind: z.literal("publication_copy_observation"), schemaVersion: z.literal(1),
  observedAt: z.string().date(), videoUrl: url,
  title: z.string().min(1).max(300), thumbnailCopy: z.string().min(1).max(500), note: z.string().max(1_000),
  verification: z.literal("user_entered"),
}).passthrough();

function latest<T>(rows: OsRecord[], schema: z.ZodType<T>) {
  if (!rows.length) return { state: "missing" as const, record: null, data: null };
  if (rows.some(row => !Number.isFinite(Date.parse(row.created_at)) || !Number.isSafeInteger(row.version) || row.version < 1))
    return { state: "invalid" as const, record: null, data: null };
  const ordered = [...rows].sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at) || b.id.localeCompare(a.id));
  if (ordered[1] && Date.parse(ordered[0].created_at) === Date.parse(ordered[1].created_at))
    return { state: "ambiguous" as const, record: null, data: null };
  const parsed = schema.safeParse(ordered[0].metadata);
  if (!parsed.success) return { state: "invalid" as const, record: null, data: null };
  return { state: "loaded" as const, record: ordered[0], data: parsed.data };
}

const spacing = (value: string) => value.replace(/\s+/g, " ").trim();

// The snapshots are user-entered evidence, not verified publication receipts or approval.
// Never infer approval from a picked package or status from a missing snapshot.
export function copyLineage(sourceId: string, ownerId: string | null, records: OsRecord[], team = "") {
  const children = ownerId ? records.filter(row => row.parent_id === sourceId && row.record_type === "content_package" && !row.archived_at &&
    (row.owner_id === ownerId || (team.trim() && row.team === team && row.owner_id === row.created_by))) : [];
  // A teammate may submit a historical decision source, but cannot replace the
  // topic owner's comparison input merely by appending a newer row.
  const ownerDecisions = children.filter(row => row.owner_id === ownerId && row.metadata?.packageKind === "copy_decision_evidence");
  const pendingDecisions = children.filter(row => row.owner_id !== ownerId && row.metadata?.packageKind === "copy_decision_evidence")
    .flatMap(row => { const parsed = decisionMetadata.safeParse(row.metadata); return parsed.success ? [{ record: row, data: parsed.data }] : []; })
    .sort((a, b) => Date.parse(b.record.created_at) - Date.parse(a.record.created_at) || b.record.id.localeCompare(a.record.id));
  const decision = latest(ownerDecisions, decisionMetadata);
  const publication = latest(children.filter(row => row.metadata?.packageKind === "publication_copy_observation"), publicationMetadata);
  if (decision.state !== "loaded" || publication.state !== "loaded" || !decision.data || !publication.data)
    return { state: "unverified" as const, decision, publication, pendingDecisions, title: "unverified" as const, thumbnailCopy: "unverified" as const };
  const compare = (left: string, right: string) => left === right ? "same" as const : spacing(left) === spacing(right) ? "formatting_only" as const : "different" as const;
  const title = decision.data.title ? compare(decision.data.title, publication.data.title) : "unverified" as const;
  const thumbnailCopy = compare(decision.data.thumbnailCopy, publication.data.thumbnailCopy);
  return { state: title === "different" || thumbnailCopy === "different" ? "different" as const :
    title === "formatting_only" || thumbnailCopy === "formatting_only" ? "formatting_only" as const :
    title === "unverified" ? "partial" as const : "same" as const,
    decision, publication, pendingDecisions, title, thumbnailCopy };
}
