import assert from "node:assert/strict";
import test from "node:test";
import { searchPrefilter, searchWorkspace } from "../lib/knowledge/search.ts";

// 문서 찾기 asks the database only for documents holding a searched word; searchWorkspace still decides the matches.
test("the pre-filter covers every word and its group in title or body without PostgREST's reserved characters", () => {
  assert.equal(searchPrefilter("정본 연봉"), "title.ilike.*정본*,content_md.ilike.*정본*,title.ilike.*기준*,content_md.ilike.*기준*,title.ilike.*연봉*,content_md.ilike.*연봉*");
  // reserved characters are never sent: a word keeps its longest plain run, and a word with none means "read everything"
  assert.equal(searchPrefilter("마이인,진단서들"), "title.ilike.*진단서들*,content_md.ilike.*진단서들*");
  assert.equal(searchPrefilter("정본 ()"), "");
  assert.equal(searchPrefilter("결정"), null);
  assert.equal(searchPrefilter("   "), null);
});

test("what the pre-filter lets through is what searchWorkspace matches", () => {
  const doc = (id, title, content_md) => ({ id, title, content_md, status: "team", owner_id: "o", source: "wiki", updated_at: "2026-11-02" });
  const docs = [doc("a", "회사 정본", "본문"), doc("b", "메모", "썸네일 **기준** 정리"), doc("c", "메모", "관계없는 글")];
  const words = [...new Set(searchPrefilter("정본").match(/\*([^*,]+)\*/g).map(m => m.slice(1, -1)))];
  const passed = docs.filter(d => words.some(w => d.title.includes(w) || d.content_md.includes(w)));
  assert.deepEqual(passed.map(d => d.id), ["a", "b"]);
  assert.deepEqual(searchWorkspace(passed, "정본").map(hit => hit.id).sort(), ["a", "b"]);
});
