"use client";

import { useRef, useState } from "react";
import { apiRequest } from "@/lib/api-client";

type Photo = { file: string; from: "ours" | "list" | "none"; by: string | null };
const API = "/api/v1/content/youtube-automation/myin";

/** 우리 이미지 올리기 (2026-10-28 대표 · 로건): our own image for a photo file the storyboard uses, in place of a stock photo or a 사진 자리. */
export function MyinOurImages({ runId, token, onSaved }: { runId: string; token: string | null; onSaved: () => void }) {
  const [state, setState] = useState<{ open: boolean; photos: Photo[] } | null>(null);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const picker = useRef<HTMLInputElement>(null);
  const target = useRef("");

  const load = async () => {
    try { setState(await apiRequest<{ open: boolean; photos: Photo[] }>(`${API}?photos=${runId}`, { token })); }
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

  return <details className="yt-details" onToggle={(event) => { if ((event.target as HTMLDetailsElement).open && !state) void load(); }}>
    <summary>우리 이미지 올리기</summary>
    <p className="yt-note">기획표의 사진을 우리가 가진 이미지(워크북 캡처, 직접 받은 인물 사진 등)로 바꿔 넣어요. 직접 찍었거나 쓸 권리를 받은 이미지만 올려 주세요. 4단계에서는 「받을 곳 없음」 사진을 모두 올리면 자료 준비를 바로 다시 해요.</p>
    {state ? <ul className="yt-list">{state.photos.map((photo) => <li key={photo.file}>
      {photo.file} · {photo.from === "ours" ? `우리 이미지 (${photo.by} 올림)` : photo.from === "list" ? "사진 후보" : "받을 곳 없음"}{" "}
      {state.open ? <button type="button" className="secondary-button compact" disabled={Boolean(busy)} onClick={() => { target.current = photo.file; picker.current?.click(); }}>
        {busy === photo.file ? "올리는 중…" : photo.from === "ours" ? "바꾸기" : "이미지 올리기"}</button> : null}
    </li>)}</ul> : <p>불러오는 중…</p>}
    {state && !state.open ? <small>전체 영상을 만드는 중이거나 나온 뒤에는 올릴 수 없어요. 4단계로 돌아가면 올릴 수 있어요.</small> : null}
    <input ref={picker} type="file" accept="image/jpeg,image/png,image/webp" hidden onChange={(event) => {
      const image = event.target.files?.[0];
      event.target.value = "";
      if (image) void upload(image);
    }} />
    {error ? <p className="inline-alert danger" role="alert">{error}</p> : null}
  </details>;
}
