"""숏폼 웹 렌더러 (「롱폼 재활용 숏폼 정본」 §9): index.html + engine.js build one GSAP timeline from story.json and theme.json;
headless Chrome seeks it frame by frame, the frames go to ffmpeg with the voice. The page's own layout QA runs first.
usage: python render.py story.json voice.wav out.mp4 --assets DIR [--photos DIR] [--theme theme.json] [--qa-only]
  DIR holds gsap.min.js and fonts/; photos default to DIR/photos/. Exit code 2 when QA finds problems (the video is still made)."""
import argparse, json, os, subprocess, sys, time
from pathlib import Path
from playwright.sync_api import sync_playwright

HERE = Path(__file__).resolve().parent
ap = argparse.ArgumentParser()
ap.add_argument("story"); ap.add_argument("voice"); ap.add_argument("out")
ap.add_argument("--assets", required=True); ap.add_argument("--photos"); ap.add_argument("--theme", default=str(HERE / "theme.json"))
ap.add_argument("--qa-only", action="store_true")
a = ap.parse_args()

theme = json.loads(Path(a.theme).read_text()); story = json.loads(Path(a.story).read_text())
assets = Path(a.assets).resolve().as_uri() + "/"
story["photoBase"] = Path(a.photos or Path(a.assets) / "photos").resolve().as_uri() + "/"
FPS, DUR, W, H = theme["frame"]["fps"], float(story["duration"]), theme["frame"]["w"], theme["frame"]["h"]
FF = os.environ.get("FFMPEG", "ffmpeg")


def brief(issues):
    """one line per (element, problem): first and last time; hits shorter than 0.25 s happen mid-motion"""
    seen = {}
    for t, label, what in issues:
        k = (label, what.split(" ")[0]); v = seen.setdefault(k, [t, t, what]); v[1] = t
    return [(v[0], v[1], label, v[2], v[1] - v[0] < 0.25) for (label, _), v in sorted(seen.items(), key=lambda x: x[1][0])]


with sync_playwright() as p:
    b = p.chromium.launch(executable_path=os.environ.get("CHROME_PATH") or None, args=["--force-color-profile=srgb", "--hide-scrollbars", "--allow-file-access-from-files"])
    pg = b.new_page(viewport={"width": W, "height": H}, device_scale_factor=1)
    errors = []
    pg.on("pageerror", lambda e: errors.append(str(e)))
    pg.add_init_script(f"window.__THEME = {json.dumps(theme, ensure_ascii=False)}; window.__STORY = {json.dumps(story, ensure_ascii=False)}; window.__ASSETS = {json.dumps(assets)};")
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
    Path(a.out).with_suffix(".qa.json").write_text(json.dumps({"errors": errors, "issues": issues}, ensure_ascii=False, indent=1))
    real = [l for l in lines if not l[4]]
    print(f"QA {time.time() - t0:.1f}s · problems {len(real)} (+{len(lines) - len(real)} mid-motion)")
    for s, e, label, what, motion in lines:
        print(f"  {s:5.1f}–{e:5.1f}s  {label}: {what}{'  (0.25초 안 · 움직이는 중)' if motion else ''}")
    if not a.qa_only:
        ff = subprocess.Popen([FF, "-y", "-loglevel", "error", "-f", "image2pipe", "-framerate", str(FPS), "-i", "-", "-i", a.voice,
                               "-map", "0:v", "-map", "1:a", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-crf", "17", "-preset", "medium",
                               "-af", "pan=stereo|c0=c0|c1=c0,loudnorm=I=-14:TP=-1.5:LRA=11", "-ar", "48000", "-c:a", "aac", "-b:a", "192k",
                               "-t", str(DUR), a.out], stdin=subprocess.PIPE)
        t0 = time.time(); n = int(DUR * FPS)
        for i in range(n):
            pg.evaluate(f"window.__seek({i / FPS:.4f})")
            ff.stdin.write(pg.screenshot(type="jpeg", quality=93))
        ff.stdin.close(); ff.wait()
        print(f"rendered {n} frames in {time.time() - t0:.1f}s → {a.out}")
    b.close()
    sys.exit(2 if real else 0)
