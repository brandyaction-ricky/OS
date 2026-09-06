import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("Linear design system is loaded once from the root layout", async () => {
  const [layout, shell] = await Promise.all([
    read("app/layout.tsx"),
    read("components/app-shell.tsx"),
  ]);

  assert.match(layout, /import "\.\.\/components\/linear-shell\.css"/);
  assert.doesNotMatch(shell, /import "\.\/linear-shell\.css"/);
});

test("Linear design system changes the full application shell", async () => {
  const css = await read("components/linear-shell.css");

  for (const selector of [
    ".linear-shell .stage-rail",
    ".linear-shell .page-sidebar",
    ".linear-shell .topbar",
    ".linear-shell .panel",
    ".linear-shell .primary-button",
    ".login-card",
    "@media (max-width: 820px)",
  ]) {
    assert.ok(css.includes(selector), `missing ${selector}`);
  }

  assert.match(await read("app/theme-tokens.css"), /--accent: #5e6ad2/);
  assert.match(css, /box-shadow: none/);
});

test("Linear light theme uses layered neutral surfaces and repairs legacy dark cards", async () => {
  const css = await read("components/linear-shell.css");

  const tokens = await read("app/theme-tokens.css");
  const global = await read("app/globals.css");
  assert.match(tokens, /--bg: #f7f7f8/);
  assert.match(tokens, /--panel: #fafafa/);
  assert.doesNotMatch(css, /data-theme/);
  for (const selector of [".revenue-band", ".channel-dictionary", ".connection-row", ".audit-filters", ".knowledge-search-form"]) assert.ok(global.includes(selector));
});
