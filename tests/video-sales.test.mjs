import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { classifyContent, videoSales } from "../lib/video-sales.ts";

// 마이인 영상별 매출 (2026-11-11): MYIN's money per UTM matched to videos — 구매 전 유입 (l) first, 최초 유입 (f) beside it.
const read = (file) => readFileSync(new URL(`../${file}`, import.meta.url), "utf8");
const maps = { codes: { "yp-1a2b3c4d": ["AbCdEfGhIjK"], "yp-99999999": ["AbCdEfGhIjK", "ZZZZZZZZZZZ"] },
  videos: { AbCdEfGhIjK: { videoId: "AbCdEfGhIjK", title: "영상 A" }, ZZZZZZZZZZZ: { videoId: "ZZZZZZZZZZZ", title: "영상 Z" } } };
const row = (view, d, src, cnt, orders, net, cmp = "longform") => ({ view, d, src, med: "organic", cmp, cnt, orders, gross: net, refunded: 0, net });

test("a code names a video by its exact id or an OS upload code; two videos on one code is a 충돌, an unknown id is 미매핑", () => {
  assert.deepEqual(classifyContent("AbCdEfGhIjK", maps), { kind: "video", videoIds: ["AbCdEfGhIjK"] });
  assert.deepEqual(classifyContent("abcdefghijk", maps).kind, "unmapped", "case is kept: a different id is not this video");
  assert.deepEqual(classifyContent("yp-1a2b3c4d", maps), { kind: "video", videoIds: ["AbCdEfGhIjK"] });
  assert.equal(classifyContent("yp-99999999", maps).kind, "conflict");
  assert.equal(classifyContent("yp-00000000", maps).kind, "unmapped");
  assert.equal(classifyContent("profile", maps).kind, "nonVideo");
  assert.equal(classifyContent(null, maps).kind, "nonVideo");
});

test("one video adds up all its codes once per order; the totals reconcile and the two views are never added", () => {
  const s = videoSales([
    row("l", "2026-11-02", "youtube", "AbCdEfGhIjK", 2, 116000), row("l", "2026-11-03", "youtube", "yp-1a2b3c4d", 1, 68000),
    row("l", "2026-11-03", "youtube", "yp-99999999", 1, 19800), row("l", "2026-11-03", "youtube", "XXXXXXXXXXX", 1, 9900),
    row("l", "2026-11-03", "youtube", "profile", 1, 30000, "channel"), row("l", "2026-11-03", "meta", null, 1, 50000), row("l", "2026-11-03", null, null, 1, 7000),
    row("f", "2026-11-02", "youtube", "AbCdEfGhIjK", 1, 68000), row("f", "2026-11-02", "meta", null, 6, 232700),
  ], maps);
  assert.equal(s.videos.length, 1);
  assert.deepEqual([s.videos[0].title, s.videos[0].money.l, s.videos[0].money.f], ["영상 A", { orders: 3, net: 184000 }, { orders: 1, net: 68000 }]);
  assert.deepEqual(s.videos[0].codes.sort(), ["AbCdEfGhIjK", "yp-1a2b3c4d"]);
  assert.deepEqual(s.videos[0].daily, [{ d: "2026-11-02", orders: 2, net: 116000 }, { d: "2026-11-03", orders: 1, net: 68000 }]);
  const t = s.totals;
  assert.equal(t.youtube.l.net, t.video.l.net + t.conflict.l.net + t.unmapped.l.net + t.nonVideo.l.net);
  assert.equal(t.all.l.net, t.youtube.l.net + t.otherSource.l.net + t.unknown.l.net);
  assert.equal(t.all.l.net, t.all.f.net, "both views count the same orders");
  assert.deepEqual([s.conflicts[0].cnt, s.unmapped[0].cnt, s.nonVideo[0].cnt], ["yp-99999999", "XXXXXXXXXXX", "profile"]);
});

test("the OS reads MYIN through its server key, keeps the last good figures when MYIN fails, and the page shows the panel", () => {
  const server = read("lib/server/myin-sales.ts");
  assert.match(server, /\/api\/integrations\/brandy-os\/sales\?/);
  assert.match(server, /authorization: `Bearer \$\{secret\}`/);
  assert.match(server, /if \(hit\) return \{ \.\.\.hit\.value, stale: \{ reason:/);
  assert.match(server, /MYIN_SALES_NOT_READY/);
  const route = read("app/api/v1/content/video-sales/route.ts");
  assert.match(route, /await authenticateRequest\(request\);/);
  assert.match(route, />= 92\)/);
  assert.match(read("components/content-performance-dashboard.tsx"), /\{tab === "sales" \? youtubeOnly \? <VideoSalesPanel from=\{from\} to=\{to\} \/>/);
  assert.doesNotMatch(read("components/video-sales-panel.tsx"), /style=\{\{/);
});
