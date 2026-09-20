import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

test("MCP exposes bounded Skill discovery and detail tools", () => {
  const mcp = read("lib/server/mcp.ts");
  const route = read("app/api/v1/agent-skills/route.ts");
  const server = read("app/api/mcp/route.ts");

  assert.match(mcp, /name: "list_skills"/);
  assert.match(mcp, /name: "get_skill"/);
  assert.match(mcp, /\/api\/v1\/agent-skills/);
  assert.match(server, /list_skills로 적용할 회사 표준/);
  assert.match(route, /requiredAgentScope: "records\.read"/);
  assert.match(route, /metadata\?\.scope === "company" && skill\.status === "ready"/);
  assert.match(route, /skill\.owner_id === actor\.ownerId/);
  assert.match(route, /eq\("record_type", "skill"\)/);
  assert.doesNotMatch(route, /records\.write/);
});
