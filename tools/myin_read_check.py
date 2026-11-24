"""발음 확인 (대표 요청 2026-11-22): find the words the AI voice misread without listening to the whole voice.

Each paragraph sound (pNN_t.wav) is heard twice, by faster-whisper small and medium. A script word both models heard
differently is a real misreading ("저어 봐" read as "접어 봐"); one model alone is a transcription slip. Spelling that only
differs in notation (digits, Latin letters: 5 / 다섯, GPT / 지피티) is left out.

  python myin_read_check.py <voice dir> <out.json>
  python myin_read_check.py test

Writes [{"p": paragraph, "at": seconds in voice.wav, "said": script words, "small": heard, "medium": heard}].
Heard text is kept per paragraph sound (read_check_cache.json), so after a sentence fix only changed paragraphs are heard again.
The small model's words also go to the pause check's cache (pause_check_cache.json, [[start, end, word]]): it runs the same small
model with the same settings on the same sound, so it does not hear it a second time (2026-11-25).
"""
import hashlib, json, os, sys
from difflib import SequenceMatcher

MODELS = ("small", "medium")
LIMIT = 40


# Same sound, other spelling is not a misreading (first real run 11-22: 18 found, 13 of them 예요/에요, 끈기/끊기, 지안/지한 …;
# first longform 11-23: 25 found, most of them linking — 벌이기/버리기, 같이/가치, 일에서/이래서, 갉아/갈가, 눈앞의/눈앞에).
# Syllables are compared as they sound: ㅎ after a vowel or ㄴㄹㅁㅇ as silent, a coda moves onto a following ㅇ (ㄷㅌ+이 → 지치),
# 의 after a syllable as 에, codas by their 7 sounds, ㅐ·ㅒ·ㅖ as ㅔ, 구요 as 고요.
# ponytail: a few rules, not full Korean pronunciation (nasalisation, contractions like 되어/돼); add g2p if they flood the list.
CODA = {2: 1, 3: 1, 9: 1, 24: 1, 5: 4, 6: 4, 19: 7, 20: 7, 22: 7, 23: 7, 25: 7, 27: 7, 11: 8, 12: 8, 13: 8, 15: 8, 10: 16, 14: 17, 18: 17, 26: 17}
VOWEL = {1: 5, 3: 5, 7: 5}
# coda → (coda left behind, initial it becomes) when the next syllable starts with ㅇ
LINK = {1: (0, 0), 2: (0, 1), 3: (1, 10), 4: (0, 2), 5: (4, 12), 6: (0, 2), 7: (0, 3), 8: (0, 5), 9: (8, 0), 10: (8, 6), 11: (8, 7),
        12: (8, 10), 13: (8, 16), 14: (8, 17), 15: (0, 5), 16: (0, 6), 17: (0, 7), 18: (17, 10), 19: (0, 9), 20: (0, 10), 22: (0, 12),
        23: (0, 14), 24: (0, 15), 25: (0, 16), 26: (0, 17), 27: (0, 11)}


