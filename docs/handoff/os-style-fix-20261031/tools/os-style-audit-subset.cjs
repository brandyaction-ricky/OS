// OS 메뉴별 스타일 측정 (2026-10-31). 체험 모드 빌드에서 읽기만 한다.
// node measure.cjs <base_url> <out.json>
const { chromium } = require("playwright");
const fs = require("fs");
const BASE = process.argv[2] || "http://127.0.0.1:3100";
const OUT = process.argv[3] || "out.json";
const TOKENS = fs.readFileSync(__dirname + "/tokens.txt", "utf8").trim().split(/\s+/);

// 1) 사이드바를 따라가며 메뉴 주소 모으기 + 알려진 주소
const SEED = `/home /content/projects?view=discover /content/projects?platform=longform /content/projects?platform=short /content/projects?platform=ad
/content/projects?platform=card /content/card-canon /content/schedule /content/performance /content/links /content/confirm /content/plan /content/make
/content/final-check /content/upload /content/shorts /content/voice-dictionary
/content/topics /content/scripts /content/video /content/packages /content/publishing /content/youtube
/automation/dashboard /automation/references /automation/topics /automation/cardnews /automation/shorts /automation/threads /automation/review
/automation/calendar /automation/calendar?tab=history /automation/performance /automation/performance?tab=metrics /automation/requests
/automation/requests?tab=browsers /automation/settings /automation/settings?tab=skills /automation/settings?tab=templates
/knowledge/vault /knowledge/notes /knowledge/canon /knowledge/trash /knowledge/meetings /knowledge/search
/organization/meetings /organization/tasks /organization/schedule /organization/members /organization/people
/hr/employees /hr/leave /hr/leave-ledger /hr/documents /hr/my-leave
/finance/overview /finance/sales /finance/settlements /finance/bank /finance/cards /finance/recurring /finance/budget /finance/vat
/knowledge/development /knowledge/development?tab=updates /organization/agents
/settings/connections /settings/access /settings/audit /settings/company /settings/account`.split(/\s+/);

