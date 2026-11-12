import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

// 2026-11-12: the company automation settings (자동 수집 included) had no screen; they are the 「회사 설정」 tab of 자동화 설정.
const read = (file) => readFileSync(new URL(`../${file}`, import.meta.url), "utf8");

test("자동화 설정 has a 회사 설정 tab that shows the company settings form, reachable from the menu", () => {
  const v07 = read("components/content-automation-v07.tsx");
  assert.match(v07, /\{id:"company",label:"회사 설정"\}/);
  assert.match(v07, /:tab==="company"\?<><p[^>]*>.*회사.*<ContentAutomationSettings embedded\/>/);
  assert.match(v07, /\["run","skills","templates","defaults","company"\]\.includes/);
  assert.match(read("components/content-automation-hub.tsx"), /\{embedded \? null : <header className="page-header">/);
  assert.match(read("lib/navigation.ts"), /\{ label: "회사 설정", href: "\/automation\/settings\?tab=company" \}/);
  assert.match(read("components/content-generation-settings.tsx"), /href="\/automation\/settings\?tab=company"/);
});
