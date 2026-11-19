"""숏폼 웹 렌더러 (「롱폼 재활용 숏폼 정본」 §9): index.html + engine.js build one GSAP timeline from story.json and theme.json; headless
Chrome seeks it frame by frame and pipes the frames to ffmpeg with the voice. The page's own layout check runs first.
usage: python render.py story.json voice.wav out.mp4 --fonts DIR --photos DIR [--theme theme.json] [--format 9:16|1:1|4:5] [--qa-only] [--sheets DIR]
  --format: the frame (theme "formats"); 1:1 · 4:5 are feed sizes that fit the vertical design's text band into the frame.
  --sheets DIR: no video; one still per scene, twelve to a sheet (preview_01.png …) and sheets.json { cells, scenes } in DIR.
  Prints the check; writes out.qa.json { errors, issues, lines }. Exit 1 when the page fails, 2 when the check finds problems."""
import argparse, io, json, os, subprocess, sys, time
from pathlib import Path
from playwright.sync_api import sync_playwright

HERE = Path(__file__).resolve().parent
ap = argparse.ArgumentParser()
ap.add_argument("story"); ap.add_argument("voice"); ap.add_argument("out")
ap.add_argument("--fonts", required=True); ap.add_argument("--photos", required=True); ap.add_argument("--theme", default=str(HERE / "theme.json"))
ap.add_argument("--qa-only", action="store_true"); ap.add_argument("--sheets"); ap.add_argument("--format", default="9:16")
a = ap.parse_args()
Path(a.out).parent.mkdir(parents=True, exist_ok=True)

theme = json.loads(Path(a.theme).read_text()); story = json.loads(Path(a.story).read_text())
story["photoBase"] = Path(a.photos).resolve().as_uri() + "/"
assets = {"gsap": (HERE / "vendor" / "gsap.min.js").as_uri(), "fonts": Path(a.fonts).resolve().as_uri() + "/"}
if a.format not in theme["formats"]: sys.exit(f"unknown format {a.format}")
FMT = theme["formats"][a.format]
FPS, DUR, W, H = theme["frame"]["fps"], float(story["duration"]), FMT["w"], FMT["h"]
FF = os.environ.get("FFMPEG", "ffmpeg")


def brief(issues):
    """one line per (element, problem): first and last time; hits shorter than 0.25 s happen mid-motion"""
    seen = {}
    for t, label, what in issues:
        k = (label, what.split(" ")[0]); v = seen.setdefault(k, [t, t, what]); v[1] = t   # first word names the problem
    return [(v[0], v[1], label, v[2], v[1] - v[0] < 0.25) for (label, _), v in sorted(seen.items(), key=lambda x: x[1][0])]


def moment(sc):
    """what a scene builds up to: just after its last timed change (…At / at), else three quarters in; never in its exit"""
    ts = []
    def walk(o):
        if isinstance(o, dict):
            for k, v in o.items():
                if (k == "at" or k.endswith("At")) and isinstance(v, (int, float)): ts.append(v)
                else: walk(v)
        elif isinstance(o, list):
            for v in o: walk(v)
    walk(sc)
    end = sc["to"] - 0.3
    last = max([t for t in ts if t <= end - 0.1], default=None)
    return max(sc["from"] + 0.6, min(end, last + 0.7 if last is not None else sc["from"] + 0.75 * (sc["to"] - sc["from"])))


