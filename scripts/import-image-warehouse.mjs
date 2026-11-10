import { readFile, writeFile, rename, rm } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { resolve } from "node:path";

// Import a reviewed export from the format warehouse. Existing entries omitted by a partial export are preserved.
const target = new URL("../lib/image-creative/warehouse-formats.json", import.meta.url);
const catalog = JSON.parse(await readFile(target, "utf8"));
const [sourceFile, mode = "--check"] = process.argv.slice(2);
if (!sourceFile || !["--check", "--write"].includes(mode)) {
  throw new Error("Usage: node scripts/import-image-warehouse.mjs <formats.json> [--check|--write]");
}
const batch = JSON.parse(await readFile(resolve(sourceFile), "utf8"));
if (!Array.isArray(batch.records) || !batch.records.length || !/^\d{4}-\d{2}-\d{2}$/.test(batch.version)) {
  throw new Error("Expected a dated warehouse export containing records.");
}
if (batch.version < catalog.sourceVersion) throw new Error("This export predates the checked-in warehouse.");
function required(value, name) {
  if (typeof value !== "string" || !value.trim()) throw new Error(`Missing ${name}`);
  return value.trim();
}
function publicUrl(value, name) {
  const url = new URL(required(value, name));
  if (url.protocol !== "https:" || url.username || url.password) throw new Error(`Invalid HTTPS ${name}`);
  return url.href;
}
const items = new Map(catalog.entries.map(row => [row.id, row]));
const received = new Set();
for (const row of batch.records) {
  const id = required(row.id, "id");
  const prefix = id[0];
  if (!/^[A-Z]\d{2,}$/.test(id) || !Object.hasOwn(catalog.chapterIds, prefix) || received.has(id)) {
    throw new Error(`Unknown or duplicate format ID: ${id}`);
  }
  received.add(id);
  items.set(id, {
    id, name: required(row.title, "title"), group: required(row.section, "section"),
    keep: required(row.keep, "keep"), slots: required(row.slots, "slots"),
    source: prefix === "M" ? "" : publicUrl(row.source, "source"),
    thumbnail: prefix === "M" ? "" : publicUrl(row.imageUrl, "imageUrl"),
  });
}
const next = { ...catalog, sourceVersion: batch.version, entries: [...items.values()] };
const unchanged = JSON.stringify(next) === JSON.stringify(catalog);
if (mode === "--check" && !unchanged) throw new Error("Catalog differs. Review the export, then run with --write.");
if (mode === "--write" && !unchanged) {
  const temp = new URL(`./warehouse-${randomUUID()}.tmp`, target);
  try {
    await writeFile(temp, JSON.stringify(next, null, 2) + "\n", { flag: "wx" });
    await rename(temp, target);
  } finally { await rm(temp, { force: true }); }
}
console.log(`${items.size} warehouse formats · ${received.size} in this export`);
