import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import postcss from "postcss";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const css = postcss.parse(read("app/globals.css"));
const tokens = postcss.parse(read("app/theme-tokens.css"));
const normalize = (s) => s.replace(/\s*([>,])\s*/g, "$1").trim();
function styles(selector) {
  const result = {};
  for (const rule of css.nodes) {
    if (rule.type !== "rule" || !rule.selector.split(",").some(s => normalize(s) === normalize(selector))) continue;
    for (const d of rule.nodes) if (d.type === "decl") result[d.prop] = d.value;
  }
  return result;
}
function palette(theme) {
  const result = {};
  for (const r of tokens.nodes) if (r.type === "rule" && (r.selector === ":root" || theme === "light" && r.selector === 'html[data-theme="light"]')) {
    for (const d of r.nodes) if (d.type === "decl") result[d.prop] = d.value;
  }
  return result;
}
function luminance(hex) {
  assert.match(hex, /^#[\da-f]{6}$/i);
  const [r, g, b] = hex.slice(1).match(/../g).map(x => parseInt(x, 16) / 255).map(x => x <= .04045 ? x / 12.92 : ((x + .055) / 1.055) ** 2.4);
  return .2126 * r + .7152 * g + .0722 * b;
}
function contrast(a, b) { const l = [luminance(a), luminance(b)].sort((a,b) => b-a); return (l[0]+.05)/(l[1]+.05); }

test("screenshot-reported UI uses readable paired colors in both themes", () => {
  const selectors = [".owner-chips button.active", ".owner-chips label.active", ".task-filters button.active", ".range-filter>button.active", ".studio-tabs button.active", ".performance-filter-bar", ".connection-icon", ".ad-principle>svg", ".roster-roles b", ".roster-card em.ready", ".roster-card em", ".channel-dictionary>div:last-child>button", ".planning-facts div", ".agent-organization-row", ".csv-file-picker", ".csv-file-picker input::file-selector-button", ".task-column>header span", ".shorts-placeholder > span"];
  for (const theme of ["dark", "light"]) {
    const p = palette(theme);
    const resolve = s => { assert.match(s, /^var\(--[\w-]+\)$/); return p[s.slice(4,-1)]; };
    for (const selector of selectors) {
      const s = styles(selector);
      assert.ok(contrast(resolve(s.color), resolve(s.background)) >= 4.5, `${theme} ${selector}`);
    }
    for (const foreground of ["--text", "--text-2", "--muted", "--accent-2"]) {
      for (const surface of ["--bg", "--panel", "--panel-2", "--panel-3"]) assert.ok(contrast(p[foreground], p[surface]) >= 4.5, `${theme} ${foreground}/${surface}`);
    }
  }
});

test("theme paints are centralized and custom property references resolve", () => {
  const p = palette("light");
  for (const file of ["app/globals.css", "components/linear-shell.css", "components/development-workspace.css", "components/development-notifications.css"]) {
    const root = postcss.parse(read(file));
    root.walkRules(r => assert.ok(!r.selector.includes("data-theme"), `${file}: competing theme rule`));
    root.walkDecls(d => {
      if (!d.prop.includes("mask") && !/iframe/.test(d.parent.selector || "")) assert.doesNotMatch(d.value, /#[\da-f]{3,8}\b|rgba?\(|\b(?:white|black)\b/i, `${file}: ${d.parent.selector} ${d.prop}`);
      for (const match of d.value.matchAll(/var\((--[\w-]+)/g)) assert.ok(p[match[1]], `undefined ${match[1]}`);
    });
  }
});

test("composite search fields and file pickers do not render contrasting inner boxes", () => {
  for (const s of [".audit-search input", ".discovery-console .market-search input", ".package-search-row .market-search input", ".csv-file-picker input"]) {
    assert.equal(styles(s).background, "transparent");
    assert.equal(styles(s)["box-shadow"], "none");
  }
});

test("filter focus indicators and video output colors are preserved", () => {
  for (const s of [".owner-chips button", ".task-filters button", ".range-filter button", ".studio-tabs button"]) {
    assert.equal(styles(s + ":focus-visible").outline, "2px solid var(--accent-2)");
    assert.equal(styles(s + ":focus-visible")["outline-offset"], "2px");
  }
  assert.equal(styles(".shorts-device")["box-shadow"], "none");
  assert.ok(read("app/globals.css").includes("var(--media-shadow)"));
  assert.ok(read("app/layout.tsx").indexOf('import "./theme-tokens.css"') < read("app/layout.tsx").indexOf('import "./globals.css"'));
});
