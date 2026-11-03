"use client";

import { useEffect, useRef, useState } from "react";
import { apiRequest } from "@/lib/api-client";

type Photo = { file: string; from: "ours" | "list" | "none"; by: string | null; credit?: string | null; scenes?: number[] };
type Candidate = { provider: "unsplash" | "wikimedia"; id: string; thumb: string; author: string; authorPage: string | null; page: string; license: string; check: boolean };
const API = "/api/v1/content/youtube-automation/myin";
/** 「phone_wait.jpg」 → 「phone wait」: the words the photo file was named with start the search. */
const wordsOf = (file: string) => file.replace(/\.[a-z0-9]+$/i, "").replace(/^ours_/, "").replace(/_s\d+(_\d+)?$/, "").replace(/[_\-\d]+/g, " ").trim();

/**
 * 우리 이미지 올리기 (2026-10-28 대표 · 로건) · 문제 장면의 그림 바꾸기 (유쓰 요청 2/8, 2026-11-02): our own image for a photo file the
 * storyboard uses, listed by the scenes that show it. Scene lengths and the voice stay; after the finished video the run goes back to ④
 * to prepare with it, and that video stays a version until a new one is made.
 * 2026-11-03 보완: 사진 후보 찾기 (Unsplash · 위키미디어, looking changes nothing; [사용하기] replaces) and, for a photo several scenes
 * share, 「이 장면만」 (the default) or all of them — never all of them silently.
 */
