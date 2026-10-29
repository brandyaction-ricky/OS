import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { parseArgs } from "../tools/import-knowledge.mjs";

test("vault importer accepts a remote OS endpoint without exposing a service role key", () => {
  const parsed = parseArgs(["--root", "/vault", "--apply", "--endpoint", "https://os.example.com", "--token", "bos_pat_test"]);
  assert.equal(parsed.endpoint, "https://os.example.com");
  assert.equal(parsed.token, "bos_pat_test");
  assert.equal(parsed.apply, true);
});

test("vault changesets are authenticated, bounded and indexed", async () => {
  const source = await readFile(new URL("../app/api/v1/knowledge/sync/route.ts", import.meta.url), "utf8");
  assert.match(source, /requiredAgentScope: "knowledge\.write"/);
  assert.match(source, /actor\.role !== "admin"/);
  assert.match(source, /actor\.allowedStatuses/);
  assert.match(source, /\.max\(100\)/);
  assert.match(source, /contentHash/);
  assert.match(source, /counts\.queued \+= 1/, "synced documents are queued for the night indexing run");
  assert.doesNotMatch(source, /indexDocument\(/, "a bulk sync never embeds documents inside the request");
  assert.match(source, /os_update_document/);
});

test("search indexing runs at night only: saves queue, the night cron indexes one document at a time", async () => {
  const read = path => readFile(new URL(`../${path}`, import.meta.url), "utf8");
  for (const route of ["app/api/v1/documents/route.ts", "app/api/v1/documents/proposals/route.ts", "app/api/v1/knowledge-documents/route.ts", "app/api/v1/knowledge/graph/repair/route.ts", "app/api/v1/knowledge/sync/route.ts"])
    assert.doesNotMatch(await read(route), /indexDocument\(/, route);
  const night = await read("app/api/v1/indexing/night/route.ts");
  assert.match(night, /safeSecretMatch\(received, expected\)/);
  assert.match(night, /processEmbeddingQueue\(\{ limit: 100/);
  const vercel = JSON.parse(await read("vercel.json"));
  assert.ok(vercel.crons.some(cron => cron.path === "/api/v1/indexing/night" && cron.schedule === "0 16-20 * * *"), "01:00-05:00 KST every hour");
  assert.equal(vercel.functions["app/api/v1/indexing/night/route.ts"].maxDuration, 300);
  assert.match(await read("lib/server/indexing.ts"), /for \(const job of jobs \?\? \[\]\)/, "the queue is processed one document after another");
});
