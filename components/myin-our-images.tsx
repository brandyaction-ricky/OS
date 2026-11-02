"use client";

import { useRef, useState } from "react";
import { apiRequest } from "@/lib/api-client";

type Photo = { file: string; from: "ours" | "list" | "none"; by: string | null; scenes?: number[] };
const API = "/api/v1/content/youtube-automation/myin";

/**
 * 우리 이미지 올리기 (2026-10-28 대표 · 로건) · 문제 장면의 그림 바꾸기 (유쓰 요청 2/8, 2026-11-02): our own image for a photo file the
 * storyboard uses, listed by the scenes that show it. Scene lengths and the voice stay; after the finished video the run goes back to ④
 * to prepare with it, and that video stays a version until a new one is made.
 */
export function MyinOurImages({ runId, token, onSaved, onScene }: { runId: string; token: string | null; onSaved: () => void; onScene?: (scene: number) => void }) {
  const [state, setState] = useState<{ open: boolean; finished?: boolean; photos: Photo[] } | null>(null);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const picker = useRef<HTMLInputElement>(null);
  const target = useRef("");

  const load = async () => {
    try { setState(await apiRequest<{ open: boolean; finished?: boolean; photos: Photo[] }>(`${API}?photos=${runId}`, { token })); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "사진 목록을 열지 못했어요."); }
  };
  const upload = async (image: File) => {
    const file = target.current;
    setBusy(file); setError("");
    try {
      const patch = <T,>(body: Record<string, unknown>) => apiRequest<T>(API, { method: "PATCH", token, body: JSON.stringify({ runId, file, ...body }) });
      const { uploadUrl, path } = await patch<{ uploadUrl: string; path: string }>({ action: "our_image_url", type: image.type });
      const response = await fetch(uploadUrl, { method: "PUT", headers: { "content-type": image.type, "x-upsert": "true" }, body: image });
      if (!response.ok) throw new Error("이미지를 올리지 못했어요. 다시 해 주세요.");
      await patch({ action: "our_image", path });
      await load();
      onSaved();
    } catch (reason) { setError(reason instanceof Error ? reason.message : "이미지를 올리지 못했어요."); }
    finally { setBusy(""); }
  };
  const pick = (photo: Photo) => {
    if (state?.finished && !window.confirm("4단계로 돌아가 이 그림으로 자료를 다시 준비해요. 지금 완성본은 예전 버전으로 남고, 새 완성본은 [전체 영상 만들기]로 만들어요. 바꿀까요?")) return;
    target.current = photo.file; picker.current?.click();
  };
  const scenes = (photo: Photo) => photo.scenes?.length ? photo.scenes : [0];
  const rows = state ? state.photos.flatMap((photo) => scenes(photo).map((scene) => ({ scene, photo }))).sort((a, b) => a.scene - b.scene) : [];

  return <details className="yt-details" onToggle={(event) => { if ((event.target as HTMLDetailsElement).open && !state) void load(); }}>
    <summary>장면 그림 바꾸기 (우리 이미지)</summary>
    <p className="yt-note">장면에 들어간 사진을 우리가 가진 이미지(워크북 캡처, 직접 받은 인물 사진 등)로 바꿔 넣어요. 직접 찍었거나 쓸 권리를 받은 이미지만 올려 주세요. 장면 길이와 목소리는 그대로예요. 길이나 말을 바꾸려면 구성안 원고를 고쳐 음성부터 다시 만들어요.</p>
    {state ? <ul className="yt-list">{rows.map(({ scene, photo }) => <li key={`${scene}-${photo.file}`}>
      {scene ? `${scene}번 장면 · ` : ""}{photo.file} · {photo.from === "ours" ? `우리 이미지 (${photo.by} 올림)` : photo.from === "list" ? "사진 후보" : "받을 곳 없음"}{" "}
      {state.open ? <button type="button" className="secondary-button compact" disabled={Boolean(busy)} onClick={() => pick(photo)}>
        {busy === photo.file ? "올리는 중…" : photo.from === "ours" ? "바꾸기" : "이미지 올리기"}</button> : null}
      {scene && onScene ? <button type="button" className="secondary-button compact" onClick={() => onScene(scene)}>점검 시트 보기</button> : null}
    </li>)}</ul> : <p>불러오는 중…</p>}
    {state && !state.open ? <small>전체 영상을 만드는 중이에요. 끝난 뒤에 바꿀 수 있어요.</small> : null}
    {state?.finished ? <small>완성 영상이 있어요. 바꾸면 4단계에서 자료를 다시 준비한 뒤 새 완성본을 만들고, 지금 완성본은 예전 버전으로 남아요.</small> : null}
    <input ref={picker} type="file" accept="image/jpeg,image/png,image/webp" hidden onChange={(event) => {
      const image = event.target.files?.[0];
      event.target.value = "";
      if (image) void upload(image);
    }} />
    {error ? <p className="inline-alert danger" role="alert">{error}</p> : null}
  </details>;
}
