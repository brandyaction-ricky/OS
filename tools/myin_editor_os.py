"""영상 편집기 ↔ OS (로건 개발 문서 v2 · ②-3, 2026-11-04).

The OS side of Logan's editor on a member's computer, in place of his testbed's sim_lib: the same calls, now against the OS
(/api/v1/content/youtube-automation/editor). Standard library and ffmpeg only; the editor's folder layout is his (ws/voice/os_myin,
ws/voice/os_voice, versions/, voicever/, jobs/, orders.json).

  import myin_editor_os as L
  L.lock(project) · L.unlock(project) · L.keep_alive(project)     one video, one editor (renewed every 2 minutes, freed after 10 silent)
  L.pull_orders(project, editor) · L.report(project, order, ...)  orders from members' AI chats into orders.json, and what each became;
                                                                  hand edits from the OS editor screen into edits.json once 완성 is pressed
  L.materials(project, version, files)                            one version's files for the OS editor screen (edit video, sound lines, …)
  L.save_done(project)                                            a 완성 that made no new final (nothing changed, or it stopped)
  L.confirm(project, editor, version, engine)                     check · bundle · upload; the edit becomes the OS's newest final
  L.say(project, editor, order, text)                             a sentence read again in the video's voice on the render PC (k takes)
  L.restore(project, editor)                                      another computer goes on from an OS final (its materials and pieces)
  L.settings()                                                    the runner's engine folders, Python, fingerprint and render slots
  L.upload_image(project, path)                                   a picture the editor uses, kept by the OS for whoever takes over
  L.cleanup(project, editor)                                      two weeks after YouTube, clear this computer's edit files
  L.screen_publish(folder)                                        a new OS editor screen for everyone: the folder's page, scripts, styles
                                                                  (also: python3 -I tools/myin_editor_os.py screen <folder>)

Key: MYIN_LOCAL_KEY, else the 「내 컴퓨터 렌더」 key myin-local saved. Computer name: MYIN_PC, else this computer's name.
Self-check: python3 -I tools/myin_editor_os.py --self-test
"""
import calendar, hashlib, json, os, re, shutil, socket, subprocess, sys, tarfile, tempfile, threading, time, urllib.error, urllib.request

OS_URL = os.environ.get("OS_URL", "https://brandyaction-os.vercel.app").rstrip("/")
ROUTE = "/api/v1/content/youtube-automation/editor"
FPS = 60
PART = 45_000_000  # the OS keeps bundles in ≤45 MB parts
BUNDLE_SKIP = ("chunks", "handouts")


class EditorError(Exception):
    def __init__(self, code, message):
        super().__init__(f"{message} ({code})"); self.code = code; self.message = message


def home():
    if os.environ.get("MYIN_LOCAL_HOME"): return os.environ["MYIN_LOCAL_HOME"]
    if os.name == "nt": return os.path.join(os.environ.get("LOCALAPPDATA") or os.path.expanduser("~"), "myin-local")
    return os.path.join(os.path.expanduser("~"), "myin-local")

def key():
    if os.environ.get("MYIN_LOCAL_KEY"): return os.environ["MYIN_LOCAL_KEY"]
    try: return open(os.path.join(home(), "key"), encoding="utf-8").read().strip()
    except OSError: raise EditorError("EDIT_NO_KEY", "이 컴퓨터에 「내 컴퓨터 렌더」 키가 없어요. OS 「내 컴퓨터 연결」을 먼저 해 주세요.")

def pc(): return os.environ.get("MYIN_PC") or socket.gethostname()

def jl(p, d=None):
    try: return json.load(open(p, encoding="utf-8"))
    except Exception: return d

def js(p, o):
    tmp = p + ".part"; json.dump(o, open(tmp, "w", encoding="utf-8"), ensure_ascii=False, indent=1); os.replace(tmp, p)


def _call(method, url, body=None, headers=None):
    req = urllib.request.Request(url, data=body, method=method, headers=headers or {})
    try:
        with urllib.request.urlopen(req, timeout=600) as r: return r.read()
    except urllib.error.HTTPError as e:
        try: err = json.loads(e.read()).get("error", {})
        except Exception: err = {}
        raise EditorError(err.get("code", f"HTTP_{e.code}"), err.get("message", f"OS가 {e.code}로 답했어요."))

def api(action, project, **body):
    data = json.dumps({"action": action, **({"projectId": project} if project else {}), **{k: v for k, v in body.items() if v is not None}}).encode()
    return json.loads(_call("POST", OS_URL + ROUTE, data, {"authorization": f"Bearer {key()}", "content-type": "application/json"}))

def view(project, name="edits"):
    return json.loads(_call("GET", f"{OS_URL}{ROUTE}?projectId={project}&view={name}", None, {"authorization": f"Bearer {key()}"}))

def _put(url, path, ctype):
    _call("PUT", url, open(path, "rb").read(), {"content-type": ctype, "x-upsert": "true"})

def _get(url, path):
    tmp = path + ".part"; open(tmp, "wb").write(_call("GET", url)); os.replace(tmp, path)


