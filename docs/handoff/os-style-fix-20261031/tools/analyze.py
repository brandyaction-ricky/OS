import json, sys, re, collections
d = json.load(open(sys.argv[1]))
R = d["routes"]
def menu(r):
    p = r.split("?")[0]
    if p == "/home": return "홈"
    if p == "/content/confirm": return "대표 메뉴"
    if r.startswith("/content/projects?view") or p in ("/content/schedule", "/content/performance", "/content/links"): return "공통(유튜브 공정)"
    if r.startswith("/content/projects") or p in ("/content/card-canon", "/content/plan", "/content/make", "/content/final-check", "/content/upload", "/content/shorts", "/content/voice-dictionary"): return "플랫폼별 영상(롱폼·숏폼·광고·카드)"
    if p.startswith("/content"): return "옛 콘텐츠 화면(메뉴 밖)"
    if p in ("/automation/references", "/automation/topics", "/automation/threads", "/automation/review", "/automation/calendar", "/automation/performance"): return "스레드"
    if p.startswith("/automation"): return "자동화 관리"
    if p in ("/knowledge/development",) or p == "/organization/agents": return "개발"
    if p == "/knowledge/meetings" or p.startswith("/organization"): return "업무 기록"
    if p.startswith("/knowledge"): return "회사 문서"
    if p.startswith("/hr"): return "인사 노무"
    if p.startswith("/finance"): return "재무"
    if p.startswith("/settings"): return "설정"
    return "기타"
CTRL = {24, 28, 32, 40}
TOKRAD = {"0px", "4px", "6px", "8px", "10px", "14px", "999px", "50%", "9999px"}
rows = []
for r, modes in R.items():
    L, D, M = modes.get("light", {}), modes.get("dark", {}), modes.get("mobile", {})
    if "error" in L or not L: rows.append({"route": r, "menu": menu(r), "error": L.get("error", "none")}); continue
    bh = collections.Counter(); [bh.update({int(h): n}) for h, n in L["btnH"]]
    off_btn = sum(n for h, n in bh.items() if not any(abs(h - c) <= 1 for c in CTRL))
    btn_total = sum(bh.values())
    inp = [(s.split(" ")[0], n) for s, n in L["inputs"]]
    inp_h = collections.Counter(); [inp_h.update({int(s.split("/")[0]): n}) for s, n in inp]
    off_inp = sum(n for h, n in inp_h.items() if abs(h - 32) > 1)
    pan = dict(L["panels"]); off_pan = sum(n for k, n in pan.items() if k != "10px")
    rows.append({
        "route": r, "menu": menu(r), "kit": "ui-v2" in (L["mainClass"] + " " + L["root"]), "main": L["mainClass"], "root": L["root"],
        "h1": [h["fs"] for h in L["h1"]], "btnN": btn_total, "btnH": dict(bh), "offBtn": off_btn,
        "btnFs": dict(L["btnFs"]), "btnRad": dict(L["btnRad"]), "primary": L["primary"][:3],
        "inpH": dict(inp_h), "offInp": off_inp, "inpN": sum(inp_h.values()), "inputs": L["inputs"][:4],
        "pan": pan, "offPan": off_pan,
        "u11": L["under11n"], "u11s": L["under11"][:4], "offScale": L["offScaleN"], "offScaleS": L["offScale"][:5], "textN": L["textN"],
        "lowL": L["lowCn"], "lowD": D.get("lowCn"), "lowDs": [f'{x["cr"]} {x["fs"]}px {x["c"]} «{x["t"]}» {x["fg"]} on {x["bg"]}' for x in D.get("lowC", [])[:6]],
        "lowLs": [f'{x["cr"]} {x["fs"]}px {x["c"]} «{x["t"]}» {x["fg"]} on {x["bg"]}' for x in L.get("lowC", [])[:6]],
        "inline": L["inline"], "inlineV": L["inlineVisual"], "inlineS": L["inlineSample"][:4],
        "mOver": M.get("docOver"), "mOverEls": M.get("overEls", [])[:4], "mTiny": M.get("tinyN"), "mTinyS": M.get("tiny", [])[:4], "mU11": M.get("under11n"),
        "offTokD": D.get("offTokN"), "offTokDs": D.get("offTok", [])[:8], "fams": L["fams"], "clipped": L["clipped"][:3], "mClipped": M.get("clipped", [])[:3],
        "final": L.get("finalUrl"),
    })
json.dump(rows, open(sys.argv[2], "w"), ensure_ascii=False, indent=1)
# 요약 표
order = ["홈", "대표 메뉴", "공통(유튜브 공정)", "플랫폼별 영상(롱폼·숏폼·광고·카드)", "옛 콘텐츠 화면(메뉴 밖)", "스레드", "자동화 관리", "회사 문서", "업무 기록", "인사 노무", "재무", "개발", "설정", "기타"]
for m in order:
    rs = [x for x in rows if x["menu"] == m]
    if not rs: continue
    print(f"\n### {m} ({len(rs)})")
    for x in rs:
        if "error" in x: print(f"  {x['route']}: ERROR {x['error'][:80]}"); continue
        print(f"  {x['route'][:38]:38s} kit={'Y' if x['kit'] else 'N'} h1={x['h1']} btn {x['offBtn']}/{x['btnN']} H{x['btnH']} fs{x['btnFs']} | inp {x['offInp']}/{x['inpN']} {x['inpH']} | pan≠10 {x['offPan']} {x['pan']} | <11 {x['u11']} off-scale {x['offScale']}/{x['textN']} | lowC L{x['lowL']} D{x['lowD']} | inlineV {x['inlineV']}/{x['inline']} | m over {x['mOver']} tiny {x['mTiny']} | offTokD {x['offTokD']}")
