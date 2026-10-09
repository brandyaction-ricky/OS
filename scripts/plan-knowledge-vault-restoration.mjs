// Offline only: reads an authorized snapshot and writes a private plan. No DB/API writes.
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { resolve, join } from "node:path";
import { createHash } from "node:crypto";
import { planVaultRestoration } from "../lib/knowledge-vault-restoration.ts";

const [inputPath, outputDirectory] = process.argv.slice(2);
if (!inputPath || !outputDirectory) throw new Error("Usage: node scripts/plan-knowledge-vault-restoration.mjs <authorized-snapshot.json> <private-output-directory>");
const snapshotText = await readFile(resolve(inputPath), "utf8");
const snapshot = JSON.parse(snapshotText);
const documents = snapshot.docs ?? snapshot.documents;
if (!Array.isArray(documents) || documents.some(doc => !doc.id || !doc.owner_id || typeof doc.folder !== "string" || !Number.isInteger(doc.current_version))) {
  throw new Error("Invalid document snapshot. Do not substitute inferred ownership or versions.");
}
const plan = planVaultRestoration(documents);
const directory = resolve(outputDirectory);
await mkdir(directory, {recursive:true, mode:0o700});
const report = {
  generatedAt: new Date().toISOString(), mode:"offline-plan-only", snapshotSha256:createHash("sha256").update(snapshotText).digest("hex"),
  inspected:documents.length, changes:plan.changes.length, unchanged:plan.unchanged,
  held:plan.held.reduce((counts,row) => ({...counts,[row.reason]:(counts[row.reason]??0)+1}),{}),
  invariants:["id", "owner_id", "created_by", "title", "content_md", "source_ref", "status", "category_id", "versions", "access permissions"],
  requiredBeforeApply:["current production snapshot and target approval", "per-row version/folder/source-ref comparison", "reversible transaction and before-image", "canonical proposal policy review", "same-ID link and permission verification"],
};
await writeFile(join(directory,"folder-restoration-plan.json"),JSON.stringify({...report,plan},null,2),{flag:"wx",mode:0o600});
await writeFile(join(directory,"folder-restoration-summary.json"),JSON.stringify(report,null,2),{flag:"wx",mode:0o600});
// Never print internal document IDs, original content, or employee data.
console.log(JSON.stringify({inspected:report.inspected,changes:report.changes,unchanged:report.unchanged,held:report.held,mode:report.mode}));
