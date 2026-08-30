import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (file) => readFile(new URL(`../${file}`, import.meta.url), "utf8");

test("local content snapshot import is admin-only, idempotent and preserves approval gates", async () => {
  const [route, workspace, client] = await Promise.all([
    read("app/api/v1/content/import/route.ts"),
    read("components/content-automation-workspace.tsx"),
    read("lib/api-client.ts"),
  ]);
  assert.match(route, /actor\.role !== "admin"/);
  assert.match(route, /metadata->>importSource/);
  assert.match(route, /legacyId/);
  assert.match(route, /finalApprovalRequired: true/);
  assert.match(route, /normalizedPublishStatus/);
  assert.match(workspace, /로컬 자료 가져오기/);
  assert.match(client, /importContentSnapshot/);
  assert.doesNotMatch(route, /googleapis|uploadType: "resumable"|fetch\([^)]*youtube/i);
});
