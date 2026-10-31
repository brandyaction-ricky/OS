// 어떤 CSS 규칙이 그 값을 정했는지 찾기 (CDP). node trace.cjs '<json: [{route, sel, props:[..], theme, w}]>'
const { chromium } = require("playwright");
const BASE = "http://127.0.0.1:3100";
const jobs = JSON.parse(process.argv[2]);
(async () => {
  const b = await chromium.launch(process.env.PW_CHROMIUM ? { executablePath: process.env.PW_CHROMIUM } : {});
  for (const j of jobs) {
    const ctx = await b.newContext({ viewport: { width: j.w || 1440, height: 900 }, colorScheme: j.theme || "dark" });
    await ctx.addInitScript(t => { try { localStorage.setItem("brandy-os-theme", t); localStorage.setItem("brandy-os-menu-guide-final", "seen"); } catch (e) {} }, j.theme || "dark");
    const p = await ctx.newPage();
    await p.goto(BASE + j.route, { waitUntil: "networkidle" }); await p.waitForTimeout(900);
    if (j.click) { await p.getByRole("button", { name: j.click }).first().click().catch(() => {}); await p.waitForTimeout(1200); }
    const cdp = await ctx.newCDPSession(p);
    await cdp.send("DOM.enable"); await cdp.send("CSS.enable");
    const { root } = await cdp.send("DOM.getDocument", { depth: -1 });
    const { nodeIds } = await cdp.send("DOM.querySelectorAll", { nodeId: root.nodeId, selector: j.sel });
    const nodeId = nodeIds[j.nth || 0];
    if (!nodeId) { console.log(JSON.stringify({ route: j.route, sel: j.sel, error: "no node" })); await ctx.close(); continue; }
    const m = await cdp.send("CSS.getMatchedStylesForNode", { nodeId });
    const comp = await cdp.send("CSS.getComputedStyleForNode", { nodeId });
    const out = { route: j.route, sel: j.sel, computed: {}, winners: {} };
    for (const prop of j.props) {
      out.computed[prop] = (comp.computedStyle.find(c => c.name === prop) || {}).value;
      const hits = [];
      if (m.inlineStyle) for (const pr of m.inlineStyle.cssProperties) if (pr.name === prop && pr.value) hits.push({ sel: "[style]", v: pr.value });
      for (const rm of (m.matchedCSSRules || [])) {
        const r = rm.rule; for (const pr of r.style.cssProperties) if ((pr.name === prop || (prop.startsWith(pr.name + "-") && ["border", "padding", "margin", "font", "background", "border-radius", "outline"].includes(pr.name))) && pr.value && !pr.disabled)
          hits.push({ sel: r.selectorList.text.slice(0, 160), v: pr.value + (pr.important ? " !important" : ""), origin: r.origin });
      }
      out.winners[prop] = hits.reverse().slice(0, 4); // 뒤에 있는 규칙이 앞(이기는 쪽에 가까움)
    }
    console.log(JSON.stringify(out));
    await ctx.close();
  }
  await b.close();
})();
