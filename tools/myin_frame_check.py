"""렌더 전 관문 · 빈 화면 (로건 개발 문서 v3 7.2-3, 2026-11-04) after the ③ preview, before any video is drawn.

The preview sheet shows each scene at one moment; a diagram that fails later in its scene (Logan's QA: six blank screens) is only seen
in the finished video. This draws every scene at a few moments with his engine — the same load and frame() the render uses — and lists
the moments where the picture is one flat colour, and those where the engine fails to draw (그리기 오류). No AI, about 0.1 s a frame.

  cd <MYIN_PKG>/tools/myin_pipeline && python myin_frame_check.py <video job> <out.json> [moments per scene = 5]
  (the preview's environment: STORY, SRC, PYTHONPATH with the diagram folder, MYIN_FONT_DIR)
"""
import json, os, sys, time

FLAT = 1.5            # grey-level spread (0–255) under which the picture is one flat colour
TOP = 0.78            # the picture above the subtitle bar (subtitles over an empty scene still leave it empty)
MOST = 0.6            # a scene is blank when most of its moments are (early on, text may not have come in yet)
SKIP = {"endscreen"}  # YouTube puts its own end cards on this plain screen


def flat_moments(scenes, M, points, errors=None):
    """The blank moments (most of a scene's); a moment the engine cannot draw goes to `errors` instead (11-09 request: a diagram that breaks
    only while it moves stopped the 10/28 preview, so every moment is drawn, not only the finished look)."""
    import numpy as np
    out = []
    for i, sc in enumerate(scenes):
        if sc["type"] in SKIP: continue
        a, b = sc["t0"] + 0.5, sc["t1"] - 0.2      # past the cross-fade in, before the next scene's
        if b <= a: continue
        for k in range(points):
            ts = a + (b - a) * k / max(1, points - 1)
            T = M.out_time(ts)
            try: im = M.frame(scenes, T).convert("L")
            except Exception as e:
                if errors is not None: errors.append({"scene": i + 1, "type": sc["type"], "t": round(T, 2), "error": f"{type(e).__name__}: {e}"[:160]})
                continue
            im = im.crop((0, 0, im.width, int(im.height * TOP))).resize((160, 70))
            spread = float(np.asarray(im, np.float32).std())
            if spread < FLAT: out.append({"scene": i + 1, "type": sc["type"], "t": round(T, 2), "spread": round(spread, 2)})
    count = {}
    for f in out: count[f["scene"]] = count.get(f["scene"], 0) + 1
    return [f for f in out if count[f["scene"]] >= max(1, round(points * MOST))]


def main():
    job, out = sys.argv[1], sys.argv[2]
    points = int(sys.argv[3]) if len(sys.argv) > 3 else 5
    t0 = time.time()
    sys.path.insert(0, os.getcwd())          # run from the release's tools folder, inside the engine's myin_pipeline
    import render_myin as R
    M = R.M
    _, scenes, _ = R.load(job)
    errors = []
    flat = flat_moments(scenes, M, points, errors)
    # One line per scene, as the preview prints its 「문구 못 찾음」 (the OS reads both the same way).
    lines = [f"[장면 {s}] 빈 화면: {', '.join(str(f['t']) + '초' for f in flat if f['scene'] == s)}" for s in sorted({f["scene"] for f in flat})]
    lines += [f"[장면 {s}] 그리기 오류: {', '.join(str(f['t']) + '초' for f in errors if f['scene'] == s)} ({next(f['error'] for f in errors if f['scene'] == s)})"
              for s in sorted({f["scene"] for f in errors})]
    json.dump({"scenes": len(scenes), "points": points, "flat": flat, "errors": errors, "lines": lines, "sec": round(time.time() - t0, 1)}, open(out, "w", encoding="utf-8"), ensure_ascii=False)
    print(f"빈 화면 · 그리기 오류 검사: 장면 {len(scenes)}개 × {points}순간 · 빈 화면 {len({f['scene'] for f in flat})}장면 · 오류 {len({f['scene'] for f in errors})}장면 · {round(time.time() - t0, 1)}초", flush=True)


if __name__ == "__main__":
    main()
