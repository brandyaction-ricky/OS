"""렌더 전 관문 · 빈 화면 (로건 개발 문서 v3 7.2-3, 2026-11-04) after the ③ preview, before any video is drawn.

The preview sheet shows each scene at one moment; a diagram that fails later in its scene (Logan's QA: six blank screens) is only seen
in the finished video. This draws every scene at a few moments with his engine — the same load and frame() the render uses — and lists
the moments where the picture is one flat colour, and those where the engine fails to draw (그리기 오류). No AI, about 0.1 s a frame.

It also times the cut against the voice with the engine's own scene times (render_myin.load — after its 「빈 화면 방지」 move), the checks of
Logan's 덱 배치 로직 v2 (2026-11-10, his beat_metrics2.py): a screen that changes more than 1.5 s after its first word, a scene whose first
content comes more than 1 s after it starts (0.3 s for the first screen), and a scene shorter than 3 s on the video (2.5 s for a chapter mark).
Scene numbers are the storyboard's: the engine turns an opening's acts into decks, and those count as the opening.

  cd <MYIN_PKG>/tools/myin_pipeline && python myin_frame_check.py <video job> <out.json> [moments per scene = 5]
  (the preview's environment: STORY, SRC, PYTHONPATH with the diagram folder, MYIN_FONT_DIR)
"""
import json, os, re, sys, time

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


LATE, EMPTY, EMPTY_FIRST, SHORT, SHORT_MARK = 1.5, 1.0, 0.3, 3.0, 2.5
FRAME = {"opening", "outro", "summary", "endscreen"}
MARKS = {"lib_question_card", "lib_clock"}       # 장 표시: a question card or a clock between items may be short


def norm(s): return re.sub(r"[^0-9A-Za-z가-힣]", "", str(s))


def first_shown(sc):
    """The earliest time anything of the scene is timed to appear (t · t_* keys and [text, time] pairs), or None."""
    ts = []

    def walk(v):
        if isinstance(v, dict):
            for k, x in v.items():
                if (k == "t" or k.startswith("t_")) and isinstance(x, (int, float)): ts.append(x)
                else: walk(x)
        elif isinstance(v, list):
            if len(v) >= 2 and isinstance(v[0], str) and isinstance(v[1], (int, float)): ts.append(v[1])
            else:
                for x in v: walk(x)
    for k, v in sc.items():
        if k not in ("t0", "t1"): walk(v)
    return min(ts) if ts else None


def align(scenes, plan):
    """For each scene the engine drew, the storyboard entry it came from (same type and start phrase, in order) — the engine leaves some
    out (outro before the ending), so the lists differ in length. None when they cannot be matched."""
    out, j = [], 0
    for sc in scenes:
        while j < len(plan) and not (plan[j].get("type") == sc.get("type") and plan[j].get("at") == sc.get("at")): j += 1
        if j >= len(plan): return None
        out.append(j); j += 1
    return out


def numbers(scenes, st, written):
    """Each drawn scene's storyboard number, in the order the 점검 시트 lays its cells (preview() draws every scene the engine made): the
    decks an opening's acts became count as the opening (1). None when the drawn scenes cannot be matched to the storyboard."""
    plan = st.get("scenes") or []
    idx = align(scenes, plan)
    if not idx: return None
    decks = max(0, len(plan) - written) if written else 0
    return [1 if j <= decks else j - decks + 1 for j in idx]


