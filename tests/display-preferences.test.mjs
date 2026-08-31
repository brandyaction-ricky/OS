import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (file) => readFile(new URL(`../${file}`, import.meta.url), "utf8");

test("the global header exposes persistent theme and guidance controls", async () => {
  const [shell, layout] = await Promise.all([
    read("components/app-shell.tsx"),
    read("app/layout.tsx"),
  ]);

  assert.match(shell, /aria-label="화면 설정"/);
  assert.match(shell, /라이트.*모드로 전환/);
  assert.match(shell, /role="switch"/);
  assert.match(shell, /기능 설명 안내/);
  assert.match(shell, /brandy-os-theme/);
  assert.match(shell, /brandy-os-guidance/);
  assert.match(shell, /window\.localStorage\.setItem/);

  assert.match(layout, /prefers-color-scheme: light/);
  assert.match(layout, /document\.documentElement\.dataset\.theme/);
  assert.match(layout, /document\.documentElement\.dataset\.guidance/);
  assert.match(layout, /suppressHydrationWarning/);
});

test("light theme and guidance-off rules cover global workspaces", async () => {
  const css = await read("app/globals.css");

  assert.match(css, /html\[data-theme="light"\]/);
  assert.match(css, /--bg: #f4f6fa/);
  assert.match(css, /\.stage-rail,/);
  assert.match(css, /\.record-drawer,/);
  assert.match(css, /\.knowledge-graph-main,/);
  assert.match(css, /html\[data-guidance="off"\]/);
  assert.match(css, /\.page-title-group > p/);
  assert.match(css, /\.panel-header p/);
  assert.match(css, /\.kit-guide/);
  assert.match(css, /\.package-footnote/);
});
