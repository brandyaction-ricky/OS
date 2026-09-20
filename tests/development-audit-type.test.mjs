import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("development requests have a distinct audit subject without changing stored record contracts", async () => {
  const [route, labels, workspace, requests] = await Promise.all([
    read("app/api/v1/audit/route.ts"), read("lib/audit-labels.ts"), read("components/audit-workspace.tsx"), read("lib/development-requests.ts"),
  ]);
  assert.match(route, /metadata\?\.kind === "development_request" \? "development_request"/);
  assert.match(route, /os_records\(title,record_type,metadata\)/);
  assert.match(labels, /development_request: "개발 요청"/);
  assert.match(workspace, /event\.subject_type !== recordType/);
  assert.match(requests, /record\?\.record_type === "ai_job"/);
  assert.doesNotMatch(route, /update\(|insert\(/);
});
