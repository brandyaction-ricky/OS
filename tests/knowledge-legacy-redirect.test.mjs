import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import * as finalRoutes from "../lib/final-routes.ts";
import * as gate from "../lib/youtube-process/gate.ts";

const nextServer = createRequire(import.meta.url)("next/server");
const modules = { "next/server": nextServer, "@/lib/final-routes": finalRoutes, "@/lib/youtube-process/gate": gate };
const source = await readFile(new URL("../middleware.ts", import.meta.url), "utf8");
const mod = { exports: {} };
runInNewContext(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, { module: mod, exports: mod.exports, require: name => { assert.ok(name in modules, name); return modules[name]; }, URL, encodeURIComponent });
const { middleware, config } = mod.exports;
const at = (path, accept = "text/html,application/xhtml+xml,*/*;q=0.8") => middleware(new nextServer.NextRequest(`https://os.example.test${path}`, { headers: { accept } }));
const moved = path => { const response = at(path), location = response.headers.get("location"); return location ? `${response.status} ${new URL(location).pathname}${new URL(location).search}` : "next"; };
const withV1 = (value, run) => { const before = process.env.YOUTUBE_V1_ENABLED; process.env.YOUTUBE_V1_ENABLED = value; try { run(); } finally { if (before === undefined) delete process.env.YOUTUBE_V1_ENABLED; else process.env.YOUTUBE_V1_ENABLED = before; } };
const home = name => `/home?${new URLSearchParams({ moved: name })}`;

test("old addresses get one redirect to the page's own final target before anything renders", () => withV1("", () => {
  for (const [path, target] of [
    ["/knowledge?tab=canon", "308 /knowledge/canon"], ["/knowledge?document=a%2Fb", "308 /knowledge/doc/a%2Fb"], ["/knowledge?new=1", "308 /knowledge/notes?new=1&tab=all"], ["/knowledge", "308 /knowledge/vault"],
    ["/content", "307 /content/topics"], ["/contents", "307 /content/topics"], ["/finance", "307 /finance/overview"], ["/settings", "307 /settings/connections"],
    ["/content/automation", "307 /automation/topics"], ["/content/review", "307 /automation/review"], ["/content/comments", "307 /automation/performance?tab=comments"],
    ["/automation/library", "307 /automation/dashboard?moved=library"], ["/automation/templates", "307 /automation/settings?tab=templates"],
    ["/organization/projects", "307 /organization/meetings"], ["/performance/connections", "307 /settings/connections"],
    ["/home/goals", `307 ${home("목표·KPI")}`], ["/knowledge/skills", `307 ${home("Skill 관리")}`], ["/performance/revenue", `307 ${home("매출")}`],
    ["/performance", `307 ${home("성과 통합 현황")}`], ["/performance/brands", `307 ${home("성과 통합 현황")}`],
    ["/automation/cardnews/0123abcd-0000-4000-8000-000000000009", "307 /automation/cardnews?sel=0123abcd-0000-4000-8000-000000000009"], ["/automation/topics/not-an-id", "307 /automation/dashboard?missing=1"],
    ["/content/topics?x=1", "next"], ["/content/scripts", "next"],
  ]) assert.equal(moved(path), target, path);
}));

test("with 유튜브 공정 v1 on for everyone the old step screens open the v1 screen in one move", () => withV1("true", () => {
  assert.equal(moved("/content/topics?topic=x"), "307 /content/projects?view=discover");
  assert.equal(moved("/content"), "307 /content/projects?view=discover");
  for (const path of ["/content/scripts", "/content/video", "/content/packages"]) assert.equal(moved(path), "307 /content/projects", path);
}));

test("every retired address is in the matcher, and the matcher names no ordinary page", () => {
  const literal = config.matcher.filter(entry => !entry.includes(":"));
  for (const path of Object.keys(finalRoutes.RETIRED_ROUTES)) assert.ok(literal.includes(path) || path.startsWith("/performance/"), path);
  assert.ok(config.matcher.includes("/performance/:path*") && config.matcher.includes("/automation/:page/:id"));
  withV1("true", () => { for (const path of literal) assert.notEqual(moved(path), "next", path); });
});

test("in-app moves (no HTML asked for) are left to the page's own redirect", () => {
  for (const path of ["/knowledge?tab=canon", "/content/comments", "/settings"]) {
    const response = at(path, "*/*");
    assert.equal(response.headers.get("location"), null, path);
    assert.equal(response.headers.get("x-middleware-next"), "1", path);
  }
});