def timing(scenes, plan, idx, words, end, out_time, decks):
    """덱 배치 v2 timing problems [(storyboard entry, kind, text)]; plan[idx[i]] is the entry the engine drew as scenes[i], and entries up to
    `decks` are the opening and the decks the engine made from its acts."""
    txt, pos, k = "", [], 0
    for w in words:
        pos.append(k); n = norm(w[2]); txt += n; k += len(n)

    def said(phrase, after):
        p = norm(phrase)
        if not p: return None
        start = next((pos[j] for j, w in enumerate(words) if w[0] >= after - 0.05), len(txt))
        i = txt.find(p, start)
        if i < 0: return None
        return words[max(j for j, q in enumerate(pos) if q <= i)][0]
    out, prev = [], 0.0
    for i, sc in enumerate(scenes):
        j, raw = idx[i], plan[idx[i]]
        if j <= decks or sc["type"] in FRAME: continue
        ta = said(raw.get("at"), prev) if raw.get("at") else None
        if ta is not None and sc["t0"] - ta > LATE:
            out.append((j, "late", f"말보다 화면이 늦게 바뀜: 말 {ta:.1f}초 → 화면 {sc['t0']:.1f}초({sc['t0'] - ta:.1f}초 늦음)"))
        prev = ta if ta is not None else sc["t0"]
        ft = first_shown(sc)
        limit = EMPTY_FIRST if j == decks + 1 else EMPTY
        if ft is not None and ft - sc["t0"] > limit:
            out.append((j, "empty", f"장면 시작 뒤 빈 화면 {ft - sc['t0']:.1f}초(첫 내용 {ft:.1f}초) — 첫 요소를 장면 첫 말에"))
        t1 = scenes[i + 1]["t0"] if i + 1 < len(scenes) else end
        shown = out_time(t1) - out_time(sc["t0"])
        least = SHORT_MARK if sc["type"] in MARKS or raw.get("recall") is not None else SHORT
        if shown < least: out.append((j, "short", f"{least:g}초 미만 장면: 영상에서 {shown:.1f}초 — 앞뒤 장면과 합치거나 비트 안에서 더하기로"))
    return out


def main():
    job, out = sys.argv[1], sys.argv[2]
    points = int(sys.argv[3]) if len(sys.argv) > 3 else 5
    t0 = time.time()
    sys.path.insert(0, os.getcwd())          # run from the release's tools folder, inside the engine's myin_pipeline
    import render_myin as R
    M = R.M
    wd, scenes, st = R.load(job)
    errors = []
    flat = flat_moments(scenes, M, points, errors)
    # The storyboard as the OS keeps it: the engine replaces an opening's acts with decks (its plan = opening + decks + the rest) and leaves
    # some scenes out, so each drawn scene is matched to its plan entry, and plan entry j is storyboard scene j − decks (the decks count as the opening).
    try: written = len(json.load(open(os.path.join(wd, os.environ.get("STORY", "myin_storyboard.json")), encoding="utf-8"))["scenes"])
    except Exception: written = 0
    plan = st.get("scenes") or []
    idx = align(scenes, plan)
    decks = max(0, len(plan) - written) if written else 0
    no = lambda j: 1 if j <= decks else j - decks + 1
    drawn = lambda i: no(idx[i]) if idx else i + 1
    timed = []
    if idx:
        try:
            words = json.load(open(os.path.join(wd, "words.json"), encoding="utf-8"))
            timed = timing(scenes, plan, idx, words, st.get("end", scenes[-1].get("t1", 0)), M.out_time, decks)
        except Exception as e: print(f"시간 검사 못 함: {type(e).__name__}: {e}", flush=True)
    else: print("시간 검사 못 함: 그린 장면을 기획표와 맞추지 못함", flush=True)
    # One line per scene, as the preview prints its 「문구 못 찾음」 (the OS reads both the same way).
    lines = [f"[장면 {drawn(s - 1)}] 빈 화면: {', '.join(str(f['t']) + '초' for f in flat if f['scene'] == s)}" for s in sorted({f["scene"] for f in flat})]
    lines += [f"[장면 {drawn(s - 1)}] 그리기 오류: {', '.join(str(f['t']) + '초' for f in errors if f['scene'] == s)} ({next(f['error'] for f in errors if f['scene'] == s)})"
              for s in sorted({f["scene"] for f in errors})]
    lines += [f"[장면 {no(j)}] {text}" for j, _, text in timed]
    json.dump({"scenes": len(scenes), "points": points, "flat": flat, "errors": errors, "timing": [{"scene": no(j), "kind": kind, "text": text} for j, kind, text in timed],
               "lines": lines, "sec": round(time.time() - t0, 1)}, open(out, "w", encoding="utf-8"), ensure_ascii=False)
    print(f"빈 화면 · 그리기 오류 · 시간 검사: 장면 {len(scenes)}개 × {points}순간 · 빈 화면 {len({f['scene'] for f in flat})}장면 · 오류 {len({f['scene'] for f in errors})}장면"
          f" · 시간 {len(timed)}곳 · {round(time.time() - t0, 1)}초", flush=True)


if __name__ == "__main__":
    main()