export function MyinOurImages({ runId, token, onSaved, onScene, open = false }: { runId: string; token: string | null; onSaved: () => void; onScene?: (scene: number) => void;
  /** Opened with its list when ④ stopped for an ours_ photo nobody uploaded yet. */ open?: boolean }) {
  const [state, setState] = useState<{ open: boolean; finished?: boolean; photos: Photo[] } | null>(null);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [allScenes, setAllScenes] = useState<Record<string, boolean>>({});
  const [finding, setFinding] = useState<{ row: string; photo: Photo; scene: number; query: string; results: Candidate[] | null; missing: string[] } | null>(null);
  const picker = useRef<HTMLInputElement>(null);
  const target = useRef<{ photo: Photo; scene: number } | null>(null);

  const load = async () => {
    try { setState(await apiRequest<{ open: boolean; finished?: boolean; photos: Photo[] }>(`${API}?photos=${runId}`, { token })); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "사진 목록을 열지 못했어요."); }
  };
  const patch = <T,>(body: Record<string, unknown>) => apiRequest<T>(API, { method: "PATCH", token, body: JSON.stringify({ runId, ...body }) });
  const shared = (photo: Photo) => (photo.scenes?.length ?? 0) > 1;
  /** The file to change: this scene's own copy first when the photo is shared and only this scene is to change. */
  const fileFor = async (photo: Photo, scene: number) => shared(photo) && scene && !allScenes[photo.file]
    ? (await patch<{ file: string }>({ action: "photo_scene", file: photo.file, scene })).file : photo.file;
  const confirmed = () => !state?.finished || window.confirm("4단계로 돌아가 이 그림으로 자료를 다시 준비해요. 지금 완성본은 예전 버전으로 남고, 새 완성본은 [전체 영상 만들기]로 만들어요. 바꿀까요?");
  const run = async (key: string, work: () => Promise<unknown>) => {
    setBusy(key); setError("");
    try { await work(); await load(); onSaved(); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "바꾸지 못했어요."); }
    finally { setBusy(""); }
  };
  const upload = (image: File) => {
    const picked = target.current;
    if (!picked) return;
    void run(picked.photo.file, async () => {
      const file = await fileFor(picked.photo, picked.scene);
      const { uploadUrl, path } = await patch<{ uploadUrl: string; path: string }>({ action: "our_image_url", file, type: image.type });
      const response = await fetch(uploadUrl, { method: "PUT", headers: { "content-type": image.type, "x-upsert": "true" }, body: image });
      if (!response.ok) throw new Error("이미지를 올리지 못했어요. 다시 해 주세요.");
      await patch({ action: "our_image", file, path });
    });
  };
  const pick = (photo: Photo, scene: number) => {
    if (!confirmed()) return;
    target.current = { photo, scene }; picker.current?.click();
  };
  const search = async (query: string) => {
    if (!finding) return;
    setFinding({ ...finding, query, results: null });
    try {
      const found = await apiRequest<{ candidates: Candidate[]; missing: string[] }>(`${API}?candidates=${encodeURIComponent(query)}`, { token });
      setFinding((now) => now && { ...now, results: found.candidates, missing: found.missing });
    } catch (reason) { setError(reason instanceof Error ? reason.message : "후보를 찾지 못했어요."); setFinding((now) => now && { ...now, results: [] }); }
  };
  const use = (candidate: Candidate) => {
    if (!finding || !confirmed()) return;
    const { photo, scene } = finding;
    void run(photo.file, async () => {
      const file = await fileFor(photo, scene);
      await patch({ action: "photo_candidate", file, provider: candidate.provider, id: candidate.id });
      setFinding(null);
    });
  };
  // eslint-disable-next-line react-hooks/exhaustive-deps -- opened once, when the stop names photos to upload
  useEffect(() => { if (open) void load(); }, [open]);
  const scenes = (photo: Photo) => photo.scenes?.length ? photo.scenes : [0];
  const rows = state ? state.photos.flatMap((photo) => scenes(photo).map((scene) => ({ scene, photo }))).sort((a, b) => a.scene - b.scene) : [];
  const from = (photo: Photo) => photo.from === "ours" ? photo.credit ? `후보 사진 (${photo.credit} · ${photo.by} 고름)` : `우리 이미지 (${photo.by} 올림)` : photo.from === "list" ? "사진 후보" : "받을 곳 없음";

  return <details className="yt-details" open={open || undefined} onToggle={(event) => { if ((event.target as HTMLDetailsElement).open && !state) void load(); }}>
    <summary>장면 그림 바꾸기 (우리 이미지 · 사진 후보)</summary>
    <p className="yt-note">장면에 들어간 사진을 우리가 가진 이미지(워크북 캡처, 직접 받은 인물 사진 등)나 Unsplash · 위키미디어 사진 후보로 바꿔 넣어요. 올리는 이미지는 직접 찍었거나 쓸 권리를 받은 것만 올려 주세요. 후보는 찾아보기만 해서는 아무것도 바뀌지 않고, [사용하기]를 눌러야 바뀌어요. 장면 길이와 목소리는 그대로예요. 길이나 말을 바꾸려면 구성안 원고를 고쳐 음성부터 다시 만들어요.</p>
    {state ? <ul className="yt-list">{rows.map(({ scene, photo }) => { const row = `${scene}-${photo.file}`; return <li key={row}>
      {scene ? `${scene}번 장면 · ` : ""}{photo.file} · {from(photo)}{" "}
      {state.open ? <>
        <button type="button" className="secondary-button compact" disabled={Boolean(busy)} onClick={() => pick(photo, scene)}>
          {busy === photo.file ? "바꾸는 중…" : photo.from === "ours" ? "이미지로 바꾸기" : "이미지 올리기"}</button>
        <button type="button" className="secondary-button compact" disabled={Boolean(busy)}
          onClick={() => setFinding(finding?.row === row ? null : { row, photo, scene, query: wordsOf(photo.file), results: null, missing: [] })}>{finding?.row === row ? "후보 닫기" : "후보 찾기"}</button>
      </> : null}
      {scene && onScene ? <button type="button" className="secondary-button compact" onClick={() => onScene(scene)}>점검 시트 보기</button> : null}
      {shared(photo) && scene && state.open ? <><br /><small>{photo.scenes!.join(" · ")}번 장면이 이 사진을 함께 써요 · </small>
        <label><input type="checkbox" checked={Boolean(allScenes[photo.file])} onChange={(event) => setAllScenes({ ...allScenes, [photo.file]: event.target.checked })} /> 함께 쓰는 장면 모두 바꾸기</label>
        <small>{allScenes[photo.file] ? "" : ` (안 고르면 ${scene}번 장면만 바뀌어요)`}</small></> : null}
      {finding?.row === row ? <div className="yt-note yt-find">
        <form onSubmit={(event) => { event.preventDefault(); void search(finding.query); }}>
          <input value={finding.query} onChange={(event) => setFinding({ ...finding, query: event.target.value })} aria-label="찾을 말" placeholder="예) phone desk, library" />
          <button type="submit" className="secondary-button compact" disabled={!finding.query.trim()}>찾기</button>
        </form>
        <small>영어로 적으면 더 잘 찾아요. 찾기는 무료예요.{finding.missing.length ? ` · 이번에 못 본 곳: ${finding.missing.join(", ")}` : ""}</small>
        {finding.results === null ? null : finding.results.length ? <div className="yt-candidates">{finding.results.map((candidate) => <figure key={`${candidate.provider}:${candidate.id}`}>
          {/* eslint-disable-next-line @next/next/no-img-element -- the source's own address, as its API terms ask (hotlinking) */}
          <img src={candidate.thumb} alt={`${candidate.author} 사진`} loading="lazy" />
          <figcaption>
            {candidate.authorPage ? <a href={candidate.authorPage} target="_blank" rel="noreferrer">{candidate.author}</a> : candidate.author}
            {" · "}<a href={candidate.page} target="_blank" rel="noreferrer">{candidate.provider === "unsplash" ? "Unsplash" : "위키미디어"}</a>
            <br /><small>{candidate.license}{candidate.check ? " · 사용 조건 확인 필요" : ""}</small>
            <button type="button" className="secondary-button compact" disabled={Boolean(busy)} onClick={() => use(candidate)}>{busy === photo.file ? "바꾸는 중…" : "사용하기"}</button>
          </figcaption></figure>)}</div> : <small>맞는 후보가 없어요. 다른 말로 찾아 주세요.</small>}
      </div> : null}
    </li>; })}</ul> : <p>불러오는 중…</p>}
    {state && !state.open ? <small>전체 영상을 만드는 중이에요. 끝난 뒤에 바꿀 수 있어요.</small> : null}
    {state?.finished ? <small>완성 영상이 있어요. 바꾸면 4단계에서 자료를 다시 준비한 뒤 새 완성본을 만들고, 지금 완성본은 예전 버전으로 남아요.</small> : null}
    <input ref={picker} type="file" accept="image/jpeg,image/png,image/webp" hidden onChange={(event) => {
      const image = event.target.files?.[0];
      event.target.value = "";
      if (image) upload(image);
    }} />
    {error ? <p className="inline-alert danger" role="alert">{error}</p> : null}
  </details>;
}
