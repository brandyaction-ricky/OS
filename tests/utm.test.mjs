import assert from "node:assert/strict";
import test from "node:test";
import { buildUtmUrl, normalizeUtmCode, parseOriginUrl, utmConflicts, validUtmCode } from "../lib/utm.ts";

const codes = { source: "youtube", medium: "organic_social", campaign: "myin_free_202610", content: "video_001" };

test("the request's example: query and hash kept, four keys added once", () => {
  const { url } = parseOriginUrl("https://www.myinlab.co.kr/services/free?ref=channel#samples");
  assert.equal(buildUtmUrl(url, codes), "https://www.myinlab.co.kr/services/free?ref=channel&utm_source=youtube&utm_medium=organic_social&utm_campaign=myin_free_202610&utm_content=video_001#samples");
});

test("no content means no utm_content key at all", () => {
  const { url } = parseOriginUrl("https://example.com/a");
  assert.equal(buildUtmUrl(url, { ...codes, content: null }), "https://example.com/a?utm_source=youtube&utm_medium=organic_social&utm_campaign=myin_free_202610");
});

test("existing UTM keys are reported, then replaced once; other tracking query stays", () => {
  const { url } = parseOriginUrl("https://example.com/?utm_source=ig&utm_source=fb&utm_term=x&gclid=abc&utm_medium=organic_social&utm_content=old");
  assert.deepEqual(utmConflicts(url, { ...codes, content: null }), [
    { key: "utm_source", before: "ig, fb", after: "youtube" },
    { key: "utm_content", before: "old", after: null },
  ]);
  const out = new URL(buildUtmUrl(url, { ...codes, content: null }));
  assert.deepEqual(out.searchParams.getAll("utm_source"), ["youtube"]);
  assert.equal(out.searchParams.get("utm_term"), "x");
  assert.equal(out.searchParams.get("gclid"), "abc");
  assert.equal(out.searchParams.has("utm_content"), false);
});

test("unsafe or credentialed addresses are refused", () => {
  for (const bad of ["javascript:alert(1)", "data:text/html,x", "ftp://example.com", "https://user:pw@example.com", "example.com"]) assert.ok("error" in parseOriginUrl(bad), bad);
});

test("codes are trimmed and lowercased; only a-z 0-9 _ - pass", () => {
  assert.equal(normalizeUtmCode("  YouTube "), "youtube");
  assert.ok(validUtmCode("myin_free_202610") && validUtmCode("organic-social"));
  assert.ok(!validUtmCode("유튜브") && !validUtmCode("a b") && !validUtmCode(""));
});

test("the 링크 대장 document is one table built from the rows; memo fields stay out of the URL", async () => {
  const { utmLedgerMarkdown } = await import("../lib/utm-ledger.ts");
  const md = utmLedgerMarkdown([{ id: "1234567890ab", brand: "마이인", usage: "10월 28일 유튜브 | 고정댓글", created_at: "2026-10-28T15:30:00Z", creator: "안저",
    params: { source: { code: "youtube", label: "유튜브" }, medium: { code: "organic_social", label: "자연 SNS" }, campaign: { code: "myin_free_202610", label: "무료진단 10월" }, content: null },
    target: "30대", location: "고정댓글", etc: "", utm_url: "https://example.com/?utm_source=youtube", short_url: null }]);
  assert.match(md, /^# 링크 대장/);
  assert.match(md, /\| 12345678 \| 2026-10-29 \| 마이인 \| 10월 28일 유튜브 \\\| 고정댓글 \| 유튜브 \(youtube\) \|/);
  assert.match(md, /대상: 30대 · 위치: 고정댓글/);
});

test("UTM tables are server-only and every route checks the staff session", async () => {
  const { readFileSync } = await import("node:fs");
  const sql = readFileSync("supabase/migrations/20261028090000_link_manager_utm.sql", "utf8");
  for (const table of ["os_utm_options", "os_utm_links"]) {
    assert.match(sql, new RegExp(`alter table public\\.${table} enable row level security`));
    assert.match(sql, new RegExp(`revoke all on public\\.${table} from public, anon, authenticated`));
  }
  assert.match(sql, /unique \(kind, code\)/);
  assert.match(sql, /request_id uuid not null unique/);
  for (const route of ["options/route.ts", "options/[id]/route.ts", "links/route.ts", "links/[id]/short/route.ts", "links/[id]/ledger/route.ts"]) {
    assert.match(readFileSync(`app/api/v1/utm/${route}`, "utf8"), /await utmActor\(request\)/, route);
  }
  assert.match(readFileSync("lib/server/utm-links.ts", "utf8"), /if \(!actor\.isAdmin\) throw new ApiError\(403, "ADMIN_REQUIRED"/);
});
