import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("content_package lists leave out the server-only YouTube discover cache; a direct id read still finds it", () => {
  const route = readFileSync("app/api/v1/records/route.ts", "utf8");
  assert.match(route, /if \(recordType === "content_package" && !id\) builder = builder\.not\("metadata", "cs", JSON\.stringify\(\{ packageKind: "youtube_discover_cache" \}\)\)/);
  assert.match(readFileSync("lib/server/youtube-discover.ts", "utf8"), /const CACHE_KIND = "youtube_discover_cache";[\s\S]*service\.from\("os_records"\)/, "the cache is read with the service client, not the records API");
});
