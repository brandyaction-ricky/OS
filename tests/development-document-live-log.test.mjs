import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("a linked project document reads live development state without mutating canonical markdown", async () => {
  const [route, liveLog, knowledge] = await Promise.all([
    read("app/api/v1/development-project-log/route.ts"),
    read("components/development-document-live-log.tsx"),
    read("components/knowledge-workspace.tsx"),
  ]);
  assert.ok(route.indexOf("authenticateRequest(request)") < route.indexOf('.from("os_records")'));
  assert.match(route, /metadata->>developmentDocumentId/);
  assert.match(route, /development_log/);
  assert.match(route, /deployment/);
  assert.doesNotMatch(route, /\.insert\(|\.update\(|\.delete\(|\.rpc\(/);
  assert.match(liveLog, /development-project-log\?documentId=/);
  assert.match(liveLog, /window\.setInterval\(refresh, 60_000\)/);
  assert.match(liveLog, /정본 본문은 보존/);
  assert.match(knowledge, /<DevelopmentDocumentLiveLog token=\{accessToken\} documentId=\{selected\.id\} demo=\{demo\}/);
});

test("project connections accept one canonical development document ID and expose it from the development workspace", async () => {
  const workspace = await read("components/project-hub-workspace.tsx");
  assert.match(workspace, /projectEdit/);
  assert.match(workspace, /developmentDocumentId/);
  assert.match(workspace, /updateRecord/);
  assert.match(workspace, /프로젝트 정본 문서/);
  assert.match(workspace, /프로젝트 정본/);
  assert.match(workspace, /문서 본문은 자동 수정하지 않습니다/);
});
