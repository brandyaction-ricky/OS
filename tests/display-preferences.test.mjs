import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (file) => readFile(new URL(`../${file}`, import.meta.url), "utf8");

const luminance = (hex) => {
  const channels = hex.match(/[\da-f]{2}/gi).map((value) => Number.parseInt(value, 16) / 255);
  const [red, green, blue] = channels.map((value) => value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4);
  return (0.2126 * red) + (0.7152 * green) + (0.0722 * blue);
};

const contrast = (foreground, background) => {
  const values = [luminance(foreground), luminance(background)].sort((a, b) => b - a);
  return (values[0] + 0.05) / (values[1] + 0.05);
};

test("topbar theme and guidance retain persistent preferences", async () => {
  const [shell, layout] = await Promise.all([
    read("components/app-shell.tsx"),
    read("app/layout.tsx"),
  ]);

  // The light/dark button sits in the top bar beside the guide switch, where it can be seen (owner request 2026-10-25).
  assert.match(shell, /사용 가이드<\/span>[\s\S]{0,200}data-ui="theme-toggle"/);
  assert.match(shell, /라이트.*모드로 바꾸기/);
  assert.match(shell, /role="switch"/);
  assert.match(shell, /사용 가이드/);
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

  const palette = await read("app/theme-tokens.css");
  assert.match(palette, /html\[data-theme="light"\]/);
  assert.match(palette, /--bg: #f2f0f4/);
  assert.match(css, /\.stage-rail/);
  assert.match(css, /\.record-drawer/);
  assert.match(css, /\.knowledge-graph-main/);
  assert.match(css, /\.mode-switch button\.active/);
  assert.match(css, /\.status-filters > button\.active/);
  assert.doesNotMatch(css, /var\(--light-/);
  assert.match(css, /\.example-queries button:hover/);
  assert.match(css, /\.calendar-platforms button\.active/);
  assert.match(css, /html\[data-guidance="off"\]/);
  assert.match(css, /\.page-title-group > p/);
  assert.match(css, /\.panel-header p/);
  assert.match(css, /\.kit-guide/);
  assert.match(css, /\.package-footnote/);
});

test("light palette keeps normal text and interactive accents readable", () => {
  assert.ok(contrast("#171b23", "#ffffff") >= 7);
  assert.ok(contrast("#3d4756", "#ffffff") >= 7);
  assert.ok(contrast("#626e80", "#f5f7fa") >= 4.5);
  assert.ok(contrast("#3f5fd7", "#ffffff") >= 4.5);
});
