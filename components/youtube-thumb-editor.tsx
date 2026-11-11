"use client";
import { useEffect, useRef, useState, type PointerEvent } from "react";
import { ImagePlus, Plus, RotateCcw, Undo2, X } from "lucide-react";
import { apiRequest } from "@/lib/api-client";
import type { YpSlot } from "@/lib/youtube-process/stages";
import type { ThumbSavedEdit } from "@/lib/youtube-process/thumb-edit";
import { ThumbFrame } from "@/lib/youtube-process/thumb-frame";
import { THUMB_EXTRA_COLORS, THUMB_STYLES, thumbLayout, type ThumbEdit, type ThumbExtraColor } from "@/lib/youtube-process/thumb-style";
import type { YpPage } from "./youtube-process-frame";
import { Scaled } from "./youtube-thumb-picker";

// 제작 「최종 썸네일」 다듬기 (썸네일 자동 제작 P2): the picked thumbnail opened in the same frame — 글자 · 사진 · 장치 — with drag,
// undo, a phone-size view and the frame's checks. 저장 renders the PNG with the same frame and puts it in the slot.
type Target = "photo" | string;
const style = THUMB_STYLES.anim;
const EDIT_KEYS = ["accentStyle", "size", "photo", "extras"] as const;
const editOf = (draft: ThumbSavedEdit): ThumbEdit => Object.fromEntries(EDIT_KEYS.filter((key) => draft[key] !== undefined).map((key) => [key, draft[key]]));
const newId = () => crypto.randomUUID().slice(0, 8);

