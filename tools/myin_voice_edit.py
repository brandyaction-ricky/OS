"""문장 하나 고치기 (OS 2026-11-17, 요청 2번): 「음성 확인 · 수정」에서 고른 문장 — Fish를 부르지 않는다. 음성을 만들 때 문장마다 만들어 둔
테이크(pNN_sJJ_K_t.wav)를 들려주고(takes), 고른 테이크로 바꾸거나(take), 그 문장 앞뒤 쉼을 더한다(pause). 바꾼 뒤에는 문단을 엔진의 이어 붙이기
(stage_voice.join_paragraph)로 다시 잇고 voice.wav · timings.json을 다시 만든다(받아쓰기 · 자막은 워커가 이어서). 엔진에 join_paragraph가 없으면
(2026-11-17 전 음성 패키지) 아무것도 바꾸지 않고 3으로 끝난다.

  cd <work>/tools/mindmap_pipeline && python myin_voice_edit.py <음성 폴더 이름> takes <문단> <문장 글> <내보낼 폴더>
                                                         take  <문단> <문장 글> <테이크 파일 이름>
                                                         pause <문단> <문장 글> <앞에 더할 초> <뒤에 더할 초>
문장 글은 음성 검사(voice_audit)의 문장: make_paragraph가 짧은 조각을 앞뒤 문장과 합쳐 만든 문장 안에서 찾는다.
"""
import json, os, re, subprocess, sys

PAUSE_MAX = 1.0       # 한 문장 앞이나 뒤에 더할 수 있는 쉼(초)


def norm(s): return re.sub(r"[^가-힣A-Za-z0-9]", "", s or "")


def sentence(work, p, text):
    """(문단의 문장 표, 그 문장 번호 j)."""
    rows = json.load(open(os.path.join(work, f"p{p:02d}_문장.json"), encoding="utf-8"))
    key = norm(text)
    j = next((r["j"] for r in rows if key and key in norm(r.get("text"))), None)
    if j is None: j = next((r["j"] for r in rows if norm(r.get("text")) and norm(r.get("text")) in key), None)
    if j is None: sys.exit(f"문단 {p}에서 문장을 찾지 못했어요: {text[:40]}")
    return rows, j


def take_files(work, p, j):
    """그 문장의 테이크들 [(번호, 파일 이름)] — 처음 만든 것과 「이 문장 다시」로 더 만든 것."""
    found = [(int(m.group(1)), n) for n in os.listdir(work) for m in [re.match(rf"p{p:02d}_s{j:02d}_(\d+)_t\.wav$", n)] if m]
    return sorted(found)


def current(rows, j):
    m = re.match(r"p\d+_s\d+_(\d+)_", rows[j].get("take", ""))
    return int(m.group(1)) if m else None


def rebuild(SV, work, p, rows):
    """문단 p를 문장 표의 테이크로 다시 잇고 음성 전체를 다시 만든다."""
    speech = [x for x in open(os.path.join(work, "speech.txt"), encoding="utf-8").read().replace("\r", "").split("\n") if x.strip() and not x.startswith("#SECTION")]
    # Loudness is matched again from each take's own file (_t), as make_paragraph did — a matched copy (_g) is not matched twice.
    picked = SV._match_loudness([os.path.join(work, r["take"].replace("_g.wav", "_t.wav")) for r in rows])
    for r, pth in zip(rows, picked): r["take"] = os.path.basename(pth)
    json.dump(rows, open(os.path.join(work, f"p{p:02d}_문장.json"), "w", encoding="utf-8"), ensure_ascii=False, indent=1)
    SV.join_paragraph(picked, SV.VT.prepare_text(speech[p]), work, f"p{p:02d}", [r.get("text", "") for r in rows])
    paras, subs = SV.clean_script(open(os.path.join(work, "speech.txt"), encoding="utf-8").read())
    parts = [os.path.join(work, f"p{k:02d}_t.wav") for k in range(len(speech))]
    voice, total = SV.assemble(work, parts, speech, subs)
    print(f"문단 {p} 다시 이음 · 음성 {total:.1f}초 — 받아쓰기 · 자막은 이 음성으로 다시")


def main():
    if len(sys.argv) < 5: sys.exit(__doc__)
    sys.path.insert(0, os.getcwd())
    import stage_voice as SV
    if not hasattr(SV, "join_paragraph"):
        print("이 영상의 음성 패키지는 테이크 바꾸기 · 쉼 더하기를 못 해요(2026-11-17 전 패키지)."); sys.exit(3)
    job, cmd, p, text = sys.argv[1], sys.argv[2], int(sys.argv[3]), sys.argv[4]
    work = os.path.join(SV.ROOT, "voice", job)
    rows, j = sentence(work, p, text)
    if cmd == "takes":
        out = os.path.abspath(sys.argv[5]); os.makedirs(out, exist_ok=True)
        now, listed = current(rows, j), []
        for k, name in take_files(work, p, j):
            file = f"p{p:02d}_s{j:02d}_{k}.mp3"
            subprocess.run([SV.FF, "-y", "-loglevel", "error", "-i", os.path.join(work, name), "-ac", "1", "-c:a", "libmp3lame", "-b:a", "64k", os.path.join(out, file)], check=True)
            listed.append({"name": name, "file": file, "current": k == now})
        json.dump({"p": p, "j": j, "text": rows[j].get("text", ""), "takes": listed}, open(os.path.join(out, "takes.json"), "w", encoding="utf-8"), ensure_ascii=False)
        print(f"테이크 {len(listed)}개: 문단 {p} 문장 {j}")
    elif cmd == "take":
        name = os.path.basename(sys.argv[5])
        if name not in dict((n, k) for k, n in take_files(work, p, j)): sys.exit(f"그 문장의 테이크가 아니에요: {name}")
        rows[j]["take"] = name
        rebuild(SV, work, p, rows)
        print(f"문장 {p}-{j}: {name}으로 바꿈")
    elif cmd == "pause":
        before, after = float(sys.argv[5]), float(sys.argv[6])
        f = os.path.join(work, "쉼더하기.json")
        add = json.load(open(f, encoding="utf-8")) if os.path.exists(f) else {}
        key = f"p{p:02d}_s{j:02d}"; was = add.get(key, {})
        add[key] = {"before": round(min(PAUSE_MAX, was.get("before", 0.0) + before), 2), "after": round(min(PAUSE_MAX, was.get("after", 0.0) + after), 2)}
        json.dump(add, open(f, "w", encoding="utf-8"), ensure_ascii=False, indent=1)
        rebuild(SV, work, p, rows)
        print(f"문장 {p}-{j}: 앞 쉼 +{add[key]['before']}초 · 뒤 쉼 +{add[key]['after']}초")
    else:
        sys.exit(__doc__)


if __name__ == "__main__":
    main()
