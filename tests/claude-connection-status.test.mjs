import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

test("Claude key presence is configuration, not a verified connection", () => {
  const health = read("app/api/v1/health/route.ts");
  const settings = read("components/settings-workspaces.tsx");
  const client = read("lib/api-client.ts");

  assert.match(health, /\? "configured" : "missing"/);
  assert.doesNotMatch(health, /contentAi[^\n]+\? "ready"/);
  assert.match(client, /contentAi: "configured" \| "missing"/);
  assert.match(settings, /health\?\.contentAi === "configured" \? "warning" : "waiting"/);
  assert.match(settings, /설정됨·실행 검증 필요/);
});
