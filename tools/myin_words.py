"""바뀐 문단만 다시 듣기 (요청 3번의 5, 2026-11-17): a voice made again for an edited script or a fixed sentence changes a few paragraphs,
but the transcript (his stage_words: faster-whisper small over the whole voice, ~2.5 min for 13 minutes) and the voice check (his
voice_audit, ~2 min) were made again for all of it. A paragraph whose sound is the same file as before keeps what was heard in it, moved
to its new place; only the paragraphs whose sound changed are heard again.

  python myin_words.py snap  <voice dir> <video dir> <snap.json>   before the voice changes (or from an earlier run's folders)
  python myin_words.py words <voice dir> <video dir> <snap.json>   → <video dir>/words.json, as stage_words writes it
  python myin_words.py audit <voice dir> <snap.json> <out.json>    → his voice_audit rows (run from tools/voice_timing)

The voice dir has voice.wav, timings.json (his assemble: each paragraph's start and length) and pNN_t.wav, the paragraph sound joined in.
Where a paragraph sits is found in voice.wav itself: the timings of voices made before 2026-11-17 drift from the sound (+5 ms a paragraph,
0.21 s by the end of a 13-minute voice), and moving words by them put the later ones that much late.
Exits 2 when nothing can be kept (no snap, an older words.json than the voice, no paragraph alike): the worker runs his tools as before.
"""
import hashlib, json, os, subprocess, sys, tempfile, time

KEEP_LEAST = 1
DRIFT_MOST = 0.02     # s: his timings this far from the sound at most, or the voice check before is not kept


def file_sha(path):
    h = hashlib.sha1()
    with open(path, "rb") as fh:
        for chunk in iter(lambda: fh.read(1 << 20), b""): h.update(chunk)
    return h.hexdigest()


def pcm(path, start=0.0, dur=None, rate=8000):
    import numpy as np
    cmd = ["ffmpeg", "-loglevel", "error", "-ss", f"{start:.3f}", *(["-t", f"{dur:.3f}"] if dur else []), "-i", path, "-ac", "1", "-ar", str(rate), "-f", "f32le", "-"]
    return np.frombuffer(subprocess.run(cmd, capture_output=True, check=True).stdout, np.float32)


def paragraphs(voice_dir, rate=8000):
    """His timings, each with `at`: where the paragraph's own sound (its first 3 s) lines up in voice.wav, near the start he wrote."""
    import numpy as np
    ps = json.load(open(os.path.join(voice_dir, "timings.json"), encoding="utf-8"))["paragraphs"]
    voice = pcm(os.path.join(voice_dir, "voice.wav"), rate=rate)
    for p in ps:
        head = pcm(os.path.join(voice_dir, f"p{p['i']:02d}_t.wav"), dur=3.0, rate=rate)
        a = max(0, int((p["start"] - 1.5) * rate)); win = voice[a:a + 6 * rate]
        n = len(win) + len(head)
        k = int(np.argmax(np.fft.irfft(np.fft.rfft(win, n) * np.conj(np.fft.rfft(head, n)), n)[:len(win)])) if len(win) and len(head) else 0
        at = (a + k) / rate
        p["at"] = round(at if abs(at - p["start"]) < 1.0 else p["start"], 3)
    return ps


def sounds(voice_dir, ps):
    return [file_sha(os.path.join(voice_dir, f"p{p['i']:02d}_t.wav")) for p in ps]


def match(old, new):
    """{new paragraph: old paragraph} with the same sound, in order."""
    out, j = {}, 0
    for i, h in enumerate(new):
        k = next((k for k in range(j, len(old)) if old[k] == h), None)
        if k is not None: out[i] = k; j = k + 1
    return out


def bounds(ps):
    """Each paragraph's span on the voice: from the middle of the pause before it to the middle of the pause after it."""
    mids = [(ps[i - 1]["at"] + ps[i - 1]["dur"] + ps[i]["at"]) / 2 for i in range(1, len(ps))]
    return [float("-inf")] + mids + [float("inf")]


def inside(words, a, b): return [w for w in words if a <= (w[0] + w[1]) / 2 < b]


def snap(voice_dir, video_dir, out):
    words_file, voice = os.path.join(video_dir, "words.json"), os.path.join(voice_dir, "voice.wav")
    if not (os.path.exists(words_file) and os.path.exists(voice)) or os.path.getmtime(words_file) < os.path.getmtime(voice):
        print("받아쓰기 기억 안 함: 이 음성의 받아쓰기가 없어요", flush=True); sys.exit(2)
    ps = paragraphs(voice_dir)
    # His voice check cuts each paragraph out by his timings: where they drifted (voices before 2026-11-17) its rows are not those of the
    # paragraph's own sound, so the check is made again for all of it.
    audit_file = os.path.join(voice_dir, "audit.json")
    fresh = os.path.exists(audit_file) and os.path.getmtime(audit_file) >= os.path.getmtime(voice) and max(abs(p["at"] - p["start"]) for p in ps) <= DRIFT_MOST
    audit = json.load(open(audit_file, encoding="utf-8")) if fresh else None
    json.dump({"paragraphs": ps, "sounds": sounds(voice_dir, ps), "words": json.load(open(words_file, encoding="utf-8")), "audit": audit},
              open(out, "w", encoding="utf-8"), ensure_ascii=False)


