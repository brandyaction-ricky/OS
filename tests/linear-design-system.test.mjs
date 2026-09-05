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
    "html[data-theme=\"light\"] .linear-shell",
    "@media (max-width: 820px)",
  ]) {
    assert.ok(css.includes(selector), `missing ${selector}`);
  }

  assert.match(css, /--accent: #5e6ad2/);
  assert.match(css, /box-shadow: none/);
});
