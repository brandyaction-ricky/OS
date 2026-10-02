#!/usr/bin/env node
// Offline review only: no database connection, network, or apply mode.
import { readFile, writeFile } from "node:fs/promises";
import { decodeHtmlEntities } from "../lib/html-entities.ts";
const args = process.argv.slice(2);
if (args.includes("--apply")) throw new Error("This tool never applies changes. Review the exported plan and obtain a separate data-change approval.");
const inputIndex = args.indexOf("--input");
const planIndex = args.indexOf("--plan");
if (inputIndex < 0 || !args[inputIndex + 1]) throw new Error("Usage: node tools/content-hygiene.mjs --input export.json [--plan review.json]");
const payload = JSON.parse(await readFile(args[inputIndex + 1], "utf8"));
const records = Array.isArray(payload) ? payload : payload.records;
if (!Array.isArray(records)) throw new Error("The input must contain a records array.");
const changes = [];
let tests = 0, titles = 0;
for (const record of records) {
  if (typeof record.title !== "string" || typeof record.id !== "string") continue;
  const patch = {};
  if (/\[(?:테스트|QA테스트|운영검수|E2E)\]/i.test(record.title) && record.metadata?.origin !== "test") {
    patch.metadata = { ...(record.metadata ?? {}), origin: "test" }; tests++;
  }
  const title = decodeHtmlEntities(record.title);
  if (title !== record.title) { patch.title = title; titles++; }
  if (Object.keys(patch).length) changes.push({ id: record.id, expectedVersion: record.version, patch });
}
// Default output contains counts only, never record contents or identifiers.
if (planIndex >= 0) {
  if (!args[planIndex + 1]) throw new Error("A review file path is required.");
  await writeFile(args[planIndex + 1], JSON.stringify({ dryRun: true, changes }, null, 2), { flag: "wx", mode: 0o600 });
}
console.log(JSON.stringify({ dryRun: true, scanned: records.length, testCandidates: tests, entityTitles: titles, changes: changes.length, planWritten: planIndex >= 0 }));
