// 화면을 옮겨 다닌 뒤(클라이언트 이동) 같은 화면의 계산된 스타일이 새로 연 것과 같은지 본다.
const { chromium } = require("playwright");
const fs = require("fs");
const BASE = process.argv[2] || "http://127.0.0.1:3100";
const PROPS = ["display", "width", "height", "color", "backgroundColor", "fontSize", "fontWeight", "paddingTop", "paddingLeft", "marginTop", "borderTopLeftRadius", "borderTopColor", "borderTopWidth", "gap", "gridTemplateColumns", "lineHeight"];
const grab = P => { const m = document.querySelector("main") || document.body; const out = []; m.querySelectorAll("*").forEach(e => { if (e.closest("svg")) return; const s = getComputedStyle(e);
  out.push(`${e.tagName}.${typeof e.className === "string" ? e.className : ""}`.slice(0, 70) + "#" + P.map(p => s[p]).join("|")); }); return out; };
const TARGETS = ["/home", "/organization/meetings", "/automation/topics", "/hr/employees", "/settings/connections", "/content/projects?platform=longform", "/knowledge/vault", "/finance/overview"];
const TOUR = ["/finance/sales", "/knowledge/vault", "/content/plan", "/hr/employees", "/automation/threads", "/knowledge/notes", "/organization/schedule", "/knowledge/development", "/content/schedule"];
async function clientGo(p, href) {
  const ok = await p.evaluate(h => { const a = [...document.querySelectorAll("a[href]")].find(x => x.getAttribute("href") === h); if (!a) return false; a.click(); return true; }, href);
  if (!ok) { // 링크가 없으면 임시 링크 대신 router 사용 시도
    await p.evaluate(h => { const a = document.createElement("a"); a.href = h; document.body.appendChild(a); a.click(); }, href);
  }
  await p.waitForLoadState("networkidle").catch(() => {}); await p.waitForTimeout(1800);
  return ok;
}
(async () => {
  const b = await chromium.launch(process.env.PW_CHROMIUM ? { executablePath: process.env.PW_CHROMIUM } : {});
  const ctx = await b.newContext({ viewport: { width: 1440, height: 900 }, colorScheme: "dark", reducedMotion: "reduce" });
  await ctx.addInitScript(() => { try { localStorage.setItem("brandy-os-theme", "dark"); localStorage.setItem("brandy-os-menu-guide-final", "seen"); } catch (e) {} });
  const p = await ctx.newPage();
  const out = {};
  for (const t of TARGETS) {
    await p.goto(BASE + t, { waitUntil: "networkidle" }); await p.waitForTimeout(1500);
    const fresh = await p.evaluate(grab, PROPS);
    const cssFresh = await p.evaluate(() => [...document.querySelectorAll("link[rel=stylesheet]")].length);
    await p.reload({ waitUntil: "networkidle" }); await p.waitForTimeout(1500);
    const fresh2 = await p.evaluate(grab, PROPS); let noise = 0; for (let i = 0; i < Math.min(fresh.length, fresh2.length); i++) if (fresh[i] !== fresh2[i]) noise++;
    const tour = [];
    for (const h of TOUR) if (h !== t) tour.push(h + (await clientGo(p, h) ? "" : "(임시링크)") + "→" + p.url().replace(BASE, ""));
    const back = await clientGo(p, t);
    const after = await p.evaluate(grab, PROPS);
    const cssAfter = await p.evaluate(() => [...document.querySelectorAll("link[rel=stylesheet]")].length);
    const diffs = [];
    const n = Math.min(fresh.length, after.length);
    for (let i = 0; i < n; i++) if (fresh[i] !== after[i]) {
      const [ta, va] = fresh[i].split("#"), vb = after[i].split("#")[1];
      const A = va.split("|"), B = vb.split("|"); const ch = PROPS.map((k, j) => A[j] !== B[j] ? `${k}:${A[j]}→${B[j]}` : null).filter(Boolean);
      diffs.push(ta + " " + ch.join(" "));
    }
    out[t] = { noise, fresh2N: fresh2.length, url: p.url().replace(BASE, ""), back, tour, freshN: fresh.length, afterN: after.length, cssFresh, cssAfter, diffN: diffs.length, diffs: diffs.slice(0, 40) };
    console.log(t, "noise", noise, "els", fresh.length, after.length, "css", cssFresh, cssAfter, "diff", diffs.length);
  }
  fs.writeFileSync(__dirname + "/leak.json", JSON.stringify(out, null, 1));
  await b.close();
})();