def sounds(text):
    syl = [[(ord(c) - 0xAC00) // 588, (ord(c) - 0xAC00) % 588 // 28, (ord(c) - 0xAC00) % 28] if "가" <= c <= "힣" else c for c in text]
    for k in range(1, len(syl)):
        a, b = syl[k - 1], syl[k]
        if not (isinstance(a, list) and isinstance(b, list)): continue
        if b[0] == 18 and a[2] in (0, 4, 8, 16, 21): b[0] = 11
        if b[0] == 11 and b[1] == 19 and not b[2]: b[1] = 5
        if b[0] == 11 and a[2] in LINK:
            a[2], b[0] = LINK[a[2]]
            if b[1] == 20 and b[0] in (3, 16): b[0] = 12 if b[0] == 3 else 14
    out = []
    for k, s in enumerate(syl):
        if not isinstance(s, list): out.append(s); continue
        first, mid, last = s[0], VOWEL.get(s[1], s[1]), CODA.get(s[2], s[2])
        if text[k] == "구" and text[k + 1:k + 2] == "요": first, mid = 0, 8
        out.append(chr(0xAC00 + first * 588 + mid * 28 + last))
    return "".join(out)


def chars(words):
    """[(text, start)] → [(sound, start, word index, letter)] for the letters and digits only."""
    letters = [(c, start, i) for i, (text, start) in enumerate(words) for c in text.lower() if c.isalnum()]
    heard = sounds("".join(c for c, _, _ in letters))
    return [(heard[k], start, i, c) for k, (c, start, i) in enumerate(letters)]


def spoken(script, w0, w1):
    """The script words w0..w1 without the punctuation around them."""
    return " ".join(script.split()[w0:w1 + 1]).strip(".,?!\"'“”‘’()…·")


def mapper(ops):
    """Script char positions → transcript char positions: (start of char i, end after char i-1)."""
    def start(i):
        for tag, i1, i2, j1, j2 in ops:
            if i1 <= i < i2: return j1 + (i - i1) if tag == "equal" else j1
        return ops[-1][4] if ops else 0
    def end(i):
        for tag, i1, i2, j1, j2 in ops:
            if i1 < i <= i2: return j1 + (i - i1) if tag == "equal" else j2
        return 0
    return start, end


def misread(script, heard):
    """Script words every model heard differently: [(first word, last word, {model: heard text}, start seconds)]."""
    s = chars([(w, 0.0) for w in script.split()])
    seen, bad = {}, None
    for model, words in heard.items():
        t = chars(words)
        ops = SequenceMatcher(None, [x[0] for x in s], [x[0] for x in t], autojunk=False).get_opcodes()
        wrong = {i for tag, i1, i2, _, _ in ops if tag in ("replace", "delete") for i in range(i1, i2)}
        bad = wrong if bad is None else bad & wrong
        seen[model] = (t, mapper(ops))
    runs = []   # neighbouring wrong words are one place ("다섯까지 셀게" heard as "다섯가지살게")
    for k in sorted({s[i][2] for i in bad or ()}):
        if runs and k == runs[-1][1] + 1: runs[-1][1] = k
        else: runs.append([k, k])
    found = []
    for w0, w1 in runs:
        c0 = next(i for i, x in enumerate(s) if x[2] == w0)
        c1 = max(i for i, x in enumerate(s) if x[2] == w1) + 1
        texts, start = {}, None
        for model, (t, (start_of, end_of)) in seen.items():
            j0, j1 = start_of(c0), end_of(c1)
            texts[model] = "".join(x[3] for x in t[j0:j1])
            if start is None and t: start = t[min(j0, len(t) - 1)][1]
        said = spoken(script, w0, w1)
        notation = lambda text: any(c.isdigit() or ("a" <= c.lower() <= "z") for c in text)
        if notation(said) or any(notation(x) for x in texts.values()): continue
        found.append((w0, w1, texts, start or 0.0))
    return found


def hear(models, wav, pause=None):
    """{model: [[word, start]]}; pause gets the small model's [[start, end, word]] as pause_check_myin.py keeps them."""
    out = {}
    for name, model in models.items():
        words = [w for seg in model.transcribe(wav, language="ko", beam_size=5, word_timestamps=True)[0] for w in (seg.words or [])]
        out[name] = [[w.word.strip(), round(w.start, 2)] for w in words]
        if name == "small" and pause is not None: pause.append([[round(w.start, 3), round(w.end, 3), w.word.strip()] for w in words])
    return out


def run(voice, dest):
    timings = json.load(open(os.path.join(voice, "timings.json"), encoding="utf-8"))
    cache_file = os.path.join(voice, "read_check_cache.json")
    try: cache = json.load(open(cache_file, encoding="utf-8"))
    except Exception: cache = {}
    models, rows, keep, for_pause = None, [], {}, {}
    for p in timings["paragraphs"]:
        wav = os.path.join(voice, f"p{p['i']:02d}_t.wav")
        if not os.path.exists(wav): continue
        key = hashlib.sha1(open(wav, "rb").read()).hexdigest()
        heard = cache.get(key)
        if heard is None:
            if models is None:
                from faster_whisper import WhisperModel
                models = {m: WhisperModel(m, device="cpu", compute_type="int8") for m in MODELS}
            small = []
            heard = hear(models, wav, small)
            if small: for_pause[key] = small[0]
        keep[key] = heard
        for w0, w1, texts, start in misread(p["text"], {m: heard[m] for m in MODELS}):
            rows.append({"p": p["i"], "at": round(p["start"] + start, 2), "said": spoken(p["text"], w0, w1), **texts})
    json.dump(keep, open(cache_file, "w", encoding="utf-8"), ensure_ascii=False)
    if for_pause:
        pause_file = os.path.join(voice, "pause_check_cache.json")
        try: pause = json.load(open(pause_file, encoding="utf-8"))
        except Exception: pause = {}
        json.dump({**for_pause, **pause}, open(pause_file, "w", encoding="utf-8"), ensure_ascii=False)
    json.dump(rows[:LIMIT], open(dest, "w", encoding="utf-8"), ensure_ascii=False, indent=1)
    print(f"발음 확인: {len(timings['paragraphs'])}문단 · 잘못 읽은 것 같은 곳 {len(rows)}곳")


def test():
    w = lambda text: [[x, i * 0.5] for i, x in enumerate(text.split())]
    found = misread("물을 저어 봐 천천히", {"small": w("물을 접어 봐 천천히"), "medium": w("물을 접어봐 천천히")})
    assert [(a, b, t["small"], t["medium"]) for a, b, t, _ in found] == [(1, 1, "접어", "접어")], found
    assert found[0][3] == 0.5
    assert misread("물을 저어 봐", {"small": w("물을 접어 봐"), "medium": w("물을 저어 봐")}) == [], "one model alone is a slip"
    assert misread("다섯까지 셀게", {"small": w("다섯 가지 살게"), "medium": w("다섯가지 살게")})[0][2]["small"] == "다섯가지살게"
    assert misread("GPT로 5분", {"small": w("지피티로 오분"), "medium": w("지피티로 오 분")}) == [], "notation differences are left out"
    assert misread("그대로예요", {"small": [], "medium": []})[0][2] == {"small": "", "medium": ""}, "nothing heard is a misreading"
    same = lambda said, heard: misread(said, {"small": w(heard), "medium": w(heard)}) == []
    assert same("차이예요 끈기가 굼떠요 맡는다면요 지안이 가지더라구요", "차이에요 끊기가 굶떠요 맞는다면요 지한이 가지더라고요"), "same sound, other spelling"
    assert same("벌이기 같이를 일에서 거리예요 갉아먹는 눈앞의", "버리기 가치를 이래서 걸이에요 갈가먹는 눈앞에"), "linking"
    assert not same("면담만", "년담만")
    assert not same("페스팅거는", "패스팅번은")
    print("ok")


if __name__ == "__main__":
    if sys.argv[1:] == ["test"]: test()
    elif len(sys.argv) == 3: run(sys.argv[1], sys.argv[2])
    else: sys.exit(__doc__)
