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
  assert.match(source, /\.max\(100\)/);
  assert.match(source, /contentHash/);
  assert.match(source, /indexDocument\(documentId\)/);
  assert.match(source, /os_update_document/);
});
