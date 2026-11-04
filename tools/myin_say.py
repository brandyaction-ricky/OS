"""문장 테이크 (영상 편집기 · 로건 개발 문서 v3 7.2-1, 2026-11-04) on the render PC.

One sentence read k times the way the narration is made (his stage_voice._gen: Fish with the video's voice, then tightened), with the
narration's tone EQ and reading dictionary (his say.py), and how far each take's end rises in semitones (lower is a calmer ending).
Run with his voice Python and the voice env (FISH_API_KEY, FISH_VOICE_ID):

  python myin_say.py <MYIN_PKG>/tools <out dir> <takes> "<sentence>"   → t0.wav … t{k-1}.wav in <out dir>, and a JSON line on stdout
"""
import json, os, subprocess, sys
from concurrent.futures import ThreadPoolExecutor


def rise(path):
    """End rise in semitones: the median pitch of the last 0.3 s against the body's (None when too little voiced sound)."""
    import librosa, numpy as np
    y, sr = librosa.load(path, sr=22050)
    y, _ = librosa.effects.trim(y, top_db=35)
    f0, voiced, _ = librosa.pyin(y, fmin=70, fmax=400, sr=sr, frame_length=1024, hop_length=256)
    ok = voiced & ~np.isnan(f0)
    if ok.sum() < 8: return None
    t = (np.arange(len(f0)) * 256 / sr)[ok]; semis = 12 * np.log2(f0[ok])
    tail, body = semis[t >= t[-1] - 0.3], semis[t < t[-1] - 0.3]
    if len(tail) < 3 or len(body) < 5: return None
    return round(float(np.median(tail[-max(3, len(tail) // 2):]) - np.median(body)), 2)


def seconds(path):
    out = subprocess.run(["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", path], capture_output=True, text=True).stdout.strip()
    return round(float(out or 0), 3)


def main():
    tools, out, n, text = sys.argv[1], sys.argv[2], int(sys.argv[3]), sys.argv[4]
    sys.path.insert(0, os.path.join(tools, "mindmap_pipeline")); sys.path.insert(0, os.path.join(tools, "voice_timing"))
    import stage_voice as SV, voice_timing as VT
    os.makedirs(out, exist_ok=True)
    say, env = VT.read_aloud(VT.prepare_text(text)), SV.load_env()
    eq = [] if SV.VOICE_EQ.lower() == "off" else ["-af", SV.VOICE_EQ]

    def one(k):
        made = SV._gen(say, os.path.join(out, f"raw{k}"), env)
        dst = os.path.join(out, f"t{k}.wav")
        subprocess.run(["ffmpeg", "-y", "-v", "error", "-i", made] + eq + ["-ar", "48000", "-ac", "1", "-c:a", "pcm_s16le", dst], check=True)
        return dst

    with ThreadPoolExecutor(n) as pool: files = list(pool.map(one, range(n)))
    takes = []
    for k, f in enumerate(files):
        try: r = rise(f)
        except Exception: r = None
        takes.append({"k": k, "seconds": seconds(f), "rise": r})
    print(json.dumps({"takes": takes}, ensure_ascii=False), flush=True)


if __name__ == "__main__":
    main()
