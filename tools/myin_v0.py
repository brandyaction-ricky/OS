"""장면 그림 v0 (편집기 3차 요청, 2026-11-09): a longform's ③ without preview clips. Every scene is drawn once as it looks when it is all in,
and the editor screen's timeline is laid before any video exists — scene blocks, music rows, effect marks, the voice · music · effect
lines and their peaks — with the editor's own functions (engine_common, shipped with the engine in tools/editor). The moving video is
drawn once, at 「완성」. Effects need no video: their times come from the engine's warped events, as the full render places them.

  cd <work>/tools/myin_pipeline && python myin_v0.py <out dir>
  (the preview's environment: STORY, SRC, PYTHONPATH with the diagram folder, MYIN_FONT_DIR)

Writes the editor screen's version files into <out dir>: version.json, video_ns.mp4 (the pictures one after another, 720p, no subtitles and
no sound — the screen lays its own subtitle layer over it while editing), video.mp4 (the 정지 그림 영상 of 덱 배치 로직 v2: the same pictures with
the engine's own subtitle box line by line and the voice, which is also the ③ preview), thumb_NN.jpg, voice · music · sfx (.m4a), wave.json,
subs.srt (output times), and story.json — the storyboard as the OS keeps it (with the music match, without the channel style), which an
editing computer that did not make ③ starts its edits from. The pictures are drawn without subtitles, as the engine's handout deck is.
"""
import json, os, re, shutil, subprocess, sys, time

VERSION = "v0"


def settled_at(sc):
    """The source time a scene looks finished: its last moment before the next scene's cross-fade (the frame check's last point).
    Pieces come in on phrase times, on [text, time] pairs or on the scene's own clock (a summary's rows), so only the end has them all —
    the 11-09 render-PC test caught a two-line statement and the summary half in at «a second after the last cue»."""
    return max(sc["t0"], sc["t1"] - 0.25)


def picture(M, sc, s):
    """The scene as it looks finished, else just after it starts; None when the engine draws neither (the frame check names it)."""
    for t in (settled_at(s), s["t0"] + 0.6):
        try: return M.frame(sc, M.out_time(min(t, s["t1"] - 0.12))).convert("RGB")
        except Exception as e: print(f"장면 그림 못 그림: {s.get('type')} {round(t, 2)}초 ({type(e).__name__}: {e})", flush=True)
    return None


def srt_from_ass(ass, out_time):
    """The run's subtitles (voice time) at the video's times (holds for the title, 구독 대사 and reel added), as SRT."""
    def sec(c):
        h, m, s = c.split(":"); return int(h) * 3600 + int(m) * 60 + float(s)

    def clock(t):
        ms = int(round(max(0.0, t) * 1000)); return f"{ms // 3600000:02d}:{ms // 60000 % 60:02d}:{ms // 1000 % 60:02d},{ms % 1000:03d}"
    blocks = []
    for line in ass.splitlines():
        if not line.startswith("Dialogue:"): continue
        parts = line.split(",", 9)
        if len(parts) < 10: continue
        text = re.sub(r"\{[^}]*\}", "", parts[9]).replace("\\N", " ").replace("\\n", " ").strip()
        if not text: continue
        blocks.append(f"{len(blocks) + 1}\n{clock(out_time(sec(parts[1])))} --> {clock(out_time(sec(parts[2])))}\n{text}\n")
    return "\n".join(blocks)


def slideshow(rows, stills, end, out):
    """The pictures in their scenes' places, as the edit video: 10 frames a second is enough to land each scene where it starts."""
    listing = out + ".txt"
    with open(listing, "w", encoding="utf-8") as fh:
        for r, still in zip(rows, stills):
            fh.write(f"file '{still}'\nduration {max(0.1, r['b'] - r['a']):.3f}\n")
        fh.write(f"file '{stills[-1]}'\n")
    subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-f", "concat", "-safe", "0", "-i", listing, "-vf", "fps=10,format=yuv420p", "-t", f"{end:.2f}",
                    "-c:v", "libx264", "-preset", "veryfast", "-tune", "stillimage", "-crf", "28", "-movflags", "+faststart", out], check=True)
    os.remove(listing)


