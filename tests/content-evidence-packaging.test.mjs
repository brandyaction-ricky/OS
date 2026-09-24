import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8");

test("packaging evidence is DEV-gated and reuses the script evidence ledger for the selected topic", () => {
  const route = read("../app/(os)/[stage]/[page]/page.tsx");
  const packagePage = read("../components/content-packaging-workspace.tsx");
  const linked = read("../components/content-planning-handoff.tsx");

  assert.match(route, /const contentEvidenceEnabled = canUseSystemOneContentEvidence\(process\.env\)/);
  assert.match(route, /ContentPackageWorkspace showContentEvidence=\{contentEvidenceEnabled\}/);
  assert.match(packagePage, /showContentEvidence\s*\?\s*\[\.\.\.BASE_PACKAGE_TABS/);
  assert.match(packagePage, /sourceIdOverride=\{sourceId\} showEvidence packagingStage/);
  assert.match(packagePage, /key=\{`packaging-evidence:\$\{sourceId\}`\}/);
  assert.match(linked, /const sourceId = sourceIdOverride \?\? urlSourceId/);
  assert.match(linked, /\/api\/v1\/content\/pipeline\?sourceId=/);
  assert.match(linked, /<ContentCopyLineage/);
  assert.match(linked, /<ContentClaimEvidence/);
});

test("packaging records decisions and claims before publication without changing approval", () => {
  const packagePage = read("../components/content-packaging-workspace.tsx");
  const linked = read("../components/content-planning-handoff.tsx");
  const copyLineage = read("../components/content-copy-lineage.tsx");

  assert.match(packagePage, /공개본 관측은 발행 후에만 기록하세요/);
  assert.match(packagePage, /근거 기록은 승인이나 사실 검증 완료가 아닙니다/);
  assert.match(linked, /allowPublicationEntry=\{!packagingStage\}/);
  assert.match(copyLineage, /kind === "publication" && !allowPublicationEntry/);
  assert.match(copyLineage, /allowPublicationEntry \? <option value="publication">공개본 관측<\/option> : null/);
});

test("changing the packaging topic keeps the URL and script handoff on that topic", () => {
  const packagePage = read("../components/content-packaging-workspace.tsx");
  assert.match(packagePage, /onChange=\{\(event\) => selectSource\(event\.target\.value\)\}/);
  assert.match(packagePage, /url\.searchParams\.set\("sourceId", nextSourceId\)/);
  assert.match(packagePage, /window\.history\.replaceState\(window\.history\.state, "", url\)/);
  assert.match(packagePage, /selectSource\(record\.id\)/);
  assert.match(packagePage, /href=\{`\/content\/scripts\?sourceId=\$\{encodeURIComponent\(sourceId\)\}`\}/);
});
