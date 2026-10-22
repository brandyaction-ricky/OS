# 렌더 PC 도식 목록(대표 결정 2026-10-22: 도식을 더할 때마다 OS 코드를 고치지 않는다).
# 운영 렌더와 같은 폴더(<마이인 패키지>/tools/myin_pipeline)에서 같은 순서로 엔진을 불러와, 지금 그릴 수 있는 lib_ 도식을 JSON 한 줄로 낸다.
# 워커가 이 출력을 OS(/api/v1/content/youtube-automation/catalog)에 보낸다. 엔진에 도식 창고가 없으면 items는 비어 있다.
# MYIN_DIAGRAM_LOADER(모듈 이름)가 있으면 운영 렌더가 켜는 것과 같은 모듈을 먼저 불러온다.
import importlib
import json
import os
import sys

sys.path.insert(0, os.getcwd())  # 렌더 스크립트처럼 엔진 폴더의 모듈을 찾는다


def cueify(o):
    """견본의 시각(t, t_…)을 기획표 형식(cue, cue_…)으로 바꾼다 — 로건님 resolve()가 cue 문구를 시각으로 바꾼다."""
    if isinstance(o, list):
        return [cueify(v) for v in o]
    if isinstance(o, dict):
        out = {}
        for k, v in o.items():
            if k.startswith("_") or k == "t0":
                continue
            if (k == "t" or k.startswith("t_")) and isinstance(v, (int, float)):
                out["cue" + k[1:]] = "(대본 문구)"
            else:
                out[k] = cueify(v)
        return out
    return o


def catalog():
    out = {"engine": "python", "package": (os.environ.get("MYIN_PACKAGE_NAME") or os.path.basename(os.environ.get("MYIN_PKG", "")))[:120], "items": []}
    try:
        if os.environ.get("MYIN_DIAGRAM_LOADER"):
            importlib.import_module(os.environ["MYIN_DIAGRAM_LOADER"])
        import myin_engine  # noqa: F401  운영 렌더와 같은 순서: myin_svg가 도식 창고(myin_library)를 등록한다
        import myin_svg  # noqa: F401
        import myin_library as L
    except Exception:
        return out
    demo, ai = {}, {}
    try:
        import myin_library_demo as D
        demo = {k: v[1] for k, v in D.DEMO.items()}
    except Exception:
        pass
    try:  # 무대형·한 문장용: 연결 모듈이 실제로 등록한 것만(이름이 같은 로건님 도식은 로건님 것)
        import myin_library_ai as AI
        from myin_dia import base as B
        ai = {k: B.REG[k] for k in AI.FUN}
    except Exception:
        pass
    for key, num, name, when, _intent, slots, _sfx in L.REGISTRY:
        if key not in L.FUNCS:
            continue
        if key in ai:
            meta = ai[key]
            kind, when, example = ("stage" if meta["family"] == "무대" else "single"), meta["when"], meta["sample"]
        else:
            n = int(num) if str(num).isdigit() else 0
            kind, example = ("info" if 1 <= n <= 40 else "poster"), demo.get(key)
        item = {"type": "lib_" + key, "name": str(name)[:80], "kind": kind, "when": str(when)[:400], "slots": str(slots)[:400]}
        if isinstance(example, dict):
            item["example"] = {"type": "lib_" + key, "theme": "myin", **cueify(example)}
        out["items"].append(item)
    return out


if __name__ == "__main__":
    assert cueify({"t0": 0, "beats": [{"t": 1.2, "do": "add"}], "t_pick": 2, "_lines": []}) == {"beats": [{"cue": "(대본 문구)", "do": "add"}], "cue_pick": "(대본 문구)"}
    print(json.dumps(catalog(), ensure_ascii=False))
