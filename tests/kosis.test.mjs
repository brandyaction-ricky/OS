import assert from "node:assert/strict";
import test from "node:test";
import { kosisInputSchema, kosisRequest, normalizeKosis, queryKosis } from "../lib/kosis.ts";
import { callMcpTool, MCP_TOOLS } from "../lib/server/mcp.ts";

const search = kosisInputSchema.parse({ action: "search", query: "자영업자" });
const data = kosisInputSchema.parse({ action: "data", orgId: "101", tblId: "DT_SAMPLE", itmId: "T1", objL1: "00", prdSe: "Y" });
const row = { ORG_ID: "101", TBL_ID: "DT_SAMPLE", TBL_NM: "시험 표", ITM_ID: "T1", ITM_NM: "취업자", PRD_DE: "2025", PRD_SE: "Y", DT: "-", UNIT_NM: "천명", C1: "00", C1_NM: "전체", C1_OBJ_NM: "연령" };

test("explicit selections and bounded requests prevent arbitrary upstream URLs", () => {
  assert.throws(() => kosisInputSchema.parse({ ...search, apiKey: "injected" }));
  assert.throws(() => kosisInputSchema.parse({ ...data, tblId: "https://elsewhere" }));
  assert.throws(() => kosisInputSchema.parse({ action: "data", orgId: "101", tblId: "DT_SAMPLE", prdSe: "Y" }));
  assert.throws(() => kosisInputSchema.parse({ ...data, newEstPrdCnt: 100 }));
  const request = kosisRequest(data);
  assert.equal(request.path, "Param/statisticsParameterData.do");
  assert.equal(request.params.get("smblChk"), "Y");
  assert.equal(request.params.has("apiKey"), false);
});

test("search pagination and source links do not trust provider HTML or URLs", () => {
  const result = normalizeKosis(search, [{ ORG_ID: "101", TBL_ID: "DT_SAMPLE", TBL_NM: "고용", LINK_URL: "javascript:alert(1)", STAT_DB_CNT: "34" }]);
  assert.equal(result.total, "34"); assert.equal(result.page, 1);
  assert.match(result.items[0].sourceUrl, /^https:\/\/kosis.kr\/statHtml/);
});

test("data preserves missing and suppression symbols, units, periods and dimensions", () => {
  const result = normalizeKosis(data, [row, { ...row, DT: null }, { ...row, DT: "0" }]);
  assert.deepEqual(result.items.map(item => item.value), ["-", null, "0"]);
  assert.equal(result.items[0].unit, "천명"); assert.equal(result.items[0].period, "2025");
  assert.equal(result.items[0].dimensions[0].label, "전체");
  assert.equal(normalizeKosis(data, [{ ...row, UNIT_NM: "" }]).items[0].unit, null);
});

test("HTTP-200 API errors, unexpected objects and wrong tables never become evidence", () => {
  for (const payload of [{ err: "20", errMsg: "bad credential" }, [{ err: "20" }], {}, [{ ...row, TBL_ID: "WRONG" }]]) {
    assert.throws(() => normalizeKosis(data, payload));
  }
  assert.throws(() => normalizeKosis(data, Array.from({ length: 1001 }, () => row)), /결과가 너무 많/);
  assert.deepEqual(normalizeKosis(search, []).items, []);
});

test("missing configuration fails before a network request", async () => {
  let called = false;
  await assert.rejects(queryKosis(search, "", async () => { called = true; }), error => error.code === "KOSIS_NOT_CONFIGURED");
  assert.equal(called, false);
});

test("transport strips credential-bearing errors and refuses redirects and large bodies", async () => {
  const key = "synthetic-test-only-key";
  await assert.rejects(queryKosis(search, key, async url => { throw new Error(url); }), error => !error.message.includes(key) && error.code === "KOSIS_UNAVAILABLE");
  await assert.rejects(queryKosis(search, key, async () => new Response(JSON.stringify([{ err: key }]))), error => !error.message.includes(key));
  await assert.rejects(queryKosis(search, key, async () => new Response("x".repeat(1_000_001))), error => error.code === "KOSIS_RESULT_TOO_LARGE");
  const result = await queryKosis(data, key, async (url, init) => {
    assert.equal(new URL(url).hostname, "kosis.kr"); assert.equal(init.redirect, "error");
    return new Response(JSON.stringify([row]));
  });
  assert.equal(result.provider, "KOSIS"); assert.ok(result.retrievedAt);
  assert.equal(JSON.stringify(result).includes(key), false);
});

test("OS MCP forwards only validated read-only statistics arguments", async () => {
  const tool = MCP_TOOLS.find(tool => tool.name === "query_statistics");
  assert.equal(tool.annotations.readOnlyHint, true);
  let received;
  await callMcpTool({ name: "query_statistics", arguments: search }, "unused", async (path, init) => { received = { path, body: JSON.parse(init.body) }; return {}; });
  assert.equal(received.path, "/api/v1/statistics/kosis"); assert.equal(received.body.query, "자영업자");
  await assert.rejects(callMcpTool({ name: "query_statistics", arguments: { ...search, url: "https://elsewhere" } }, "unused", async () => {}));
});
