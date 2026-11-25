import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { countText } from "../lib/count-text.ts";

test("a running figure keeps the format of the real one and ends on it exactly", () => {
  assert.equal(countText("147,253,592원", [], 0), "0원");
  assert.equal(countText("147,253,592원", [], 0.5), "73,626,796원");
  assert.equal(countText("147,253,592원", [], 1), "147,253,592원");
  assert.equal(countText("4.7%", [], 0.5), "2.4%", "decimals kept");
  assert.equal(countText("+1,200 / 8", [100, 2], 0.5), "+650 / 5", "every number runs, from what was on screen");
  assert.equal(countText("—", [], 0.3), "—", "no digits, nothing to run");
});

test("성과 figures run up and their loading state rolls grey digits", () => {
  for (const file of ["content-performance-dashboard", "channel-metrics-panel", "video-sales-panel", "performance-workspaces", "growth-dashboard", "ad-performance-workspace"]) {
    const source = readFileSync(`components/${file}.tsx`, "utf8");
    assert.match(source, /className="metric-value[^"]*"><CountUp>\{/, file);
  }
  for (const file of ["content-performance-dashboard", "channel-metrics-panel"]) {
    assert.doesNotMatch(readFileSync(`components/${file}.tsx`, "utf8"), /perf-skeleton/, file);
  }
  assert.match(readFileSync("components/workspace-load-state.tsx", "utf8"), /<div className="metric-value"><NumberLoading \/><\/div>/);
  assert.match(readFileSync("components/count-up.tsx", "utf8"), /prefers-reduced-motion: reduce/);
  assert.match(readFileSync("app/globals.css", "utf8"), /prefers-reduced-motion: reduce\) \{ \.number-loading-digit > span \{ animation: none; \} \}/);
});