function measure(TOKENS) {
  const main = document.querySelector("main.page-content") || document.querySelector("main");
  if (!main) return { error: "no main" };
  const W = innerWidth;
  const vis = e => { const r = e.getBoundingClientRect(); if (r.width < 1 || r.height < 1) return false; const s = getComputedStyle(e); return s.visibility !== "hidden" && s.display !== "none" && +s.opacity > 0.05; };
  const r1 = v => Math.round(parseFloat(v) * 10) / 10;
  const cls = e => (typeof e.className === "string" ? e.className : (e.className && e.className.baseVal) || "").trim().split(/\s+/).slice(0, 3).join(".");
  const label = e => e.tagName.toLowerCase() + (cls(e) ? "." + cls(e) : "");
  const text = e => (e.innerText || e.value || e.getAttribute("aria-label") || "").trim().replace(/\s+/g, " ").slice(0, 24);
  // 색 파서
  function parse(c) {
    if (!c) return null; let m = c.match(/^rgba?\(([^)]+)\)/);
    if (m) { const p = m[1].split(/[\s,\/]+/).filter(Boolean).map(Number); return [p[0], p[1], p[2], p[3] === undefined ? 1 : p[3]]; }
    m = c.match(/^color\(srgb ([^)]+)\)/);
    if (m) { const p = m[1].split(/[\s\/]+/).filter(Boolean).map(Number); return [p[0] * 255, p[1] * 255, p[2] * 255, p[3] === undefined ? 1 : p[3]]; }
    return null;
  }
  const lum = ([r, g, b]) => { const f = v => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }; return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b); };
  const over = (top, bot) => { const a = top[3]; return [top[0] * a + bot[0] * (1 - a), top[1] * a + bot[1] * (1 - a), top[2] * a + bot[2] * (1 - a), 1]; };
  function effBg(e) {
    const stack = []; let n = e;
    while (n && n.nodeType === 1) { const s = getComputedStyle(n); if (s.backgroundImage && s.backgroundImage !== "none") return null; const c = parse(s.backgroundColor); if (c && c[3] > 0) { stack.push(c); if (c[3] >= 0.99) break; } n = n.parentElement; }
    let base = [255, 255, 255, 1]; const bodyBg = parse(getComputedStyle(document.body).backgroundColor); if (!n && bodyBg && bodyBg[3] > 0.99) base = bodyBg;
    for (let i = stack.length - 1; i >= 0; i--) base = stack[i][3] >= 0.99 ? stack[i] : over(stack[i], base);
    return base;
  }
  const contrast = (a, b) => { const L1 = lum(a), L2 = lum(b); return (Math.max(L1, L2) + 0.05) / (Math.min(L1, L2) + 0.05); };
  const tally = (arr) => { const m = {}; arr.forEach(v => m[v] = (m[v] || 0) + 1); return Object.entries(m).sort((a, b) => b[1] - a[1]); };

  const els = [...main.querySelectorAll("*")].filter(e => !e.closest("svg") && e.tagName !== "svg");
  const visEls = els.filter(vis);
  // 제목
  const h1 = [...main.querySelectorAll("h1")].filter(vis).map(e => { const s = getComputedStyle(e); return { fs: r1(s.fontSize), fw: s.fontWeight, t: text(e), c: label(e.parentElement) }; });
  const h2 = visEls.filter(e => e.tagName === "H2").map(e => r1(getComputedStyle(e).fontSize));
  // 단추
  const btns = visEls.filter(e => e.matches("button, a[class*=button], a[class*=btn], [role=button], input[type=submit], input[type=button]") && !e.closest("[role=tablist], .segmented, .os-seg"))
    .map(e => { const r = e.getBoundingClientRect(), s = getComputedStyle(e); return { h: Math.round(r.height), w: Math.round(r.width), fs: r1(s.fontSize), rad: s.borderTopLeftRadius, bg: s.backgroundColor, c: label(e), t: text(e), primary: /primary|accent|cta|solid/.test(cls(e)) || e.matches("[data-variant=primary]") }; });
  // 입력
  const inputs = visEls.filter(e => e.matches("input:not([type=checkbox]):not([type=radio]):not([type=hidden]):not([type=range]):not([type=file]):not([type=color]), select"))
    .map(e => { const r = e.getBoundingClientRect(), s = getComputedStyle(e); return { h: Math.round(r.height), fs: r1(s.fontSize), rad: s.borderTopLeftRadius, c: label(e) }; });
  // 판(카드·패널) 둥글기
  const panels = visEls.filter(e => { const s = getComputedStyle(e); const r = e.getBoundingClientRect(); return parseFloat(s.borderTopWidth) >= 1 && parseFloat(s.borderTopLeftRadius) > 0 && r.width >= 200 && r.height >= 60 && !e.matches("button,input,select,textarea,a"); })
    .map(e => ({ rad: getComputedStyle(e).borderTopLeftRadius, c: label(e) }));
  // 글자
  const textEls = visEls.filter(e => [...e.childNodes].some(n => n.nodeType === 3 && n.textContent.trim()));
  const sizes = textEls.map(e => r1(getComputedStyle(e).fontSize));
  const SCALE = [11, 11.5, 12, 12.5, 13, 14, 15, 18, 20, 22, 24];
  const under11 = textEls.filter(e => parseFloat(getComputedStyle(e).fontSize) < 10.95).map(e => r1(getComputedStyle(e).fontSize) + " " + label(e) + " «" + text(e) + "»");
  const offScale = textEls.filter(e => { const f = r1(getComputedStyle(e).fontSize); return f < 26 && !SCALE.includes(f); }).map(e => r1(getComputedStyle(e).fontSize) + " " + label(e));
  // 대비
  const lowC = [];
  for (const e of textEls) { const s = getComputedStyle(e); if (e.closest("[disabled],[aria-disabled=true]") || e.matches(":disabled")) continue; const fg = parse(s.color); const bg = effBg(e); if (!fg || !bg) continue; const fgc = fg[3] < 1 ? over(fg, bg) : fg; const cr = contrast(fgc, bg); const big = parseFloat(s.fontSize) >= 18 || (parseFloat(s.fontSize) >= 14 && +s.fontWeight >= 700); if (cr < (big ? 3 : 4.5)) lowC.push({ cr: Math.round(cr * 100) / 100, fs: r1(s.fontSize), c: label(e), t: text(e), fg: s.color, bg: "rgb(" + bg.slice(0, 3).map(Math.round).join(",") + ")" }); }
  // 인라인 스타일
  const inl = [...main.querySelectorAll("[style]")].filter(e => !e.closest("svg"));
  const inlVisual = inl.filter(e => /(^|;)\s*(color|background|font|padding|margin|border|border-radius|gap|display|grid|box-shadow)\s*:/i.test(e.getAttribute("style")));
  // 넘침 (가로)
  const docOver = document.documentElement.scrollWidth - W;
  const scrollParent = e => { let n = e.parentElement; while (n && n !== document.body) { const s = getComputedStyle(n); if (/(auto|scroll|hidden|clip)/.test(s.overflowX)) return true; n = n.parentElement; } return false; };
  const overEls = visEls.filter(e => { const r = e.getBoundingClientRect(); return r.right > W + 1 && !scrollParent(e); }).map(e => label(e) + " r=" + Math.round(e.getBoundingClientRect().right));
  // 글자 잘림 (넘친 글자, overflow 보이는데 줄바꿈 안 됨)
  const clipped = visEls.filter(e => e.scrollWidth > e.clientWidth + 2 && e.clientWidth > 0 && ["hidden", "clip"].includes(getComputedStyle(e).overflowX) && getComputedStyle(e).textOverflow !== "ellipsis" && e.childElementCount === 0 && (e.innerText || "").trim()).map(e => label(e) + " «" + text(e) + "»");
  // 테마 밖 색 (토큰 해석값과 비교, 배경·글자만)
  const probe = document.createElement("i"); document.body.appendChild(probe);
  const tokenSet = new Set();
  for (const t of TOKENS) { probe.style.color = ""; probe.style.color = `var(${t})`; const c = getComputedStyle(probe).color; if (c) tokenSet.add(c.replace(/\s/g, "")); }
  probe.remove();
  const offTok = [];
  for (const e of visEls) { const s = getComputedStyle(e); for (const [k, v] of [["bg", s.backgroundColor], ["fg", s.color]]) { const n = v.replace(/\s/g, ""); if (n === "rgba(0,0,0,0)" || tokenSet.has(n)) continue; if (k === "fg" && !textEls.includes(e)) continue; offTok.push(k + " " + v); } }
  // 글꼴
  const fams = tally(visEls.map(e => getComputedStyle(e).fontFamily.split(",")[0].replace(/["']/g, "").trim()));
  // 사이드바 지문
  const side = [...document.querySelectorAll("aside a, nav a")].filter(vis).slice(0, 6).map(e => { const s = getComputedStyle(e); return Math.round(e.getBoundingClientRect().height) + "/" + r1(s.fontSize) + "/" + s.color; });
  const root = main.firstElementChild ? label(main.firstElementChild) : "";
  // 작은 누를 곳 (휴대폰)
  const tiny = btns.filter(b => b.h < 24 || b.w < 24).map(b => b.h + "x" + b.w + " " + b.c + " «" + b.t + "»");
  return {
    mainClass: main.className, root, theme: document.documentElement.dataset.theme || "", W,
    h1, h2: tally(h2), btnH: tally(btns.map(b => b.h)), btnFs: tally(btns.map(b => b.fs)), btnRad: tally(btns.map(b => b.rad)),
    primary: btns.filter(b => b.primary).slice(0, 6).map(b => `${b.h}/${b.fs}/${b.rad} ${b.c} «${b.t}»`),
    btnSample: btns.slice(0, 40).map(b => `${b.h}/${b.fs}/${b.rad} ${b.c} «${b.t}»`),
    inputs: tally(inputs.map(i => `${i.h}/${i.fs}/${i.rad} ${i.c}`)),
    panels: tally(panels.map(p => p.rad)), panelSample: tally(panels.map(p => p.rad + " " + p.c)).slice(0, 8),
    fontKinds: tally(sizes), under11: tally(under11).slice(0, 12), under11n: under11.length, offScale: tally(offScale).slice(0, 10), offScaleN: offScale.length, textN: textEls.length,
    lowC: lowC.slice(0, 400), lowCn: lowC.length,
    inline: inl.length, inlineVisual: inlVisual.length, inlineSample: tally(inlVisual.map(e => label(e) + " {" + e.getAttribute("style").slice(0, 70) + "}")).slice(0, 8),
    docOver, overEls: tally(overEls).slice(0, 10), clipped: tally(clipped).slice(0, 8),
    offTok: tally(offTok).slice(0, 15), offTokN: offTok.length, fams: fams.slice(0, 4), side, tiny: tiny.slice(0, 12), tinyN: tiny.length,
    elN: els.length
  };
}

(async () => {
  const browser = await chromium.launch(process.env.PW_CHROMIUM ? { executablePath: process.env.PW_CHROMIUM } : {});
  const res = { meta: { base: BASE, at: new Date().toISOString() }, routes: {}, nav: {} };
  const modes = [
    { key: "light", vp: { width: 1440, height: 900 }, scheme: "light" },
    { key: "dark", vp: { width: 1440, height: 900 }, scheme: "dark" },
    { key: "mobile", vp: { width: 390, height: 844 }, scheme: "dark", mobile: true },
  ];
  res.meta.routes = (process.env.ROUTES || '').split(/\s+/).filter(Boolean);
  for (const m of modes) {
    const ctx = await browser.newContext({ viewport: m.vp, colorScheme: m.scheme, reducedMotion: "reduce", isMobile: !!m.mobile, hasTouch: !!m.mobile, deviceScaleFactor: 1 });
    await ctx.addInitScript(s => { try { localStorage.setItem("brandy-os-theme", s); localStorage.setItem("brandy-os-menu-guide-final","seen"); } catch (e) {} }, m.scheme);
    const p = await ctx.newPage();
    for (const r of res.meta.routes) {
      try {
        await p.goto(BASE + r, { waitUntil: "networkidle", timeout: 45000 }); await p.waitForTimeout(900); await p.evaluate(() => document.fonts.ready);
        // 테마 강제 (앱이 기기 설정을 따르는 경우 대비)
        await p.evaluate(s => { document.documentElement.dataset.theme = s; }, m.scheme); await p.waitForTimeout(150);
        const v = await p.evaluate(measure, TOKENS);
        v.finalUrl = p.url().replace(BASE, "");
        (res.routes[r] ||= {})[m.key] = v;
        if (true || ["/home", "/content/projects?platform=longform", "/content/plan", "/automation/topics", "/knowledge/vault", "/organization/meetings", "/hr/employees", "/finance/sales", "/settings/connections"].includes(r))
          await p.screenshot({ path: `${process.env.SHOTS || __dirname + "/shots"}/${m.key}_${r.replace(/[\/?=&]/g, "_")}.png`, fullPage: false });
      } catch (e) { (res.routes[r] ||= {})[m.key] = { error: String(e).slice(0, 200) }; }
    }
    await ctx.close();
  }
  await browser.close();
  fs.writeFileSync(OUT, JSON.stringify(res));
  console.log("done", res.meta.routes.length);
})();
