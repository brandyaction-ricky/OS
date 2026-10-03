import assert from "node:assert/strict";
import test from "node:test";
import { summarizeContentSearchHistory } from "../lib/content-search-history.ts";

const record = (id, query, searchedAt, actor, extra = {}) => ({
  id, title: query, created_by: actor, created_at: searchedAt,
  metadata: { query, searchedAt, ...extra },
});

test("same keyword is one row with count and latest actor", () => {
  const rows = summarizeContentSearchHistory([
    record("a", "진단 가격", "2026-10-01T09:00:00Z", "first", { resultCount: 4 }),
    record("b", "  진단   가격  ", "2026-10-03T09:00:00Z", "last", { resultCount: 9 }),
    record("c", "다른 말", "2026-10-02T09:00:00Z", "third"),
  ]);
  assert.equal(rows.length, 2);
  assert.equal(rows[0].count, 2);
  assert.equal(rows[0].latestActorId, "last");
  assert.equal(rows[0].resultCount, 9);
  assert.equal(rows[1].resultCount, null);
});
