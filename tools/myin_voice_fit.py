"""한 문장 고치기 ② (대표 2026-11-26 「딱 해당 구간만 다시 뽑고 이어 붙이기」): a paragraph voiced again (voice_fix) is fitted to the
paragraph sound it replaces, so the finished video's picture can stay. Its spoken part is stretched (pitch kept) to the old spoken length
and wrapped in the old sound's own quiet head and tail; his join (stage_voice.assemble) sets each gap from a paragraph's quiet ends, so
every later sentence lands where the drawn video has it. The worker checks the joined timings afterwards and falls back when they moved.

  python myin_voice_fit.py <old.wav> <new.wav> [most change]   rewrites new.wav; exit 3 = the spoken lengths differ too much
  python myin_voice_fit.py --selftest
"""
import os, subprocess, sys
import numpy as np, soundfile as sf

MOST = 0.1   # ±10 %: beyond that a stretched paragraph sounds hurried or dragged, and the video is drawn again instead


def loud(y, sr):
    """(first, last) 10 ms windows at or above VOICE_SILENCE_RMS — stage_voice._quiet_ends, whose ends set the join's gaps."""
    hop = int(sr * 0.01); n = len(y) // hop
    v = np.where(np.sqrt(np.mean(y[:n * hop].reshape(n, hop) ** 2, axis=1)) >= float(os.environ.get("VOICE_SILENCE_RMS", "0.002")))[0] if n else []
    return (int(v[0]), int(v[-1])) if len(v) else None


def spoken(y, sr):
    """(first, end) samples of the spoken part."""
    hop = int(sr * 0.01); w = loud(y, sr)
    return (w[0] * hop, (w[1] + 1) * hop) if w else (0, len(y))


def stretch(y, sr, length):
    """y made `length` samples long with ffmpeg atempo (pitch kept), the last few samples padded or cut."""
    out = subprocess.run(["ffmpeg", "-loglevel", "error", "-f", "f32le", "-ar", str(sr), "-ac", "1", "-i", "-", "-af", f"atempo={len(y) / length:.6f}",
                          "-f", "f32le", "-"], input=y.astype("<f4").tobytes(), capture_output=True, check=True).stdout
    z = np.frombuffer(out, "<f4")
    return z[:length] if len(z) >= length else np.pad(z, (0, length - len(z)))


def fit(old_path, new_path, most=MOST):
    old, sr = sf.read(old_path, dtype="float32"); new, sr2 = sf.read(new_path, dtype="float32")
    old = old if old.ndim == 1 else old.mean(1); new = new if new.ndim == 1 else new.mean(1)
    if sr != sr2: return None
    (a0, b0), (a1, b1) = spoken(old, sr), spoken(new, sr)
    ratio = (b1 - a1) / max(1, b0 - a0)
    if abs(ratio - 1) > most: return ratio, False
    # The stretched edges can fall a window early or late (10 ms on every later sentence): moved by that much and made again, twice at most.
    hop, want, (s, e) = int(sr * 0.01), loud(old, sr), (a0, b0)
    for _ in range(3):
        out = np.concatenate([old[:s], stretch(new[a1:b1], sr, e - s), old[e:]])
        got = loud(out, sr)
        if not want or not got or got == want: break
        s, e = max(0, s - (got[0] - want[0]) * hop), min(len(old), e - (got[1] - want[1]) * hop)
    sf.write(new_path, out, sr, subtype="PCM_16")
    return ratio, True


def selftest():
    import tempfile
    sr = 48000; rng = np.random.default_rng(1)
    def voice(quiet_a, talk, quiet_b):
        t = np.arange(int(talk * sr)) / sr
        return np.concatenate([rng.normal(0, 0.0003, int(quiet_a * sr)), 0.3 * np.sin(2 * np.pi * 180 * t), rng.normal(0, 0.0003, int(quiet_b * sr))]).astype("float32")
    with tempfile.TemporaryDirectory() as d:
        old, new = os.path.join(d, "old.wav"), os.path.join(d, "new.wav")
        sf.write(old, voice(0.12, 6.0, 0.30), sr, subtype="PCM_16"); sf.write(new, voice(0.05, 6.4, 0.10), sr, subtype="PCM_16")
        ratio, ok = fit(old, new)
        a, b = sf.read(old)[0], sf.read(new)[0]
        assert ok and abs(ratio - 6.4 / 6.0) < 0.01, ratio
        assert len(a) == len(b), (len(a), len(b))
        assert loud(a, sr) == loud(b, sr), (loud(a, sr), loud(b, sr))
        sf.write(new, voice(0.05, 7.0, 0.10), sr, subtype="PCM_16")
        assert fit(old, new)[1] is False
    print("selftest ok")


if __name__ == "__main__":
    if sys.argv[1:] == ["--selftest"]: selftest(); sys.exit(0)
    result = fit(sys.argv[1], sys.argv[2], float(sys.argv[3]) if len(sys.argv) > 3 else MOST)
    if not result: print("샘플레이트가 달라 맞출 수 없음"); sys.exit(3)
    print(f"말소리 길이 비율 {result[0]:.3f}" + ("" if result[1] else f" — ±{MOST:.0%} 넘어 맞추지 않음"))
    sys.exit(0 if result[1] else 3)
