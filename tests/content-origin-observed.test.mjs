import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { linkedContentOrigin } from "../lib/content-origin.ts";
import { withObservedOrigin } from "../lib/content-metrics.ts";

const row = (metadata) => ({ title: "영상", parent_id: null, metadata: { dataSource: "youtube_data_api", platform: "YouTube", ...metadata } });
const own = new Set(["UC_OURS"]);

test("hourly observer rows count as our content only for our connected channels", () => {
  assert.equal(linkedContentOrigin(withObservedOrigin(row({ channelId: "UC_OURS" }), own), []), "own");
  assert.equal(linkedContentOrigin(withObservedOrigin(row({ channelId: "UC_OTHER" }), own), []), "market");
  // A channel we track as a reference and also connected stays ours.
  const tracked = [{ id: "t1", title: "채널", metadata: { studioKind: "channel", channelId: "UC_OURS", origin: "market" } }];
  assert.equal(linkedContentOrigin(withObservedOrigin(row({ channelId: "UC_OURS" }), own), tracked), "own");
  // A marker written by the observer wins; other rows are left alone.
  assert.equal(withObservedOrigin(row({ channelId: "UC_OURS", origin: "market" }), own).metadata.origin, "market");
  const daily = row({ channelId: "UC_OTHER", dataSource: "youtube_analytics_daily" });
  assert.equal(withObservedOrigin(daily, own), daily);
  const manual = { title: "수동 입력", parent_id: "t1", metadata: { views: 10 } };
  assert.equal(withObservedOrigin(manual, own), manual);
});

test("the observer marks each row with its channel kind, connections last", () => {
  const source = readFileSync("lib/server/youtube-observation.ts", "utf8");
  assert.match(source, /origin: "market" as const \}\)\),\n.*\n\s*\.\.\.\(connections \?\? \[\]\)\.map\(.*origin: "own" as const/);
  assert.match(source, /channelTitle: video\.channelTitle \|\| channel\.title, origin: channel\.origin,/);
  const route = readFileSync("lib/server/metric-window.ts", "utf8");
  assert.match(route, /records\.map\(\(record\) => withObservedOrigin\(record, ownChannelIds\)\)/);
});