export function ThumbEditor({ page, slot, start, onSave, onClose }: {
  page: YpPage; slot: YpSlot; start: ThumbSavedEdit;
  onSave: (value: { path: string; name: string; edit: ThumbSavedEdit }) => Promise<boolean>; onClose: () => void;
}) {
  const projectId = page.bundle?.project.id;
  const [draft, setDraft] = useState<ThumbSavedEdit>(start);
  const [history, setHistory] = useState<ThumbSavedEdit[]>([]);
  const [tab, setTab] = useState<"text" | "photo" | "extras">("text");
  const [target, setTarget] = useState<Target>("photo");
  const [candidateUrl, setCandidateUrl] = useState<string | null>(null);
  const [ownUrl, setOwnUrl] = useState<string | null>(null);
  const [newLine, setNewLine] = useState({ text: "", color: "accent" as ThumbExtraColor, size: 72 });
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const drag = useRef<{ x: number; y: number; from: ThumbSavedEdit; width: number } | null>(null);
  const panel = useRef<HTMLDivElement>(null);
  useEffect(() => { panel.current?.scrollIntoView({ behavior: "smooth", block: "nearest" }); }, []);
  useEffect(() => {
    if (!projectId || !page.accessToken || !draft.candidate) return;
    let live = true;
    apiRequest<{ candidates: { id: string; url: string | null }[] }>(`/api/v1/content/youtube/projects/${projectId}/thumbs`, { token: page.accessToken })
      .then((view) => { if (live) setCandidateUrl(view.candidates.find((c) => c.id === draft.candidate)?.url ?? null); }, () => undefined);
    return () => { live = false; };
  }, [projectId, page.accessToken, draft.candidate]);
  useEffect(() => {
    if (!projectId || !page.client || !draft.image) { setOwnUrl(null); return; }
    let live = true;
    page.client.assetUrl(projectId, draft.image).then((url) => { if (live) setOwnUrl(url); }, () => undefined);
    return () => { live = false; };
  }, [projectId, page.client, draft.image]);
  const image = draft.image ? ownUrl : candidateUrl;

  /** Every change goes through here, so 되돌리기 can take it back. */
  const change = (next: ThumbSavedEdit) => { setHistory((list) => [...list.slice(-40), draft]); setDraft(next); };
  const undo = () => { const last = history.at(-1); if (!last) return; setHistory(history.slice(0, -1)); setDraft(last); };
  const photo = draft.photo ?? { scale: 1, x: 0, y: 0, brightness: 1 };
  const checks = thumbLayout(draft.copy, style, editOf(draft)).checks;

  const onDown = (event: PointerEvent<HTMLDivElement>) => {
    event.currentTarget.setPointerCapture(event.pointerId);
    drag.current = { x: event.clientX, y: event.clientY, from: draft, width: event.currentTarget.getBoundingClientRect().width };
  };
  const onMove = (event: PointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (!d) return;
    const k = style.width / d.width, dx = Math.round((event.clientX - d.x) * k), dy = Math.round((event.clientY - d.y) * k);
    if (target === "photo") { const p = d.from.photo ?? { scale: 1, x: 0, y: 0, brightness: 1 }; setDraft({ ...d.from, photo: { ...p, x: p.x + dx, y: p.y + dy } }); }
    else setDraft({ ...d.from, extras: (d.from.extras ?? []).map((x) => x.id === target ? { ...x, x: x.x + dx, y: x.y + dy } : x) });
  };
  const onUp = () => { const d = drag.current; drag.current = null; if (d && d.from !== draft) setHistory((list) => [...list.slice(-40), d.from]); };

  const ownPhoto = async (file: File) => {
    if (!page.client || !projectId) return;
    setBusy("photo"); setError("");
    try { const saved = await page.client.uploadAsset(projectId, "plan_thumb", file); change({ ...draft, image: saved.path, photo: undefined }); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "사진을 올리지 못했어요."); } finally { setBusy(""); }
  };
  const save = async () => {
    if (!projectId || !page.accessToken) return;
    setBusy("save"); setError("");
    try {
      const made = await apiRequest<{ path: string; name: string }>(`/api/v1/content/youtube/projects/${projectId}/thumbs`, { method: "POST", token: page.accessToken,
        body: JSON.stringify({ ...(draft.image ? { image: draft.image } : { candidate: draft.candidate }), copy: { text: draft.copy.text, accent: draft.copy.accent ?? "" }, kind: "thumb", edit: editOf(draft) }) });
      if (await onSave({ ...made, edit: { ...draft, full: undefined } })) onClose();
    } catch (reason) { setError(reason instanceof Error ? reason.message : "저장하지 못했어요."); } finally { setBusy(""); }
  };

  const frame = <ThumbFrame style={style} image={image} copy={draft.copy} edit={editOf(draft)} />;
  return <div ref={panel} className="yp-card yp-te">
    <div className="yp-te-h"><span className={`yp-ltag${slot === "C" ? " yp-c" : ""}`}>{slot}</span><b>{slot} 썸네일 다듬기</b><span className="yp-sp" />
      <button type="button" className="yp-btn yp-sm" disabled={!history.length} onClick={undo}><Undo2 size={13} /> 되돌리기</button>
      <button type="button" className="yp-ib" aria-label="닫기" onClick={onClose}><X size={14} /></button></div>
    <div className="yp-te-body">
      <div className="yp-te-view">
        <div className="yp-te-stage" onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp}
          title={target === "photo" ? "끌면 사진이 움직여요" : "끌면 고른 문구가 움직여요"}><Scaled>{frame}</Scaled></div>
        <div className="yp-te-target" role="group" aria-label="끌어 옮길 것">끌어 옮기기:
          <button type="button" className={`yp-btn yp-sm${target === "photo" ? " yp-on" : ""}`} onClick={() => setTarget("photo")}>사진</button>
          {(draft.extras ?? []).map((x) => <button key={x.id} type="button" className={`yp-btn yp-sm${target === x.id ? " yp-on" : ""}`} onClick={() => setTarget(x.id)}>「{x.text}」</button>)}</div>
        <div className="yp-te-phone"><span className="yp-muted">휴대폰 피드 크기</span><div className="yp-tp-phonewrap"><Scaled>{frame}</Scaled></div></div>
      </div>
      <div className="yp-te-side">
        <div className="yp-seg2 yp-sm" role="tablist">{([["text", "글자"], ["photo", "사진"], ["extras", "장치"]] as const).map(([key, label]) =>
          <button key={key} type="button" role="tab" aria-selected={tab === key} className={tab === key ? "yp-on" : ""} onClick={() => setTab(key)}>{label}</button>)}</div>
        {tab === "text" ? <div className="yp-te-fields">
          <label className="yp-lbl">문구 <span className="yp-gq">두 줄까지 · 줄바꿈으로 나눠요</span>
            <textarea className="yp-in" rows={2} maxLength={40} value={draft.copy.text} onChange={(event) => change({ ...draft, copy: { ...draft.copy, text: event.target.value } })} /></label>
          <label className="yp-lbl">파랑 강조 <span className="yp-gq">문구 안의 말 그대로</span>
            <input className="yp-in" maxLength={20} value={draft.copy.accent ?? ""} onChange={(event) => change({ ...draft, copy: { ...draft.copy, accent: event.target.value } })} /></label>
          <label className="yp-lbl">강조 방식<select className="yp-in" value={draft.accentStyle ?? "color"} onChange={(event) => change({ ...draft, accentStyle: event.target.value as ThumbEdit["accentStyle"] })}>
            <option value="color">글자색</option><option value="marker">형광펜</option><option value="underline">밑줄</option></select></label>
          <label className="yp-lbl">크기 {draft.size ? `${draft.size}px` : "자동"}
            <input type="range" min={style.title.minPx} max={style.title.maxPx} value={draft.size ?? thumbLayout(draft.copy, style).size} onChange={(event) => change({ ...draft, size: Number(event.target.value) })} /></label>
          {draft.size ? <button type="button" className="yp-lnk" onClick={() => change({ ...draft, size: undefined })}>크기 자동으로</button> : null}
        </div> : null}
        {tab === "photo" ? <div className="yp-te-fields">
          <label className="yp-lbl">크기 {Math.round(photo.scale * 100)}%<input type="range" min={50} max={160} value={Math.round(photo.scale * 100)} onChange={(event) => change({ ...draft, photo: { ...photo, scale: Number(event.target.value) / 100 } })} /></label>
          <label className="yp-lbl">밝기 {Math.round(photo.brightness * 100)}%<input type="range" min={60} max={140} value={Math.round(photo.brightness * 100)} onChange={(event) => change({ ...draft, photo: { ...photo, brightness: Number(event.target.value) / 100 } })} /></label>
          <p className="yp-hint">위치는 미리보기에서 「사진」을 고르고 끌어서 옮겨요.</p>
          <div className="yp-row-btns"><button type="button" className="yp-btn yp-sm" onClick={() => change({ ...draft, photo: undefined })}><RotateCcw size={13} /> 처음 자리로</button>
            <label className="yp-btn yp-sm"><ImagePlus size={13} /> {busy === "photo" ? "올리는 중…" : "사진만 바꾸기"}<input type="file" hidden accept="image/jpeg,image/png" onChange={(event) => { const file = event.target.files?.[0]; event.target.value = ""; if (file) void ownPhoto(file); }} /></label>
            {draft.image && draft.candidate ? <button type="button" className="yp-btn yp-sm" onClick={() => change({ ...draft, image: undefined, photo: undefined })}>후보 그림으로</button> : null}</div>
        </div> : null}
        {tab === "extras" ? <div className="yp-te-fields">
          {(draft.extras ?? []).map((x) => <div key={x.id} className="yp-te-extra"><span>「{x.text}」 · {THUMB_EXTRA_COLORS[x.color]} · {x.size}px</span>
            <button type="button" className="yp-ib" aria-label={`「${x.text}」 지우기`} onClick={() => { change({ ...draft, extras: (draft.extras ?? []).filter((row) => row.id !== x.id) }); if (target === x.id) setTarget("photo"); }}><X size={13} /></button></div>)}
          {(draft.extras?.length ?? 0) < 4 ? <>
            <label className="yp-lbl">문구 추가<input className="yp-in" maxLength={20} value={newLine.text} placeholder="예) 직장인 70%" onChange={(event) => setNewLine({ ...newLine, text: event.target.value })} /></label>
            <div className="yp-row-btns"><select className="yp-in yp-sel1" aria-label="색" value={newLine.color} onChange={(event) => setNewLine({ ...newLine, color: event.target.value as ThumbExtraColor })}>
              {(Object.keys(THUMB_EXTRA_COLORS) as ThumbExtraColor[]).map((key) => <option key={key} value={key}>{THUMB_EXTRA_COLORS[key]}</option>)}</select>
              <label className="yp-lbl">크기 {newLine.size}px<input type="range" min={36} max={140} value={newLine.size} onChange={(event) => setNewLine({ ...newLine, size: Number(event.target.value) })} /></label>
              <button type="button" className="yp-btn yp-sm" disabled={!newLine.text.trim()} onClick={() => { const id = newId(); change({ ...draft, extras: [...(draft.extras ?? []), { id, text: newLine.text.trim(), color: newLine.color, size: newLine.size, x: 80, y: 60 }] }); setTarget(id); setNewLine({ ...newLine, text: "" }); }}><Plus size={13} /> 더하기</button></div>
            <p className="yp-hint">더한 문구는 미리보기에서 그 문구를 고르고 끌어서 옮겨요.</p></> : <p className="yp-hint">문구는 4개까지 더해요.</p>}
        </div> : null}
        <ul className="yp-te-checks">{checks.map((check) => <li key={check.id} className={check.ok ? "yp-good" : "yp-bad"}>{check.ok ? "✓" : "!"} {check.text}</li>)}</ul>
        <div className="yp-row-btns"><button type="button" className="yp-btn yp-pri" disabled={Boolean(busy) || !image || checks.some((c) => !c.ok) || !draft.copy.text.trim()} onClick={() => void save()}>{busy === "save" ? "저장 중…" : "저장"}</button>
          <button type="button" className="yp-btn" onClick={onClose}>닫기</button></div>
        {error ? <p className="yp-err" role="alert">{error}</p> : null}
      </div>
    </div>
  </div>;
}