def with_subtitles(M, sc, rows, stills, subs, end, voice, out):
    """The pictures with the engine's subtitle box line by line (its draw_sub, as the render — an ass burn loses the box on white) and the
    voice: a piece wherever a scene or a subtitle line starts or ends. Holds keep the picture and drop the line, as the render does."""
    from PIL import Image
    cuts = sorted({0.0, end} | {r["a"] for r in rows} | {M.out_time(t) for a, b, _ in subs for t in (a, b)})
    cuts = [c for c in cuts if 0 <= c <= end]
    quiet = getattr(M, "_hold_quiet", lambda t: False)
    pieces, cache, tmp = [], {}, out + "_pieces"
    os.makedirs(tmp, exist_ok=True)
    for i in range(len(cuts) - 1):
        a, b = cuts[i], cuts[i + 1]
        if b - a < 0.02: continue
        mid = (a + b) / 2
        k = max([j for j, r in enumerate(rows) if r["a"] <= mid] or [0])
        if k not in cache: cache[k] = Image.open(stills[k]).convert("RGB").resize((1920, 1080))
        im = cache[k].copy()
        if not quiet(mid):
            M.SUBS = subs
            try: M.draw_sub(im, M.src_time(mid), M.scene_bg(sc[k]))
            finally: M.SUBS = []
        f = os.path.join(tmp, f"p{i:04d}.jpg"); im.resize((1280, 720)).save(f, quality=88); pieces.append((f, b - a))
    listing = out + ".txt"
    with open(listing, "w", encoding="utf-8") as fh:
        for f, d in pieces: fh.write(f"file '{f}'\nduration {d:.3f}\n")
        fh.write(f"file '{pieces[-1][0]}'\n")
    sound = ["-i", voice, "-map", "0:v", "-map", "1:a", "-c:a", "copy"] if voice and os.path.exists(voice) else []
    subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-f", "concat", "-safe", "0", "-i", listing, *sound, "-vf", "fps=10,format=yuv420p", "-t", f"{end:.2f}",
                    "-c:v", "libx264", "-preset", "veryfast", "-tune", "stillimage", "-crf", "28", "-movflags", "+faststart", out], check=True)
    os.remove(listing); shutil.rmtree(tmp, ignore_errors=True)
    return len(pieces)


def main():
    out = os.path.abspath(sys.argv[1])
    shutil.rmtree(out, ignore_errors=True); os.makedirs(out)
    t0 = time.time()
    work = os.path.abspath(os.path.join(os.getcwd(), "..", ".."))
    os.environ["MYIN_WORKDIR"] = work
    sys.path.insert(0, os.path.join(work, "tools", "editor"))
    import engine_common as E                                   # the editor's functions, from the engine bundle
    M = E.M
    sc, st = E.load(os.environ.get("STORY", "myin_storyboard.json"))
    rows, music, end = E.scene_rows(sc, st)
    sfx = E.sfx_rows(sc)
    subs, M.SUBS = list(M.SUBS), []                             # pictures without the subtitle of their last moment
    stills, broken = [], []
    for r, s in zip(rows, sc):
        im = picture(M, sc, s)
        if im is None:                                          # neither moment draws: a grey card says so; the rest goes on
            from PIL import Image
            im = Image.new("RGB", (1920, 1080), (205, 205, 212)); broken.append(r["i"] + 1)
        still = os.path.join(out, f"still_{r['i']:02d}.jpg")
        im.resize((1280, 720)).save(still, quality=86)
        im.resize((320, 180)).save(os.path.join(out, f"thumb_{r['i']:02d}.jpg"), quality=80)
        r["thumb"] = f"thumb_{r['i']:02d}.jpg"
        stills.append(still)
    slideshow(rows, stills, end, os.path.join(out, "video_ns.mp4"))
    note = "장면 그림 · 움직임은 「완성」 때 만들어요" + (f" · 못 그린 장면 {', '.join(map(str, broken))}" if broken else "")
    try:
        peaks = E.stem_peaks(sc, st, VERSION)                   # the same mixing functions the render uses, each line apart
        json.dump(peaks, open(os.path.join(out, "wave.json"), "w"))
        for k in ("voice", "music", "sfx"):
            subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-i", os.path.join(E.EDIT, "waves", f"{VERSION}_{k}.wav"), "-c:a", "aac", "-b:a", "96k",
                            os.path.join(out, f"{k}.m4a")], check=True)
    except Exception as e:                                      # the pictures still come up; the screen says the lines are missing
        note += f" · 소리 줄 못 만듦({type(e).__name__})"
        print(f"소리 줄 못 만듦: {e}", flush=True)
    pieces = with_subtitles(M, sc, rows, stills, subs, end, os.path.join(out, "voice.m4a"), os.path.join(out, "video.mp4"))
    for still in stills: os.remove(still)                       # in the videos now; the timeline keeps the small ones
    shutil.copyfile(os.path.join(work, "voice", "os_myin", "myin_storyboard.json"), os.path.join(out, "story.json"))
    ass = os.path.join(work, "voice", "os_myin", "subs_myin.ass")
    if os.path.exists(ass):
        open(os.path.join(out, "subs.srt"), "w", encoding="utf-8").write(srt_from_ass(open(ass, encoding="utf-8-sig").read(), M.out_time))
    version = {"name": VERSION, "video": "video.mp4", "video_ns": "video_ns.mp4", "proxy": "video_ns.mp4", "story": "story.json",
               "scenes": rows, "music": music, "sfx": sfx, "end": end, "note": note, "changed": [], "from": None, "voice": VERSION, "stills": True}
    json.dump(version, open(os.path.join(out, "version.json"), "w", encoding="utf-8"), ensure_ascii=False)
    print(f"장면 그림 v0: 장면 {len(rows)}개 · 자막 조각 {pieces}개 · 음악 {len(music)}구간 · 효과음 {len(sfx)}개 · {round(end, 1)}초 · {round(time.time() - t0, 1)}초 걸림", flush=True)


if __name__ == "__main__":
    main()