def settings():
    """What myin-local wrote when it installed the engine (v3 7.2-11): engine folders, Python, fingerprint and render slots."""
    s = jl(os.path.join(home(), "editor.json"))
    if not s: raise EditorError("EDIT_NO_SETTINGS", "실행기(myin-local)를 한 번 켜 주세요. 엔진을 받은 뒤 편집기 설정이 생겨요.")
    return s


IMAGE_TYPES = {".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png", ".webp": "image/webp"}

def upload_image(project, path, credit=None):
    """A picture the editor uses (v3 7.2-12) goes to the OS's store for this video; returns its OS file name (edit-….jpg)."""
    ctype = IMAGE_TYPES.get(os.path.splitext(path)[1].lower())
    if not ctype: raise EditorError("MYIN_OUR_IMAGE_TYPE", "JPG · PNG · WEBP 이미지만 올릴 수 있어요.")
    up = api("image_upload", project, pc=pc(), type=ctype)
    _put(up["uploadUrl"], path, ctype)
    return api("image_saved", project, pc=pc(), file=up["file"], path=up["path"], credit=credit)["file"]


SCREEN_CODE = re.compile(r"^[a-z][a-z0-9_-]{0,40}\.(html|js|css)$")

def screen_publish(folder):
    """A new OS editor screen, live for everyone at once (대표 결정 2026-11-05): the folder's page, scripts and styles (flat names; others
    are left out) replace the ones up now. The OS keeps who put it up and when."""
    names = sorted(n for n in os.listdir(folder) if SCREEN_CODE.match(n))
    if "index.html" not in names: raise EditorError("EDIT_SCREEN_NO_INDEX", "index.html이 있는 화면 폴더를 골라 주세요.")
    return api("screen_publish", None, files={n: open(os.path.join(folder, n), encoding="utf-8").read() for n in names})


# ── 편집 잠금: 한 영상은 한 사람·한 컴퓨터 ──
def lock(project): return api("lock", project, pc=pc())
def unlock(project): return api("unlock", project, pc=pc())

def keep_alive(project, every=120):
    """Renews the lock until the returned event is set; a lost lock (10 silent minutes, someone else took it) stops it."""
    stop = threading.Event()
    def loop():
        while not stop.wait(every):
            try: api("heartbeat", project, pc=pc())
            except EditorError as e:
                if e.code in ("EDIT_LOCK_LOST", "EDIT_LOCKED"): stop.set(); print("편집 잠금이 풀렸어요:", e.message, flush=True)
            except Exception as e: print("잠금 신호를 못 보냈어요(다음에 다시):", e, flush=True)
    threading.Thread(target=loop, daemon=True).start()
    return stop


# ── 편집 주문: AI 채팅 → 이 편집기 ──
def pull_orders(project, editor):
    """Takes the waiting orders into orders.json (the editor's format, plus os_id) with each changed storyboard beside the work folder's.
    Hand edits from the OS editor screen come only after someone pressed 완성: they go to edits.json (the editor's manual_run.py takes them from
    there), and 완성 itself becomes saves.json's pending save; the version the next edits start from goes to base.json."""
    vo = os.path.join(editor, "ws", "voice", "os_myin"); os.makedirs(vo, exist_ok=True)
    path = os.path.join(editor, "orders.json"); orders = jl(path, []); epath = os.path.join(editor, "edits.json"); edits = jl(epath, [])
    known = {o.get("os_id") for o in orders + edits}; new = []
    got = api("next", project, pc=pc())
    for o in got["orders"]:
        if o["id"] in known: continue  # taken before and not answered yet (the editor closed): it comes again
        if o.get("manual"):
            e = {"id": f"e{max([int(x['id'][1:]) for x in edits] + [0]) + 1:03d}", "os_id": o["id"], "t": time.time(), "version": o.get("version"), "text": o["text"], "manual": o["manual"]}
            edits.append(e); new.append(e); continue
        story = None
        if o.get("storyboardUrl"):
            story = f"order_{o['id'][:8]}.json"; _get(o["storyboardUrl"], os.path.join(vo, story))
        entry = {"id": f"o{len(orders) + 1:03d}", "os_id": o["id"], "t": time.time(), "text": o["text"], "at": o.get("videoAt"), "meaning": o.get("meaning", ""),
                 "story": story, "subtitles": o.get("subtitles", []), "feedback": o.get("feedbackIds", []), "status": "waiting"}
        orders.append(entry); new.append(entry)
    if any(not e.get("manual") for e in new): js(path, orders)
    if any(e.get("manual") for e in new): js(epath, edits)
    spath = os.path.join(editor, "saves.json"); saves = jl(spath, {"list": [], "pending": None}) or {"list": [], "pending": None}
    if got.get("save") and not saves.get("pending"): saves["pending"] = {"label": "완성", "t": time.time(), "os": got["save"]["at"]}; js(spath, saves)
    bpath = os.path.join(editor, "base.json")
    if got.get("base") != (jl(bpath, {}) or {}).get("version"): js(bpath, {"version": got.get("base"), "t": time.time()})
    return new

