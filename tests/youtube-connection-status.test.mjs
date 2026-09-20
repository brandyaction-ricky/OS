import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

test("YouTube OAuth configuration and channel consent have separate states", () => {
  const health = read("app/api/v1/health/route.ts");
  const settings = read("components/settings-workspaces.tsx");
  const client = read("lib/api-client.ts");

  assert.match(health, /youtubeOAuthConfigured\(\) \? "configured" : "missing"/);
  assert.match(client, /youtubeOAuth: "configured" \| "missing"/);
  assert.match(settings, /getYoutubeOAuthStatus\(accessToken\)/);
  assert.match(settings, /youtubeOauth\?\.connected \? "ready"/);
  assert.match(settings, /OAuth 설정됨·채널 미연결/);
});
