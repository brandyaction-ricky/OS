import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import * as React from "react";
import * as jsx from "react/jsx-runtime";
import { renderToStaticMarkup } from "react-dom/server";
import ts from "typescript";

// 영상 편집기 카드 (로건 개발 문서 v2 ③, 대표 2026-11-04 「OS엔 상태 카드」): who edits where, the orders and what each became, the versions.
const file = "components/myin-edit-card.tsx";
const compiled = { exports: {} };
vm.runInNewContext(ts.transpileModule(readFileSync(new URL(`../${file}`, import.meta.url), "utf8"), { fileName: file, compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText,
  { module: compiled, exports: compiled.exports, Intl, Date, require: (name) => ({ react: React, "react/jsx-runtime": jsx, "@/lib/api-client": { apiRequest: () => { throw Error("no network"); } } })[name] ?? (() => { throw Error(name); })() });
const { EditStatusView, orderState, LOCAL_EDITOR_URL } = compiled.exports;
const status = {
  lock: { name: "로건", pc: "로건 PC", since: "2026-11-04T05:05:00.000Z" }, confirming: null, uploadedAt: null,
  versions: [{ v: 1, at: "2026-11-03T10:10:36.892Z", durationSeconds: 628, edit: null },
    { v: 2, at: "2026-11-04T06:00:00.000Z", durationSeconds: 627, edit: { name: "로건", pc: "로건 PC", fromVersion: "v4", note: "사진 교체", orders: 2 } }],
  orders: [{ id: "a", at: "2026-11-04T05:10:00.000Z", text: "3번 장면 사진 바꿔줘", videoAt: "1:23", from: "chat", name: "유쓰", meaning: "", status: "done", result: { version: "v4", note: "" } },
    { id: "b", at: "2026-11-04T05:20:00.000Z", text: "음악 더 밝게", videoAt: null, from: "feedback", name: "대표", meaning: "", status: "declined", result: { note: "엔진에 없는 연출이에요" } }],
};

test("the card says who edits on which computer, each version's maker, and where each order is", () => {
  const html = renderToStaticMarkup(React.createElement(EditStatusView, { status }));
  assert.match(html, /로건님이 편집 중 · 로건 PC/);
  assert.match(html, /<strong>v1<\/strong>.*OS가 만듦/);
  assert.match(html, /로건님이 로건 PC에서 확정 · 편집기 v4에서 · 주문 2건 · “사진 교체”/);
  assert.match(html, /data-status="approved">반영됨 · v4.*3번 장면 사진 바꿔줘.*유쓰님/);
  assert.match(html, /data-status="failed">못 함.*—.*음악 더 밝게.*대표님 · .* · 최종 검토 피드백 · 엔진에 없는 연출이에요/);
  assert.ok(html.includes(`href="${LOCAL_EDITOR_URL}"`), "opens the editor on this computer");
  assert.match(renderToStaticMarkup(React.createElement(EditStatusView, { status: { ...status, lock: null, orders: [] } })), /지금 편집하는 사람 없어요.*아직 편집 주문이 없어요/);
});

test("an order's state reads in plain words", () => {
  assert.deepEqual(["queued", "working", "failed"].map((s) => orderState({ status: s, result: null }).label), ["기다리는 중", "고치는 중", "못 만들었어요"]);
  assert.equal(orderState({ status: "done", result: { version: "v3", note: "" } }).label, "반영됨 · v3");
});

test("the card polls only the edits view (no video addresses), and shows only after a longform final", () => {
  const source = readFileSync(new URL(`../${file}`, import.meta.url), "utf8");
  assert.match(source, /view=edits/);
  assert.doesNotMatch(source, /outputs=|createSigned|<video/);
  const panel = readFileSync(new URL("../components/myin-v13-panel.tsx", import.meta.url), "utf8");
  assert.match(panel, /run\?\.final && run\.stage === "final_ready" && !short \? <MyinEditCard/);
});