def report(project, order, status, version=None, note=""):
    """done (a candidate version on this computer) · failed (why) · queued (give it back)."""
    os_id = order.get("os_id") if isinstance(order, dict) else order
    return api("result", project, pc=pc(), orderId=os_id, status=status, version=version, note=note or None)


def save_done(project):
    """완성 that made no new final (nothing changed, or it stopped): the OS screen stops waiting. A confirmed final ends it by itself."""
    return api("save_done", project, pc=pc())


# ── 편집 화면 재료: OS 제작 탭의 편집 화면이 재생할 것 (편집 화면 이식 2026-11-05) ──
SCREEN_TYPES = {".json": "application/json", ".srt": "application/x-subrip", ".mp4": "video/mp4", ".mp3": "audio/mpeg", ".m4a": "audio/mp4", ".wav": "audio/wav",
                ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png", ".webp": "image/webp"}

def materials(project, version, files, frm=None, note=None, final=None):
    """Puts one version's files up for the OS editor screen: version.json (the screen's version object; it names its other files by these
    file names) and the rest — the edit video (720p, no subtitles), sound lines, wave peaks, subtitles, pictures. Flat names only.
    `final` = the OS final's time when this version is that final (the first one, taken in as this computer's own)."""
    names = [os.path.basename(f) for f in files]
    if "version.json" not in names: raise EditorError("EDIT_MATERIALS_MISSING", "version.json이 있어야 해요.")
    bad = [n for n in names if os.path.splitext(n)[1].lower() not in SCREEN_TYPES]
    if bad: raise EditorError("EDIT_MATERIALS_TYPE", f"올릴 수 없는 파일 종류예요: {', '.join(bad[:5])}")
    up = api("materials_upload", project, pc=pc(), version=version, files=[{"name": n, "bytes": os.path.getsize(f)} for n, f in zip(names, files)])["uploads"]
    where = {u["name"]: u for u in up}
    for n, f in zip(names, files): _put(where[n]["url"], f, where[n]["type"])
    return api("materials_saved", project, pc=pc(), version=version, **{"from": frm}, note=note, final=final)["version"]


# ── 문장 테이크: 렌더 PC가 이 영상 목소리로 다시 읽기 (이 컴퓨터엔 목소리 키가 없음) ──
def say(project, editor, order, text, takes=3, wait=600, every=10):
    """Asks the render PC to read `text` again `takes` times and saves the takes as Logan's say.py did: newlines/<order>_<k>.wav and
    newlines/<order>.json {text, takes: [{file, rise}], best}. A person listens and picks; `best` is only the first take until they do
    (대표 2026-11-04: the ear chose the take with the highest end, so no take is ranked by its end height). A few won of Fish per take."""
    sid = api("say", project, sentences=[text], takes=takes)["sayId"]
    end = time.time() + wait
    while True:
        s = api("say_status", project, sayId=sid)
        if s["status"] == "done": break
        if s["status"] == "failed": raise EditorError("EDIT_SAY_FAILED", f"렌더 PC가 문장을 만들지 못했어요({s.get('error')}).")
        if time.time() > end: raise EditorError("EDIT_SAY_TIMEOUT", "렌더 PC가 아직 문장을 만들지 않았어요. 잠시 뒤 다시 해 주세요.")
        time.sleep(every)
    out = os.path.join(editor, "newlines"); os.makedirs(out, exist_ok=True); rows = []
    for t in sorted(s["takes"], key=lambda t: t["k"]):
        f = os.path.join(out, f"{order}_{t['k']}.wav"); _get(t["url"], f); rows.append({"file": f, "rise": t["rise"]})
    js(os.path.join(out, f"{order}.json"), {"text": text, "takes": rows, "best": rows[0]["file"]})
    return {"takes": rows, "best": rows[0]["file"]}


# ── 확정 전 자동 검사 (OS가 같은 기준으로 다시 봄) ──
def _ff(args): return subprocess.run(args, capture_output=True, text=True, encoding="utf-8", errors="replace")

def measure(video, end):
    errs = [l for l in _ff(["ffmpeg", "-v", "error", "-i", video, "-map", "0:v", "-f", "null", "-"]).stderr.splitlines() if l.strip()]
    q = lambda sel, ent: _ff(["ffprobe", "-v", "error", "-select_streams", sel, "-count_packets", "-show_entries", ent, "-of", "csv=p=0", video]).stdout.strip()
    report_ = _ff(["ffmpeg", "-hide_banner", "-nostats", "-i", video, "-vn", "-af", "ebur128=peak=true:framelog=verbose", "-f", "null", "-"]).stderr
    lufs = re.findall(r"\bI:\s+(-?\d+(?:\.\d+)?) LUFS", report_); peak = re.findall(r"Peak:\s+(-?\d+(?:\.\d+)?) dBFS", report_)
    return {"decodeErrors": len(errs), "frames": int(q("v:0", "stream=nb_read_packets") or 0), "end": float(end),
            "videoSeconds": float(q("v:0", "stream=duration") or 0), "audioSeconds": float(q("a:0", "stream=duration") or 0)}, \
           (float(lufs[-1]) if lufs else None, float(peak[-1]) if peak else None)

def check_issues(c):
    want = round(c["end"] * FPS); out = []
    if c["decodeErrors"]: out.append(f"디코드 오류 {c['decodeErrors']}건")
    if abs(c["frames"] - want) > 1: out.append(f"프레임 수 {c['frames']} / 예상 {want}")
    if abs(c["videoSeconds"] - c["audioSeconds"]) >= 1.5 / FPS + 0.03: out.append(f"소리·화면 길이(화면 {c['videoSeconds']:.3f}초 · 소리 {c['audioSeconds']:.3f}초)")
    return out


# ── 확정: 최종본 + 재료 묶음을 OS에 ──
def _bundle(editor, v, version, into):
    """The material bundle (as Logan's sim_lib): the work folder's mix files, this version's storyboard, voice, words and subtitles, the orders."""
    ws = os.path.join(editor, "ws"); vo = os.path.join(ws, "voice", "os_myin"); b = os.path.join(into, "bundle")
    snap = os.path.join(editor, "voicever", v.get("voice", version)); os.makedirs(os.path.join(b, "os_myin")); os.makedirs(os.path.join(b, "os_voice"))
    for f in os.listdir(vo):
        p = os.path.join(vo, f)
        if f in BUNDLE_SKIP or f.endswith((".mp4", ".wav")) or f.startswith(("story_", "preview_", "order_")): continue
        if os.path.isdir(p): shutil.copytree(p, os.path.join(b, "os_myin", f))
        else: shutil.copy(p, os.path.join(b, "os_myin", f))
    shutil.copy(os.path.join(vo, v["story"]), os.path.join(b, "os_myin", "myin_storyboard.json"))
    for f in ["words.json", "subs_myin.ass", "subs_youtube.srt", "subs_qc.md"]:
        if os.path.exists(os.path.join(snap, f)): shutil.copy(os.path.join(snap, f), os.path.join(b, "os_myin", f))
    hist = []
    for o in jl(os.path.join(editor, "orders.json"), []):
        j = jl(os.path.join(editor, "jobs", f"{o['id']}.json"), {}) or {}
        hist.append({"id": o["id"], "os_id": o.get("os_id"), "t": o.get("t"), "text": o["text"], "at": o.get("at"), "meaning": j.get("meaning") or o.get("meaning"),
                     "base": j.get("base"), "new": j.get("new"), "status": j.get("status")})
    js(os.path.join(b, "주문기록.json"), hist)
    shutil.copy(os.path.join(snap, "speech.txt"), os.path.join(b, "os_voice", "speech.txt"))
    r = _ff(["ffmpeg", "-y", "-v", "error", "-i", os.path.join(snap, "voice.wav"), "-c:a", "flac", os.path.join(b, "os_voice", "voice.flac")])
    if r.returncode: raise EditorError("EDIT_BUNDLE_FAILED", "목소리를 재료 묶음에 넣지 못했어요: " + r.stderr[-200:])
    tar = os.path.join(into, "bundle.tar.gz")
    with tarfile.open(tar, "w:gz") as t: t.add(b, arcname=".")
    parts, n = [], 0
    with open(tar, "rb") as f:
        while True:
            buf = f.read(PART)
            if not buf: break
            p = os.path.join(into, f"part{n:02d}.bin"); open(p, "wb").write(buf)
            parts.append({"path": p, "bytes": len(buf), "sha256": hashlib.sha256(buf).hexdigest()}); n += 1
    return parts

def confirm(project, editor, version, engine, note=""):
    """Confirms one of this computer's versions (it must be edited from the newest OS final, and this computer must hold the lock)."""
    v = jl(os.path.join(editor, "versions", f"{version}.json"))
    if not v: raise EditorError("EDIT_NO_VERSION", f"{version}이 없어요.")
    check, (lufs, peak) = measure(v["video"], v["end"])
    bad = check_issues(check)
    if bad: raise EditorError("EDIT_CHECK_FAILED", "확정 전 자동 검사에 걸렸어요: " + " · ".join(bad))
    if lufs is None or peak is None: raise EditorError("EDIT_LOUDNESS_UNKNOWN", "소리 크기를 재지 못했어요.")
    if abs(lufs + 14) > 1 or peak > -1: raise EditorError("EDIT_LOUDNESS", f"소리 크기 검사에 걸렸어요: 음량 {lufs} LUFS(−15~−13) · 최대 {peak} dB(−1 이하)")
    hd = os.path.join(editor, "versions", f"{version}_handouts")   # his apply.py remakes them per version
    handouts = [os.path.join(hd, "한장정리.png"), os.path.join(hd, "덱_전체.pdf")]
    has_handouts = all(os.path.exists(p) for p in handouts)
    srt = next((p for p in [os.path.join(editor, "versions", f"{version}.srt"), os.path.join(editor, "ws", "voice", "os_myin", "subs_youtube.srt")] if os.path.exists(p)), None)
    if not srt: raise EditorError("EDIT_NO_SRT", "유튜브 자막(subs_youtube.srt)이 없어요.")
    segs = v.get("segs") or []
    local = set(v.get("order") or []); orders = [o["os_id"] for o in jl(os.path.join(editor, "orders.json"), []) if o.get("os_id") and o["id"] in local]
    with tempfile.TemporaryDirectory(prefix="myin-confirm-") as tmp:
        parts = _bundle(editor, v, version, tmp)
        start = api("confirm_start", project, pc=pc(), fromVersion=version, note=(note or v.get("note") or "")[:500], engine=engine, bytes=os.path.getsize(v["video"]),
                    lufs=lufs, peak=peak, bounds=[s[1] for s in segs][1:], check=check, orders=orders, bundleParts=len(parts), handouts=has_handouts)
        _put(start["videoUploadUrl"], v["video"], "video/mp4")
        _put(start["srtUploadUrl"], srt, "application/x-subrip")
        if has_handouts:
            _put(start["summaryUploadUrl"], handouts[0], "image/png"); _put(start["deckUploadUrl"], handouts[1], "application/pdf")
        for url, part in zip(start["bundleUploadUrls"], parts): _put(url, part["path"], "application/octet-stream")
        done = api("confirm_finish", project, pc=pc(), confirmId=start["confirmId"], parts=[{"bytes": p["bytes"], "sha256": p["sha256"]} for p in parts])
    marker = jl(os.path.join(editor, "pc.json"), {}); marker.update({"final": done["final"], "confirmed_at": time.time()}); js(os.path.join(editor, "pc.json"), marker)
    return done


# ── 다른 컴퓨터에서 이어받기 ──
def restore(project, editor, at=None):
    """Puts an OS final's materials into editor/ws/voice and splits the final at its piece bounds (copy only, nothing redrawn). The
    editor then registers it as v1 (Logan's prepare.py) with the engine the result names (install that one if this computer has another)."""
    h = api("handoff", project, at=at)
    if not h.get("bundle"): raise EditorError("EDIT_NO_BUNDLE", "OS가 만든 완성본이라 재료 묶음이 없어요. 영상을 만든 작업 폴더에서 편집을 시작해요.")
    vroot = os.path.join(editor, "ws", "voice"); os.makedirs(vroot, exist_ok=True)
    got = os.path.join(editor, "restore"); shutil.rmtree(got, ignore_errors=True); os.makedirs(got)
    tar = os.path.join(got, "bundle.tar.gz")
    with open(tar, "wb") as out:
        for n, part in enumerate(h["bundle"]):
            p = os.path.join(got, f"part{n:02d}.bin"); _get(part["url"], p); buf = open(p, "rb").read()
            if len(buf) != part["bytes"] or hashlib.sha256(buf).hexdigest() != part["sha256"]: raise EditorError("EDIT_BUNDLE_BROKEN", f"재료 묶음 {n + 1}번 조각이 OS 기록과 달라요.")
            out.write(buf)
    for d in ("os_myin", "os_voice"): shutil.rmtree(os.path.join(vroot, d), ignore_errors=True)
    with tarfile.open(tar) as t:
        if any(m.name.startswith("/") or ".." in m.name.split("/") for m in t.getmembers()): raise EditorError("EDIT_BUNDLE_BROKEN", "재료 묶음 안 경로가 이상해요.")
        t.extractall(vroot, **({"filter": "data"} if hasattr(tarfile, "data_filter") else {}))
    vo = os.path.join(vroot, "os_myin"); ov = os.path.join(vroot, "os_voice")
    r = _ff(["ffmpeg", "-y", "-v", "error", "-i", os.path.join(ov, "voice.flac"), "-c:a", "pcm_s16le", os.path.join(ov, "voice.wav")])
    if r.returncode: raise EditorError("EDIT_RESTORE_FAILED", "목소리를 풀지 못했어요: " + r.stderr[-200:])
    video = os.path.join(got, "final.mp4"); _get(h["videoUrl"], video); _get(h["srtUrl"], os.path.join(vo, "subs_youtube.srt"))
    ck = os.path.join(vo, "chunks"); os.makedirs(ck, exist_ok=True)
    bounds = h["edit"]["bounds"]
    r = _ff(["ffmpeg", "-y", "-v", "error", "-i", video, "-an", "-c", "copy", "-f", "segment", "-reset_timestamps", "1",
             "-segment_frames", ",".join(map(str, bounds)), os.path.join(ck, "c%d.mp4")])
    files = [f for f in os.listdir(ck) if re.match(r"c\d+\.mp4$", f)]
    if r.returncode or len(files) != len(bounds) + 1:
        raise EditorError("EDIT_RESTORE_PIECES", f"최종본을 나눈 조각 수({len(files)})가 기록({len(bounds) + 1})과 달라요 — 이어받지 않았어요.")
    images = os.path.join(editor, "ws", "editor-images"); os.makedirs(images, exist_ok=True)
    for im in h.get("images") or []: _get(im["url"], os.path.join(images, im["file"]))
    js(os.path.join(editor, "pc.json"), {"final": h["at"], "restored_at": time.time()})
    return {"final": h["at"], "v": h["v"], "video": video, "images": [im["file"] for im in h.get("images") or []], "chunks": len(files), "bounds": bounds, "end": h["edit"]["check"]["end"],
            "engine": h["edit"]["engine"], "engineDownload": h.get("engine")}


# ── 2주 뒤 내 컴퓨터 정리 ──
def cleanup(project, editor, now=None, days=14):
    """Deletes this computer's edit folder two weeks after the video went up to YouTube (the OS keeps the final and its bundle)."""
    now = now or time.time(); s = view(project)
    up = s.get("uploadedAt")
    if not up: return {"deleted": False, "why": "아직 유튜브에 안 올렸어요"}
    up_t = calendar.timegm(time.strptime(up[:19], "%Y-%m-%dT%H:%M:%S"))
    if now - up_t < days * 86400: return {"deleted": False, "why": f"올린 지 {int((now - up_t) / 86400)}일 — {days}일 뒤에 정리해요"}
    mk = jl(os.path.join(editor, "pc.json"), {}); since = mk.get("confirmed_at") or mk.get("restored_at") or 0; vd = os.path.join(editor, "versions")
    newer = [f[:-5] for f in os.listdir(vd) if f.endswith(".json") and os.path.getmtime(os.path.join(vd, f)) > since + 5] if os.path.isdir(vd) else []
    if newer: return {"deleted": False, "why": f"확정 안 된 새 버전 {', '.join(sorted(newer))}이 있어 미뤄요"}
    if (s.get("lock") or {}).get("pc") == pc(): return {"deleted": False, "why": "이 컴퓨터에서 편집 중이라 미뤄요"}
    size = sum(os.path.getsize(os.path.join(dp, f)) for dp, _, fn in os.walk(editor) for f in fn); shutil.rmtree(editor)
    return {"deleted": True, "freed_mb": round(size / 1e6)}


# ── self-check: a fake OS on localhost, a fake editor folder, ffmpeg replaced ──
def _self_test():
    import http.server
    global OS_URL, _ff
    calls, store = [], {}
    project, order, hand = "33333333-3333-4333-8333-333333333333", "44444444-4444-4444-8444-444444444444", "77777777-7777-4777-8777-777777777777"
    class H(http.server.BaseHTTPRequestHandler):
        def log_message(self, *a): pass
        def _send(self, obj, code=200):
            b = json.dumps(obj).encode(); self.send_response(code); self.send_header("content-type", "application/json"); self.end_headers(); self.wfile.write(b)
        def do_PUT(self):
            store[self.path] = self.rfile.read(int(self.headers["content-length"])); calls.append(("PUT", self.path, self.headers["content-type"])); self._send({})
        def do_GET(self):
            if self.path.startswith("/files/"): b = store.get(self.path.replace("/files/", "/up/"), b"{}"); self.send_response(200); self.end_headers(); self.wfile.write(b); return
            self._send({"uploadedAt": None, "lock": None})
        def do_POST(self):
            body = json.loads(self.rfile.read(int(self.headers["content-length"]))); calls.append(("POST", body["action"], body)); base = f"http://127.0.0.1:{srv.server_port}"
            if self.headers["authorization"] != "Bearer bos_pat_test": return self._send({"error": {"code": "INVALID_SESSION", "message": "x"}}, 401)
            if body["action"] == "next":
                store["/up/story"] = b'{"scenes": [1]}'
                return self._send({"orders": [{"id": order, "text": "3번 장면 사진 바꿔줘", "videoAt": "1:23", "meaning": "사진 교체", "feedbackIds": [], "storyboardUrl": base + "/files/story", "subtitles": []},
                                              {"id": hand, "text": "[손으로] 장면 끝 당기기", "videoAt": None, "meaning": "", "feedbackIds": [], "storyboardUrl": None, "subtitles": [],
                                               "manual": {"kind": "trim", "lane": "scene", "item": 3, "edge": "b", "from": 12.5, "to": 11.9}, "version": "v1"}],
                                   "save": {"at": "2026-11-05T09:00:00.000Z", "by": order, "name": "편집자"}, "base": None})
            if body["action"] == "materials_upload":
                return self._send({"uploads": [{"name": f["name"], "url": f"{base}/up/m-{f['name']}", "type": SCREEN_TYPES[os.path.splitext(f["name"])[1]]} for f in body["files"]]})
            if body["action"] == "materials_saved": return self._send({"ok": True, "version": {"name": body["version"], "files": 2}})
            if body["action"] == "screen_publish": return self._send({"ok": True, "files": len(body["files"])})
            if body["action"] == "confirm_start":
                return self._send({"confirmId": "55555555-5555-4555-8555-555555555555", "videoUploadUrl": base + "/up/video", "srtUploadUrl": base + "/up/srt",
                                   "bundleUploadUrls": [f"{base}/up/part{n}" for n in range(body["bundleParts"])],
                                   **({"summaryUploadUrl": base + "/up/summary", "deckUploadUrl": base + "/up/deck"} if body.get("handouts") else {})})
            if body["action"] == "confirm_finish": return self._send({"ok": True, "final": "2026-11-04T10:00:00.000Z", "v": 2})
            if body["action"] == "image_upload": return self._send({"file": "edit-0123456789ab.jpg", "path": "o/p/r/editor-images/edit-0123456789ab.jpg", "uploadUrl": base + "/up/img"})
            if body["action"] == "image_saved": return self._send({"ok": True, "file": body["file"], "bytes": 3})
            if body["action"] == "say": return self._send({"sayId": "66666666-6666-4666-8666-666666666666", "status": "queued"})
            if body["action"] == "say_status":
                store["/up/take0"] = b"RIFF0"; store["/up/take1"] = b"RIFF1"
                return self._send({"status": "done", "takes": [{"i": 0, "k": 1, "rise": 0.4, "url": base + "/files/take1"}, {"i": 0, "k": 0, "rise": 1.8, "url": base + "/files/take0"}]})
            if body["action"] == "handoff":
                parts = [{"bytes": len(store[f"/up/part{n}"]), "sha256": hashlib.sha256(store[f"/up/part{n}"]).hexdigest(), "url": f"{base}/files/part{n}"} for n in range(len([k for k in store if k.startswith("/up/part")]))]
                return self._send({"at": "2026-11-04T10:00:00.000Z", "v": 2, "videoUrl": base + "/files/video", "srtUrl": base + "/files/srt", "bundle": parts,
                                   "images": [{"file": "edit-0123456789ab.jpg", "bytes": 3, "credit": None, "url": base + "/files/img"}],
                                   "edit": {"bounds": [300], "engine": "a" * 32, "check": {"end": 10}}, "engine": None})
            self._send({"ok": True})
    srv = http.server.ThreadingHTTPServer(("127.0.0.1", 0), H); threading.Thread(target=srv.serve_forever, daemon=True).start()
    OS_URL = f"http://127.0.0.1:{srv.server_port}"; os.environ["MYIN_LOCAL_KEY"] = "bos_pat_test"; os.environ["MYIN_PC"] = "test-mac"
    def fake_ff(args):
        out = args[-1] if args[0] == "ffmpeg" else ""
        if out.endswith((".flac", ".wav")): open(out, "wb").write(b"voice")
        if "segment" in args: [open(out.replace("%d", str(n)), "wb").write(b"v") for n in range(2)]
        text = {"stream=nb_read_packets": "600", "stream=duration": "10.000"}
        stdout = next((v for k, v in text.items() if k in args), "")
        return subprocess.CompletedProcess(args, 0, stdout, "    I:         -14.1 LUFS\n    Peak:       -1.6 dBFS" if "ebur128=peak=true:framelog=verbose" in args else "")
    _ff = fake_ff
    with tempfile.TemporaryDirectory() as ed:
        vo = os.path.join(ed, "ws", "voice", "os_myin"); snap = os.path.join(ed, "voicever", "v1")
        for d in [vo, snap, os.path.join(ed, "versions"), os.path.join(ed, "jobs")]: os.makedirs(d, exist_ok=True)
        open(os.path.join(vo, "story_v2.json"), "w").write("{}"); open(os.path.join(vo, "music_match.json"), "w").write("{}"); open(os.path.join(vo, "mix.wav"), "w").write("x")
        for f in ["words.json", "subs_myin.ass", "subs_youtube.srt", "speech.txt", "voice.wav"]: open(os.path.join(snap, f), "w").write("x")
        lock(project); assert calls[-1][2]["pc"] == "test-mac"
        got = pull_orders(project, ed)
        assert [o["os_id"] for o in got] == [order, hand] and open(os.path.join(vo, got[0]["story"])).read() == '{"scenes": [1]}'
        assert [e["os_id"] for e in jl(os.path.join(ed, "edits.json"))] == [hand] and jl(os.path.join(ed, "edits.json"))[0]["manual"]["kind"] == "trim", "a hand edit goes to edits.json"
        assert [o["os_id"] for o in jl(os.path.join(ed, "orders.json"))] == [order] and jl(os.path.join(ed, "saves.json"))["pending"]["os"] == "2026-11-05T09:00:00.000Z"
        assert pull_orders(project, ed) == [], "an order taken before is not added twice"
        got = got[:1]
        vj = os.path.join(ed, "version.json"); js(vj, {"name": "v1", "scenes": []}); px = os.path.join(ed, "proxy.mp4"); open(px, "wb").write(b"mp4")
        assert materials(project, "v1", [vj, px], final="2026-11-04T10:00:00.000Z")["name"] == "v1"
        assert ("PUT", "/up/m-proxy.mp4", "video/mp4") in calls and next(c[2] for c in calls if c[1] == "materials_saved")["final"] == "2026-11-04T10:00:00.000Z"
        save_done(project); assert calls[-1][1] == "save_done"
        web = os.path.join(ed, "web"); os.makedirs(web)
        for n in ["index.html", "trim.js", "notes.txt", "Old.JS"]: open(os.path.join(web, n), "w", encoding="utf-8").write("// 화면")
        assert screen_publish(web)["files"] == 2 and set(calls[-1][2]["files"]) == {"index.html", "trim.js"} and "projectId" not in calls[-1][2], "only the screen's own files, for no one video"
        video = os.path.join(ed, "versions", "v2.mp4"); open(video, "wb").write(b"video-bytes")
        open(os.path.join(ed, "versions", "v2.srt"), "w").write("1\n")
        os.makedirs(os.path.join(ed, "versions", "v2_handouts")); open(os.path.join(ed, "versions", "v2_handouts", "한장정리.png"), "wb").write(b"png"); open(os.path.join(ed, "versions", "v2_handouts", "덱_전체.pdf"), "wb").write(b"pdf")
        js(os.path.join(ed, "versions", "v2.json"), {"name": "v2", "video": video, "story": "story_v2.json", "end": 10, "segs": [[None, 0, 300], [None, 300, 600]], "order": ["o001"], "voice": "v1", "note": "사진 교체"})
        report(project, got[0], "done", "v2", "사진 바꿈"); assert calls[-1][2] == {"action": "result", "projectId": project, "pc": "test-mac", "orderId": order, "status": "done", "version": "v2", "note": "사진 바꿈"}
        done = confirm(project, ed, "v2", "a" * 32)
        start = next(c[2] for c in calls if c[1] == "confirm_start")
        assert start["bounds"] == [300] and start["orders"] == [order] and start["check"]["frames"] == 600 and start["lufs"] == -14.1 and start["bundleParts"] == 1
        assert ("PUT", "/up/video", "video/mp4") in calls and ("PUT", "/up/part0", "application/octet-stream") in calls
        assert start["handouts"] is True and ("PUT", "/up/summary", "image/png") in calls and ("PUT", "/up/deck", "application/pdf") in calls
        finish = next(c[2] for c in calls if c[1] == "confirm_finish")
        assert finish["parts"][0]["sha256"] == hashlib.sha256(store["/up/part0"]).hexdigest() and done["v"] == 2
        with tarfile.open(fileobj=__import__("io").BytesIO(store["/up/part0"])) as t:
            names = set(t.getnames())
        assert {"./os_myin/myin_storyboard.json", "./os_myin/music_match.json", "./os_voice/voice.flac", "./주문기록.json"} <= names and "./os_myin/mix.wav" not in names
        try: confirm(project, ed, "v9", "a" * 32); raise AssertionError("a missing version must stop")
        except EditorError as e: assert e.code == "EDIT_NO_VERSION"
        img = os.path.join(ed, "photo.jpg"); open(img, "wb").write(b"jpg")
        assert upload_image(project, img, "Unsplash · 홍길동") == "edit-0123456789ab.jpg" and ("PUT", "/up/img", "image/jpeg") in calls
        other = os.path.join(ed, "other"); r = restore(project, other)
        assert r["images"] == ["edit-0123456789ab.jpg"] and open(os.path.join(other, "ws", "editor-images", "edit-0123456789ab.jpg"), "rb").read() == b"jpg"
        os.environ["MYIN_LOCAL_HOME"] = ed
        try: settings(); raise AssertionError("no settings before the runner ran")
        except EditorError as e: assert e.code == "EDIT_NO_SETTINGS"
        js(os.path.join(ed, "editor.json"), {"engine": {"fingerprint": "a" * 32}, "slots": 6}); assert settings()["slots"] == 6
        assert r["chunks"] == 2 and os.path.exists(os.path.join(other, "ws", "voice", "os_myin", "myin_storyboard.json"))
        assert check_issues({"decodeErrors": 0, "frames": 597, "end": 10, "videoSeconds": 10, "audioSeconds": 10}) == ["프레임 수 597 / 예상 600"]
        took = say(project, ed, "o002", "이 문장을 다시 읽어 줘", takes=2, every=0)
        assert took["best"].endswith("o002_0.wav"), "no take is ranked: the first one until a person picks"
        assert open(os.path.join(ed, "newlines", "o002_0.wav"), "rb").read() == b"RIFF0"
        assert jl(os.path.join(ed, "newlines", "o002.json"))["takes"][1]["rise"] == 0.4
        assert cleanup(project, ed)["deleted"] is False
        assert calendar.timegm(time.strptime("2026-11-04T00:00:00", "%Y-%m-%dT%H:%M:%S")) == 1793750400
    srv.shutdown(); print("myin_editor_os self-test ok")


if __name__ == "__main__" and "--self-test" in sys.argv:
    _self_test()
elif __name__ == "__main__" and sys.argv[1:2] == ["screen"] and len(sys.argv) == 3:
    print(screen_publish(sys.argv[2]))
