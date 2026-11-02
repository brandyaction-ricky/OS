import test from "node:test";
import assert from "node:assert/strict";
import { searchText, searchWorkspace } from "../lib/knowledge/search.ts";

// The search route keeps bodies already cleaned (searchText); the results must match cleaning them on every search.
test("kept search text finds the same documents as cleaning each body", () => {
  const doc = (id, title, content_md) => ({ id, title, content_md, status: "published", folder: "규칙", source: "manual", owner_id: "o", updated_at: "2026-11-02T00:00:00Z" });
  const docs = [doc("a", "연봉 정리", "**이직** 할 때 [연봉](https://x.y) 협상"), doc("b", "회의", "# 썸네일 회의록"), doc("c", "기타", "관계 없음")];
  const kept = new Map(docs.map(d => [d.id, searchText(d.content_md)]));
  for (const q of ["연봉 이직", "섬네일", "협상"]) {
    const light = docs.map(d => ({ ...d, content_md: undefined }));
    assert.deepEqual(searchWorkspace(light, q, { text: d => kept.get(d.id) }), searchWorkspace(docs, q), q);
  }
  assert.equal(searchWorkspace(docs, "연봉 이직")[0].excerpt.includes("**"), false);
});