def sheets(pg, out_dir):
    """one still per scene at its moment(), numbered, twelve to a sheet (4 × 3)"""
    from PIL import Image, ImageDraw, ImageFont
    out = Path(out_dir); out.mkdir(parents=True, exist_ok=True)
    cw, cols = 270, 4; ch = round(cw * H / W)
    font = ImageFont.truetype(str(Path(a.fonts) / theme["fonts"]["files"]["900"]), 34)
    scenes = story["scenes"]; names = []
    for k in range(0, len(scenes), 12):
        part = scenes[k:k + 12]; rows = (len(part) + cols - 1) // cols
        sheet = Image.new("RGB", (cw * cols, ch * rows), "white")
        for i, sc in enumerate(part):
            pg.evaluate(f"window.__seek({max(0, moment(sc)):.3f})")
            cell = Image.open(io.BytesIO(pg.screenshot(type="png"))).convert("RGB").resize((cw, ch))
            d = ImageDraw.Draw(cell); n = str(k + i + 1)
            d.rounded_rectangle((10, ch - 56, 66, ch - 10), 12, fill=theme["colors"]["brand"]); d.text((38, ch - 33), n, font=font, fill="white", anchor="mm")
            sheet.paste(cell, ((i % cols) * cw, (i // cols) * ch))
        names.append(f"preview_{len(names) + 1:02d}.png"); sheet.save(out / names[-1])
    (out / "sheets.json").write_text(json.dumps({"sheets": names, "cells": list(range(1, len(scenes) + 1)), "scenes": len(scenes)}))


with sync_playwright() as p:
    b = p.chromium.launch(executable_path=os.environ.get("CHROME_PATH") or None, args=["--force-color-profile=srgb", "--hide-scrollbars", "--allow-file-access-from-files"])
    pg = b.new_page(viewport={"width": W, "height": H}, device_scale_factor=1)
    errors = []
    pg.on("pageerror", lambda e: errors.append(str(e)))
    pg.add_init_script(f"window.__THEME = {json.dumps(theme, ensure_ascii=False)}; window.__STORY = {json.dumps(story, ensure_ascii=False)}; window.__ASSETS = {json.dumps(assets)}; window.__FORMAT = {json.dumps(FMT)};")
    pg.goto((HERE / "index.html").as_uri())
    try:
        pg.wait_for_function("window.__ready === true || window.__error", timeout=30000)
    except Exception:
        pass
    if errors or not pg.evaluate("window.__ready === true"):
        print("page failed:", pg.evaluate("window.__error || null"), errors); b.close(); sys.exit(1)
    t0 = time.time()
    issues = pg.evaluate("window.__qaAll(0.1)")
    lines = brief(issues)
    real = [l for l in lines if not l[4]]
    Path(a.out).with_suffix(".qa.json").write_text(json.dumps({"errors": errors, "issues": issues,
        "lines": [f"{s:.1f}–{e:.1f}초 「{label}」: {what}" for s, e, label, what, motion in real]}, ensure_ascii=False, indent=1))
    print(f"QA {time.time() - t0:.1f}s · problems {len(real)} (+{len(lines) - len(real)} mid-motion)")
    for s, e, label, what, motion in lines:
        print(f"  {s:5.1f}–{e:5.1f}s  {label}: {what}{'  (0.25초 안 · 움직이는 중)' if motion else ''}")
    if a.sheets:
        sheets(pg, a.sheets)
    elif not a.qa_only:
        ff = subprocess.Popen([FF, "-y", "-loglevel", "error", "-f", "image2pipe", "-framerate", str(FPS), "-i", "-", "-i", a.voice,
                               "-map", "0:v", "-map", "1:a", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-crf", "17", "-preset", "medium",
                               "-af", "pan=stereo|c0=c0|c1=c0,loudnorm=I=-14:TP=-1.5:LRA=11", "-ar", "48000", "-c:a", "aac", "-b:a", "192k",
                               "-t", str(DUR), a.out], stdin=subprocess.PIPE)
        t0 = time.time(); n = int(DUR * FPS)
        for i in range(n):
            pg.evaluate(f"window.__seek({i / FPS:.4f})")
            ff.stdin.write(pg.screenshot(type="jpeg", quality=93))
        ff.stdin.close()
        if ff.wait() != 0: print("ffmpeg failed"); b.close(); sys.exit(1)
        print(f"rendered {n} frames in {time.time() - t0:.1f}s → {a.out}")
    b.close()
    sys.exit(2 if real else 0)
