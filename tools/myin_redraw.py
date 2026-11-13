"""점검 시트 (직원 요청 2026-11-13): the ③ sheets drawn with the engine, and after a 장면 수정안 only the scenes it changed.

The engine's preview() picks each scene's moment on the voice's clock, so past the 구독 대사 holds a cell showed an earlier scene (11-13:
the cell of scene 20 held scene 19's chat), and it numbers the engine's own scenes (an opening's acts are several). Here every cell is
drawn on the video's clock, just before its scene ends, and labelled with its storyboard number (all of an opening's cells are #1).

With an older storyboard and its sheets, both storyboards are resolved with the engine's load(); a scene resolved alike (same pieces,
same times) keeps its cell and only the others are drawn. Same grid as preview(): 3 × 4 cells of 640×360 (270×480 vertical).

  cd <work>/tools/myin_pipeline && python myin_redraw.py <video job> <old storyboard file | -> <old sheets dir | -> <out dir>
  (the preview's environment: STORY = the storyboard now, both files in the video's folder; SRC, PYTHONPATH with the diagram folder,
  MYIN_FONT_DIR, CHROME_PATH)

Prints the engine's load lines (its 「문구 못 찾음」 too, as the preview did). Writes preview_NN.png and redraw.json: scenes, drawn
(storyboard numbers drawn), cells (each cell's storyboard number, or null), errors (scenes the engine could not draw: a grey cell), sec.
"""
import json, os, sys, time

PER = 12


def key(sc):
    return json.dumps(sc, sort_keys=True, ensure_ascii=False, default=repr)


def same(old, new):
    """{new index: old index} for scenes resolved alike, kept in order (the longest common run)."""
    n, m = len(old), len(new)
    L = [[0] * (m + 1) for _ in range(n + 1)]
    for i in range(n - 1, -1, -1):
        for j in range(m - 1, -1, -1):
            L[i][j] = L[i + 1][j + 1] + 1 if old[i] == new[j] else max(L[i + 1][j], L[i][j + 1])
    out, i, j = {}, 0, 0
    while i < n and j < m:
        if old[i] == new[j]: out[j] = i; i += 1; j += 1
        elif L[i + 1][j] >= L[i][j + 1]: i += 1
        else: j += 1
    return out


def main():
    job, old_story, old_dir, out = sys.argv[1:5]
    t0 = time.time()
    sys.path.insert(0, os.getcwd())                                  # inside the engine's myin_pipeline, like the preview
    sys.path.insert(1, os.path.dirname(os.path.abspath(__file__)))   # the frame check next to this file
    import render_myin as R
    from myin_frame_check import numbers
    from PIL import Image, ImageDraw
    M = R.M
    story = os.environ.get("STORY", "myin_storyboard.json")
    before = []
    if old_story != "-":
        os.environ["STORY"] = old_story
        before = R.load(job)[1]
        os.environ["STORY"] = story
    wd, scenes, st = R.load(job)
    keep = same([key(s) for s in before], [key(s) for s in scenes])
    tw, th = (640, 360) if M.W >= M.H else (270, 480)
    sheets = {}

    def old_cell(j):
        k = j // PER
        if k not in sheets:
            p = os.path.join(old_dir, f"preview_{k + 1:02d}.png")  # old_dir "-" has none
            im = Image.open(p).convert("RGB") if os.path.exists(p) else None
            sheets[k] = im if im is not None and im.size == (tw * 3, th * 4) else None
        if sheets[k] is None: return None
        x, y = (j % PER % 3) * tw, (j % PER // 3) * th
        return sheets[k].crop((x, y, x + tw, y + th))

    try: written = len(json.load(open(os.path.join(wd, story), encoding="utf-8"))["scenes"])
    except Exception: written = 0
    cells = numbers(scenes, st, written)
    no = lambda i: cells[i] if cells else i + 1
    shots, drawn, errors = [], [], []
    for i, sc in enumerate(scenes):
        im = old_cell(keep[i]) if i in keep else None
        if im is None:
            t = max(sc["t0"] + 0.8, sc["t1"] - 0.4)
            try: im = M.frame(scenes, M.out_time(t)).convert("RGB").resize((tw, th))
            except Exception as e:
                im = Image.new("RGB", (tw, th), (128, 128, 128))
                errors.append(f"[장면 {no(i)}] 그리기 오류: {type(e).__name__}: {e}"[:200])
            ImageDraw.Draw(im).text((8, th - 30), f"#{no(i)}", fill=(255, 0, 0))
            if no(i) not in drawn: drawn.append(no(i))
        shots.append(im)
    os.makedirs(out, exist_ok=True)
    for k in range(0, len(shots), PER):
        sheet = Image.new("RGB", (tw * 3, th * 4), (128, 128, 128))
        for j, im in enumerate(shots[k:k + PER]): sheet.paste(im, ((j % 3) * tw, (j // 3) * th))
        sheet.save(os.path.join(out, f"preview_{k // PER + 1:02d}.png"))
    json.dump({"scenes": len(scenes), "drawn": drawn, "cells": cells, "errors": errors, "sec": round(time.time() - t0, 1)},
              open(os.path.join(out, "redraw.json"), "w", encoding="utf-8"), ensure_ascii=False)
    print(f"점검 시트: 칸 {len(scenes)}개 중 {len(scenes) - len(keep)}개 그림 · 오류 {len(errors)} · {round(time.time() - t0, 1)}초", flush=True)


if __name__ == "__main__":
    main()
