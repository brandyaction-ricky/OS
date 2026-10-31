#!/usr/bin/env node
// 모든 메뉴의 '계산된 스타일 지문'을 뽑고, 기준과 비교한다 (공통 스타일 가이드 v1.0).
// CSS 를 옮기거나 레이어를 바꿀 때 화면이 정말 그대로인지, 바뀐다면 어디가 바뀌는지 숫자로 본다.
//
// 준비: 체험 모드로 빌드·실행
//   NEXT_PUBLIC_DEMO_MODE=true HR_WORKSPACE_ENABLED=true TEAM_V1_ENABLED=true YOUTUBE_V1_ENABLED=true npm run build
//   NEXT_PUBLIC_DEMO_MODE=true HR_WORKSPACE_ENABLED=true TEAM_V1_ENABLED=true YOUTUBE_V1_ENABLED=true npx next start -p 3100 -H 127.0.0.1
// 사용:
//   node tools/css-fingerprint.mjs out/base.json                 바꾸기 전에 한 번
//   node tools/css-fingerprint.mjs out/after.json out/base.json  바꾼 뒤 비교 (메뉴별 다른 요소 수 + 예시)
// 같은 빌드를 두 번 재도 /knowledge?tab=canon 표 칸 10개 정도는 너비가 조금 달라진다(데이터 그리기 순서) — 잡음으로 본다.
import { chromium } from "@playwright/test";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";

const BASE_URL = process.env.FP_BASE_URL || "http://127.0.0.1:3100";
const ROUTES = `/home /content/topics /content/scripts /content/packages /content/shorts /content/publishing /content/youtube /content/performance
/automation/dashboard /automation/topics /automation/cardnews /automation/shorts /automation/threads /automation/review /automation/calendar
/automation/calendar?tab=history /automation/performance /automation/performance?tab=metrics /automation/requests /automation/requests?tab=browsers
/automation/settings /automation/settings?tab=skills /automation/settings?tab=templates /knowledge?tab=canon /knowledge/vault /knowledge/notes
/knowledge/meetings /knowledge/trash /organization/meetings /organization/meetings?tab=decisions /organization/tasks /organization/tasks?view=board
/organization/schedule /organization/people /hr/employees /hr/leave /hr/leave-ledger /hr/documents /finance/overview /finance/sales
/finance/settlements /finance/bank /finance/cards /finance/recurring /finance/budget /knowledge/development /knowledge/development?tab=updates
/organization/agents /settings/connections /settings/access /settings/audit /settings/company
/content/projects?view=discover /content/projects?platform=longform /content/projects?platform=short /content/projects?platform=ad /content/projects?platform=card
/content/card-canon /content/schedule /content/links /content/confirm /content/plan /content/voice-dictionary /content/overview
/automation/references /hr/my-leave /finance/vat`.split(/\s+/); // 둘째 줄부터 10/31 보충 2장 4 (유튜브 공정 v1 화면 — 체험 빌드에 YOUTUBE_V1_ENABLED=true)
// 눌러야 나오는 화면 (편집기 등)
const STATES = [{ name: "vault 새 페이지(편집기)", route: "/knowledge/vault", click: "새 페이지" }];
const PROPS = ["display", "position", "width", "height", "color", "backgroundColor", "fontSize", "fontWeight", "fontFamily", "paddingTop", "paddingLeft",
  "marginTop", "marginLeft", "borderTopLeftRadius", "borderTopColor", "borderTopWidth", "gap", "gridTemplateColumns", "lineHeight", "opacity",
  "boxShadow", "textDecorationLine", "visibility", "zIndex"];
const grab = P => { const out = []; document.querySelectorAll("body *").forEach(e => { if (e.closest("svg")) return; const s = getComputedStyle(e);
  out.push(`${e.tagName}.${typeof e.className === "string" ? e.className : ""}`.slice(0, 60) + "#" + P.map(p => s[p]).join("|")); }); return out; };

const [outPath, basePath] = process.argv.slice(2);
if (!outPath) { console.error("사용: node tools/css-fingerprint.mjs <out.json> [base.json]"); process.exit(1); }
const browser = await chromium.launch(process.env.PW_CHROMIUM ? { executablePath: process.env.PW_CHROMIUM } : {}); // 설치된 브라우저 판이 다르면 PW_CHROMIUM=경로
const page = await (await browser.newContext({ viewport: { width: 1440, height: 900 }, reducedMotion: "reduce" })).newPage();
const res = {};
for (const r of ROUTES) {
  try { await page.goto(BASE_URL + r, { waitUntil: "networkidle", timeout: 45000 }); await page.waitForTimeout(900); await page.evaluate(() => document.fonts.ready); res[r] = await page.evaluate(grab, PROPS); }
  catch (e) { res[r] = ["ERR " + String(e).slice(0, 120)]; }
}
for (const s of STATES) {
  try { await page.goto(BASE_URL + s.route, { waitUntil: "networkidle", timeout: 45000 }); await page.waitForTimeout(1200);
    await page.getByRole("button", { name: s.click }).first().click(); await page.waitForTimeout(2500); res[s.name] = await page.evaluate(grab, PROPS); }
  catch (e) { res[s.name] = ["ERR " + String(e).slice(0, 120)]; }
}
await browser.close();
mkdirSync(dirname(outPath), { recursive: true });
writeFileSync(outPath, JSON.stringify(res));
if (!basePath) { console.log(`화면 ${Object.keys(res).length}개 · 요소 ${Object.values(res).reduce((a, v) => a + v.length, 0)}개 저장`); process.exit(0); }

const base = JSON.parse(readFileSync(basePath, "utf8"));
let total = 0;
for (const r of Object.keys(res)) {
  const a = base[r] || [], b = res[r];
  if (a.length !== b.length) console.log(`${r}  요소 수 다름 ${a.length} → ${b.length} (화면 구조가 바뀜 — 데이터·코드 확인)`);
  const diff = [];
  for (let i = 0; i < Math.min(a.length, b.length); i++) if (a[i] !== b[i]) diff.push(i);
  total += diff.length;
  if (!diff.length) continue;
  const show = diff.slice(0, 3).map(i => { const [id, sa] = a[i].split("#"); const sb = b[i].split("#")[1].split("|");
    return id.slice(0, 40) + " " + sa.split("|").map((x, j) => x !== sb[j] ? `${PROPS[j]}:${x}→${sb[j]}` : "").filter(Boolean).join(",").slice(0, 150); });
  console.log(`${r.padEnd(40)} 다른 요소 ${diff.length}  ${show.join(" ;; ")}`);
}
console.log(`합계 ${total}`);
