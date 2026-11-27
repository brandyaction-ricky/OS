"""음이탈 · 높아진 채 이어짐 (한 문장 고치기 ③, 대표 2026-11-27): the engine's crack check (pause_check_myin.cracks) catches a voice
that leaps up within 10 ms; 4편's crack rose and stayed there (paragraph 23 at 9.3 s: 0.10 s above 1.9× the paragraph's usual pitch,
peaking at 2.16×) and reached the finished video. Calibrated by the owner's ear (2026-11-27, 14 places from 4편, 3편 and two older
videos): only that place is a crack. Places held at 1.9–2.05× are natural rises; 0.06–0.09 s held at 2.16–2.44× in older videos were
natural too (one, held 0.09 s, still passes: an extra paragraph voiced, tens of won); 3–5× readings where the trackers disagree are errors.

A crack here: frames above 1.9× the paragraph median for 0.08 s or more in a row, peaking between 2.1× and 2.6×, where praat's pitch
agrees (within 10 %) with the autocorrelation tracker on most of those frames. Rows are added to the pause check's list as 「음이탈」,
so the OS voices those paragraphs again by themselves (MYIN_PAUSE_ROUNDS) and lists what is left.

  python myin_crack_check.py <voice dir (timings.json · pNN_t.wav)> <pauses.json>   adds rows in place
  python myin_crack_check.py --selftest
"""
import hashlib, json, os, sys, wave
import numpy as np

HIGH, RUN, PEAK_LO, PEAK_HI, AGREE = 1.9, 8, 2.1, 2.6, 0.8


def track(x, sr):
    """10 ms pitch by autocorrelation (서율 crack_check): 40 ms windows, loud (RMS ≥ 0.02) and periodic (≥ 0.55) only, else 0."""
    hop, win, lo, hi = int(sr * 0.01), int(sr * 0.04), sr // 450, sr // 60
    out = []
    for i in range(0, len(x) - win, hop):
        s = x[i:i + win] - x[i:i + win].mean()
        if np.sqrt(np.mean(s ** 2)) < 0.02: out.append(0.0); continue
        ac = np.correlate(s, s, "full")[win - 1:]
        k = lo + int(np.argmax(ac[lo:hi])); out.append(sr / k if ac[k] / (ac[0] + 1e-9) > 0.55 else 0.0)
    return np.array(out)


def praat(path):
    import parselmouth
    return parselmouth.Sound(path).to_pitch_ac(time_step=0.01, pitch_floor=60, pitch_ceiling=600).selected_array["frequency"]


def decide(a, b):
    """[(seconds, held seconds, usual Hz, peak Hz)] from the two 10 ms pitch tracks of one paragraph (0 = no pitch)."""
    if not (a > 0).any(): return []
    n = min(len(a), len(b)); med = float(np.median(a[a > 0])); out = []; i = 0
    while i < n:
        if a[i] <= HIGH * med: i += 1; continue
        j = i
        while j < n and a[j] > HIGH * med: j += 1
        seg = a[i:j]
        if j - i >= RUN and PEAK_LO <= seg.max() / med <= PEAK_HI and np.mean(np.abs(seg - b[i:j]) / seg < 0.1) >= AGREE:
            out.append((round(i * 0.01, 2), round((j - i) * 0.01, 2), int(med), int(seg.max())))
        i = j
    return out


def cracks(path):
    w = wave.open(path); sr = w.getframerate()
    x = np.frombuffer(w.readframes(w.getnframes()), np.int16).astype(np.float32) / 32768
    if w.getnchannels() > 1: x = x.reshape(-1, w.getnchannels()).mean(1)
    return decide(track(x, sr), praat(path))


def run(voice, dest):
    paras = json.load(open(os.path.join(voice, "timings.json"), encoding="utf-8"))["paragraphs"]
    rows = json.load(open(dest, encoding="utf-8")) if os.path.exists(dest) else []
    try: heard = json.load(open(os.path.join(voice, "pause_check_cache.json"), encoding="utf-8"))   # the pause check's words per sound
    except Exception: heard = {}
    added = 0
    for p in paras:
        wav = os.path.join(voice, f"p{p['i']:02d}_t.wav")
        if not os.path.exists(wav): continue
        words = heard.get(hashlib.sha1(open(wav, "rb").read()).hexdigest()) or []
        for t, hold, lo, hi in cracks(wav):
            at = round(p.get("start", 0) + t, 2)
            if any(r.get("p") == p["i"] and r.get("kind") == "음이탈" and abs(r.get("at", 0) - at) < 0.3 for r in rows): continue   # the engine's own
            word = next((w[2] for w in words if w[0] - 0.05 <= t <= w[1] + 0.1), "?")
            rows.append({"p": p["i"], "at": at, "kind": "음이탈", "gap": hold, "text": f"‖ {word} ‖ {lo}→{hi}Hz"}); added += 1
    rows.sort(key=lambda r: r.get("at", 0))
    json.dump(rows, open(dest, "w", encoding="utf-8"), ensure_ascii=False, indent=1)
    print(f"음이탈(높아진 채 이어짐): {added}곳")


def selftest():
    # 10 ms tracks shaped like the places the owner listened to (2026-11-27), around a usual pitch of 130 Hz
    def case(high, frames, other=None):
        a = np.r_[np.full(200, 130.0), np.full(frames, high), np.full(200, 130.0)]
        b = a.copy() if other is None else np.r_[np.full(200, 130.0), np.full(frames, other), np.full(200, 130.0)]
        return decide(a, b)
    assert [x[:2] for x in case(279, 10)] == [(2.0, 0.1)], case(279, 10)  # 4편: 2.15× held 0.10 s → a crack
    assert case(287, 6) == []                                               # 2.2× held 0.06 s: natural in older videos
    assert case(279, 4) == []                                               # a 0.04 s blip (츠·치)
    assert case(255, 12) == []                                              # 1.96× held: a natural rise
    assert case(453, 12) == [] and case(300, 12, other=150) == []           # 3.5×, or trackers apart: a tracking error
    print("selftest ok")


if __name__ == "__main__":
    if sys.argv[1:] == ["--selftest"]: selftest(); sys.exit(0)
    run(sys.argv[1], sys.argv[2])
