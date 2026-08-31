import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("remote MCP route exposes the five guarded knowledge tools", async () => {
  const [route, tools] = await Promise.all([
    read("app/api/mcp/route.ts"),
    read("lib/server/mcp.ts"),
  ]);
  for (const name of ["search_knowledge", "get_document", "create_document", "edit_document", "delete_document"]) {
    assert.match(tools, new RegExp(`name: "${name}"`));
  }
  assert.match(route, /protocolVersion = "2025-06-18"/);
  assert.match(route, /Bearer bos_pat_/);
  assert.match(route, /instructions:/);
  assert.match(tools, /z\.literal\(true\)/);
  assert.match(tools, /status: "personal_draft"/);
  assert.doesNotMatch(route, /bos_pat_[A-Za-z0-9_-]{16,}/);
  assert.doesNotMatch(tools, /bos_pat_[A-Za-z0-9_-]{16,}/);
});
