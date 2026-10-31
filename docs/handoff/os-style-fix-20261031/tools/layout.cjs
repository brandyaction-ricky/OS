const { chromium } = require("playwright"); const fs = require("fs");
const BASE = "http://127.0.0.1:3100";
const R = process.argv.slice(2);
(async () => { const b = await chromium.launch(process.env.PW_CHROMIUM ? { executablePath: process.env.PW_CHROMIUM } : {}); const ctx = await b.newContext({ viewport: { width: 1440, height: 900 }, colorScheme: "light", reducedMotion: "reduce" });
 await ctx.addInitScript(() => { try { localStorage.setItem("brandy-os-theme", "light"); localStorage.setItem("brandy-os-menu-guide-final", "seen"); } catch (e) {} });
 const p = await ctx.newPage(); const out = {};
 for (const r of R) { try { await p.goto(BASE + r, { waitUntil: "networkidle", timeout: 45000 }); await p.waitForTimeout(700);
  out[r] = await p.evaluate(() => { const m = document.querySelector("main"); const mr = m.getBoundingClientRect(); const h = [...m.querySelectorAll("h1")].find(e => e.getBoundingClientRect().height > 0);
   const hr = h ? h.getBoundingClientRect() : null; const sub = h ? (h.parentElement.querySelector("p") || h.nextElementSibling) : null;
   // 내용 폭: main 안에서 가장 넓은 블록(넓이 > 300) 중 첫 깊이
   let box = m.firstElementChild; let depth = 0; while (box && box.children.length === 1 && depth < 4) { box = box.firstElementChild; depth++; }
   const br = box ? box.getBoundingClientRect() : null; const cs = getComputedStyle(m);
   return { mainX: Math.round(mr.x), mainW: Math.round(mr.width), mainPad: cs.paddingTop + " " + cs.paddingLeft, h1x: hr && Math.round(hr.x), h1y: hr && Math.round(hr.y), h1fs: h && getComputedStyle(h).fontSize, h1t: h && h.innerText.slice(0, 20),
    boxX: br && Math.round(br.x), boxW: br && Math.round(br.width), boxCls: box && (box.className + "").slice(0, 50), subFs: sub && getComputedStyle(sub).fontSize, sub: sub && (sub.innerText || "").slice(0, 30) }; });
 } catch (e) { out[r] = { err: String(e).slice(0, 100) }; } }
 fs.writeFileSync(__dirname + "/layout.json", JSON.stringify(out, null, 1)); await b.close(); console.log("layout done"); })();
