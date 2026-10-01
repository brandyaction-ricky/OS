import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";

function loadAppealHelpers() {
  const source = readFileSync(new URL("../lib/content-appeals.ts", import.meta.url), "utf8");
  const code = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const compiled = { exports: {} };
  vm.runInNewContext(code, { module: compiled, exports: compiled.exports, URL });
  return compiled.exports;
}

const appeals = loadAppealHelpers();

test("appeal candidates keep only concise candidate text and explicit human decisions", () => {
  const candidates = appeals.normalizeAppealCandidates([
    { text: "  내 강점을 일에서 쓰지 못하는 이유  ", explanation: "노출되면 안 됨" },
    { text: "퇴사보다 먼저 확인할 나의 일하는 방식", decision: "approved", decidedAt: "2026-09-30T00:00:00Z" },
    { explanation: "문구 없음" },
  ]);
  assert.deepEqual(JSON.parse(JSON.stringify(candidates)), [
    { text: "내 강점을 일에서 쓰지 못하는 이유", decision: "pending" },
    { text: "퇴사보다 먼저 확인할 나의 일하는 방식", decision: "approved", decidedAt: "2026-09-30T00:00:00Z" },
  ]);
  const decided = appeals.decideAppealCandidate(candidates, 0, "revision", "2026-09-30T01:00:00Z");
  assert.equal(decided[0].decision, "revision");
  assert.equal(appeals.approvedAppeals(decided).length, 1);
  assert.equal(appeals.appealApprovalMatches(decided, { approvedAppeals: [{ text: "퇴사보다 먼저 확인할 나의 일하는 방식" }] }), true);
  assert.equal(appeals.appealApprovalMatches(decided, { approvedAppeals: [{ text: "다른 문구" }] }), false);
});

test("research unlocks planning only after sources, three fit checks and limitations are saved", () => {
  const incomplete = { youtubeUrls: ["https://youtube.com/watch?v=1"], topicFit: "직접 관련", audienceFit: "핵심 대상 일치", queryIntentFit: "검색 질문 일치", verifiedAt: "2026-09-30T01:00:00Z" };
  assert.equal(appeals.researchBriefReady(incomplete), false);
  assert.equal(appeals.researchBriefReady({ ...incomplete, limitations: "Instagram 수치는 확인하지 못함" }), true);
  assert.equal(appeals.appealWorkflowState([{ text: "후보", decision: "approved" }], false).stage, "레퍼런스 검증");
  assert.equal(appeals.appealWorkflowState([{ text: "후보", decision: "approved" }], true).stage, "기획 확정 준비");
});

test("generation and workspace contracts preserve the approval gate", () => {
  const server = readFileSync(new URL("../lib/server/content-generation.ts", import.meta.url), "utf8");
  const workspace = readFileSync(new URL("../components/content-radar-workspace.tsx", import.meta.url), "utf8");
  assert.match(server, /action === "appeal_candidates"/);
  assert.match(server, /minItems: 10, maxItems: 10/);
  assert.match(server, /CONTENT_APPEAL_RESEARCH_REQUIRED/);
  assert.match(server, /설명·이유·근거·레퍼런스·제목·썸네일 문구를 붙이지 않는다/);
  assert.match(workspace, /decideAppeal\(index, "approved"\)/);
  assert.match(workspace, /name="youtubeSources"/);
  assert.match(workspace, /name="instagramSources"/);
  assert.match(workspace, /name="topicFit"/);
  assert.match(workspace, /name="audienceFit"/);
  assert.match(workspace, /name="queryIntentFit"/);
  assert.match(workspace, /name="limitations"/);
  assert.match(workspace, /disabled=\{busy \|\| !researchReady\}/);
});
