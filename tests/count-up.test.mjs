import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { countText } from "../lib/count-text.mjs";

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

test("재무 figures run too: the controller's tiles after each draw, the React pages through CountUp, loading rolls grey digits", () => {
  const controller = readFileSync("lib/finance/workspace.mjs", "utf8");
  assert.match(controller, /import \{ runFigures \} from "\.\.\/count-text\.mjs";/);
  assert.match(controller, /getId\("view"\)\.innerHTML = cleanHTML\(ROUTES\[c\]\(\)\);\n.*\n    runFigures\(getId\("view"\), "\.fin-tile \.fin-v, \.fin-srctab \.fin-v", figures,/);
  for (const file of ["profit-loss", "vat-reference", "tax-invoice-panel"]) assert.match(readFileSync(`components/finance/${file}.tsx`, "utf8"), /className="fin-(payable-)?v"><CountUp>\{/, file);
  assert.match(readFileSync("components/finance/finance-workspace.tsx", "utf8"), /<FinanceTilesLoading label="재무 내역을 불러오고 있습니다…" \/>/);
  assert.match(readFileSync("components/finance/profit-loss.tsx", "utf8"), /<FinanceTilesLoading label="원장을 불러오는 중이에요…" \/>/);
});

test("a redraw runs only the figures that changed, from their old value", async () => {
  const { runFigures } = await import("../lib/count-text.mjs");
  const frames = [];
  globalThis.requestAnimationFrame = (step) => frames.push(step);
  const node = (value) => ({ nodeValue: value, isConnected: true });
  const tile = (text) => { const n = node(text); return { n, el: { ownerDocument: { createTreeWalker: () => { let done = false; return { nextNode: () => done ? null : (done = true, n) }; } } } }; };
  const draw = (texts) => { const tiles = texts.map(tile); runFigures({ querySelectorAll: () => tiles.map((t) => t.el) }, ".fin-v", memory, (_, i) => String(i)); return tiles; };
  const memory = new Map();
  let tiles = draw(["1,000만 원", "50건"]);
  assert.deepEqual(tiles.map((t) => t.n.nodeValue), ["0만 원", "0건"], "first draw starts from 0");
  frames.splice(0).forEach((step) => { step(1); step(10_000); });
  tiles = draw(["1,000만 원", "80건"]);
  assert.deepEqual(tiles.map((t) => t.n.nodeValue), ["1,000만 원", "50건"], "unchanged stays, changed starts from its old value");
  frames.splice(0).forEach((step) => { step(1); step(10_000); });
  assert.equal(tiles[1].n.nodeValue, "80건");
  delete globalThis.requestAnimationFrame;
});