def load(voice_dir, snap_file):
    if not os.path.exists(snap_file): sys.exit(2)
    before = json.load(open(snap_file, encoding="utf-8"))
    ps = paragraphs(voice_dir)
    keep = match(before["sounds"], sounds(voice_dir, ps))
    if len(keep) < KEEP_LEAST: print("다시 쓸 문단 없음: 전부 새로 들어요", flush=True); sys.exit(2)
    return before, ps, keep


def runs(n, keep):
    """Consecutive paragraphs to hear again, [(first, last)]."""
    out = []
    for i in range(n):
        if i in keep: continue
        if out and out[-1][1] == i - 1: out[-1] = (out[-1][0], i)
        else: out.append((i, i))
    return out


def words(voice_dir, video_dir, snap_file):
    t0 = time.time()
    before, ps, keep = load(voice_dir, snap_file)
    old_b, new_b = bounds(before["paragraphs"]), bounds(ps)
    total = ps[-1]["at"] + ps[-1]["dur"] + 2.0
    got = {}
    for i, k in keep.items():
        shift = ps[i]["at"] - before["paragraphs"][k]["at"]
        got[i] = [[round(a + shift, 2), round(b + shift, 2), w] for a, b, w in inside(before["words"], old_b[k], old_b[k + 1])]
    again = runs(len(ps), keep)
    if again:
        from faster_whisper import WhisperModel                         # his stage_words' model and settings
        m = WhisperModel("small", device="cpu", compute_type="int8")
        tmp = tempfile.mkdtemp(prefix="words_")
        for a, b in again:
            lo, hi = max(0.0, new_b[a]), min(total, new_b[b + 1])
            seg = os.path.join(tmp, f"p{a:02d}.wav")
            subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-ss", f"{lo:.3f}", "-to", f"{hi:.3f}", "-i", os.path.join(voice_dir, "voice.wav"),
                            "-ac", "1", "-ar", "16000", seg], check=True)
            segs, _ = m.transcribe(seg, language="ko", word_timestamps=True, vad_filter=False)
            heard = [[round(float(w.start) + lo, 2), round(float(w.end) + lo, 2), w.word.strip()] for s in segs for w in s.words]
            for i in range(a, b + 1): got[i] = inside(heard, new_b[i], new_b[i + 1])
    out = [w for i in range(len(ps)) for w in got.get(i, [])]
    json.dump(out, open(os.path.join(video_dir, "words.json"), "w", encoding="utf-8"), ensure_ascii=False)
    heard_again = sum(b - a + 1 for a, b in again)
    print(f"받아쓰기: 문단 {len(ps)}개 중 {len(keep)}개 그대로 · {heard_again}개 다시 들음 · 단어 {len(out)}개 · {round(time.time() - t0, 1)}초", flush=True)


def audit(voice_dir, snap_file, out):
    t0 = time.time()
    before, ps, keep = load(voice_dir, snap_file)
    if before.get("audit") is None: print("음성 검사 기억 없음: 전부 다시 검사해요", flush=True); sys.exit(2)
    sys.path.insert(0, os.getcwd())                                 # tools/voice_timing, as voice_audit.py runs
    import voice_audit as VA
    changed = [p for i, p in enumerate(ps) if i not in keep]
    rows = []
    if changed:
        # His audit over a folder with only the changed paragraphs' times; it slices them out of the same voice.wav.
        tmp = tempfile.mkdtemp(prefix="audit_some_")
        tm = json.load(open(os.path.join(voice_dir, "timings.json"), encoding="utf-8"))
        json.dump({**tm, "paragraphs": changed}, open(os.path.join(tmp, "timings.json"), "w", encoding="utf-8"), ensure_ascii=False)
        os.symlink(os.path.join(voice_dir, "voice.wav"), os.path.join(tmp, "voice.wav"))
        for p in changed:
            joins = os.path.join(voice_dir, f"p{p['i']:02d}_잇기.json")
            if os.path.exists(joins): os.symlink(joins, os.path.join(tmp, os.path.basename(joins)))
        rows = VA.audit(tmp)
    back = {k: i for i, k in keep.items()}
    for row in before["audit"]:
        i = back.get(row.get("문단"))
        if i is None: continue
        shift = ps[i]["at"] - before["paragraphs"][row["문단"]]["at"]
        rows.append({**row, "문단": i, "시각": round(row["시각"] + shift, 1)})
    rows.sort(key=lambda r: -r["점수"])
    json.dump(rows, open(out, "w", encoding="utf-8"), ensure_ascii=False, indent=1)
    print(f"음성 검사: 문단 {len(ps)}개 중 {len(keep)}개 그대로 · {len(changed)}개 다시 검사 · 문장 {len(rows)}개 · {round(time.time() - t0, 1)}초", flush=True)


if __name__ == "__main__":
    cmd, args = (sys.argv[1], sys.argv[2:]) if len(sys.argv) > 4 else (None, [])
    if cmd == "snap": snap(*args[:3])
    elif cmd == "words": words(*args[:3])
    elif cmd == "audit": audit(*args[:3])
    else: sys.exit(__doc__)
