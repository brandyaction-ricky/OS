import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import { buildOpsDecisionDocument, operatingBaselineLocation, parseOperatingBaseline, renderOperatingBaseline } from "../lib/meeting-documents.ts";

const MYIN = { recordBrand: "마이인", wikiFolderSegment: "마이인", label: "마이인(진단)" };

test("buildOpsDecisionDocument stores the meeting's decisions verbatim as the operating-standard source", () => {
  const doc = buildOpsDecisionDocument(MYIN, "2026-09-22", ["광고 예산 20만원 유지", "네이버 유입 캠페인 신규 진행"]);
  assert.equal(doc.folder, "02_Wiki/마이인/운영/운영안");
  assert.equal(doc.title, "2026-09-22 회의 결정 (마이인(진단))");
  assert.match(doc.content_md, /- 광고 예산 20만원 유지/);
  assert.match(doc.content_md, /- 네이버 유입 캠페인 신규 진행/);
});

test("operatingBaselineLocation points at the single per-business standing document", () => {
  assert.deepEqual(operatingBaselineLocation(MYIN), { title: "운영 기준 (마이인(진단))", folder: "02_Wiki/마이인/운영" });
});

test("parseOperatingBaseline on empty content returns an empty body and ledger", () => {
  assert.deepEqual(parseOperatingBaseline(""), { body: "", ledger: [] });
});

test("renderOperatingBaseline + parseOperatingBaseline round-trip the body and ledger", () => {
  const ledger = [{ number: 1, title: "2026-09-01 회의 결정 (마이인(진단))", appliedAt: "2026-09-01T00:00:00Z" }];
  const rendered = renderOperatingBaseline(MYIN, "[광고]\n- 예산 30만원 유지 ⟨1⟩", ledger);
  assert.match(rendered, /^# 운영 기준 \(마이인\(진단\)\)/);
  assert.match(rendered, /⟨1⟩ 2026-09-01 회의 결정 \(마이인\(진단\)\)/);
  const parsed = parseOperatingBaseline(rendered);
  assert.match(parsed.body, /예산 30만원 유지 ⟨1⟩/);
  assert.doesNotMatch(parsed.body, /📄 출처/); // legend is re-derived from ledger, not kept in the parsed body
  assert.equal(JSON.stringify(parsed.ledger), JSON.stringify(ledger));
});

test("renderOperatingBaseline shows '(없음)' when the ledger is empty", () => {
  const rendered = renderOperatingBaseline(MYIN, "아직 내용 없음", []);
  assert.match(rendered, /📄 출처\n\(없음\)/);
});

// lib/server/operating-baseline.ts imports "@/lib/config", which Node's native
// ESM loader can't resolve directly — same VM-sandbox pattern as the webhook
// route and meeting-prep tests.
async function loadSynthesizeOperatingBaseline() {
  const source = await readFile(new URL("../lib/server/operating-baseline.ts", import.meta.url), "utf8");
  const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const modules = {
    "@/lib/config": { OPENAI_ANSWER_MODEL: "test-model" },
    // Mirrors lib/server/meeting-summary.ts's jsonText — avoided importing the
    // real file here since it itself needs "@/lib/config" resolved separately.
    "./meeting-summary": {
      jsonText: (body) => (Array.isArray(body.output) ? body.output : [])
        .flatMap((item) => (item && Array.isArray(item.content) ? item.content : []))
        .filter((item) => item?.type === "output_text")
        .map((item) => String(item.text ?? "")).join("\n").trim(),
    },
  };
  const exports = {};
  runInNewContext(code, { exports, require: (id) => { if (!(id in modules)) throw Error(id); return modules[id]; }, console, process, AbortController, AbortSignal, setTimeout, clearTimeout, fetch: async () => { throw new Error("fetch should not be called without an API key"); } });
  return exports.synthesizeOperatingBaseline;
}

test("synthesizeOperatingBaseline fails open (returns null) without an OPENAI_API_KEY, never touching the network", async () => {
  const synthesizeOperatingBaseline = await loadSynthesizeOperatingBaseline();
  delete process.env.OPENAI_API_KEY;
  const result = await synthesizeOperatingBaseline("마이인(진단)", [{ number: 1, title: "회의 결정", content: "- 예산 유지" }], "");
  assert.equal(result, null);
});

test("synthesizeOperatingBaseline returns null immediately when there are no new source documents", async () => {
  const synthesizeOperatingBaseline = await loadSynthesizeOperatingBaseline();
  process.env.OPENAI_API_KEY = "test-key";
  try {
    const result = await synthesizeOperatingBaseline("마이인(진단)", [], "existing body");
    assert.equal(result, null);
  } finally {
    delete process.env.OPENAI_API_KEY;
  }
});
