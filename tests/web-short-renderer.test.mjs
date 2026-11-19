import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";

const dir = new URL("../tools/web-short/", import.meta.url);
const engine = readFileSync(new URL("engine.js", dir), "utf8");
const theme = JSON.parse(readFileSync(new URL("theme.json", dir), "utf8"));

test("every scene in the example storyboards has a template, and subtitles stay one short line", () => {
  for (const f of readdirSync(new URL("examples/", dir))) {
    const story = JSON.parse(readFileSync(new URL(`examples/${f}`, dir), "utf8"));
    for (const s of story.scenes) assert.match(engine, new RegExp(`\\n    ${s.type}\\(s\\) \\{`), `${f}: no template for ${s.type}`);
    for (const [a, b, text] of story.subtitles) {
      assert.ok(b > a && b <= story.duration + 0.01, `${f}: subtitle time ${a}–${b}`);
      assert.ok(text.replace(/\s/g, "").length <= 14, `${f}: subtitle over 14 letters: ${text}`);
    }
  }
});

test("design values the templates read are all in theme.json", () => {
  for (const [, group, key] of engine.matchAll(/\bT\.(\w+)\.(\w+)/g)) assert.ok(theme[group] && key in theme[group], `theme.${group}.${key}`);
  for (const [, key] of engine.matchAll(/\bC\.(\w+)/g)) assert.ok(key in theme.colors, `colors.${key}`);
  for (const [, key] of engine.matchAll(/\bM\.(\w+)/g)) assert.ok(key in theme.motion, `motion.${key}`);
  for (const [, key] of engine.matchAll(/\bG\.(\w+)/g)) assert.ok(key in theme.grid, `grid.${key}`);
});
