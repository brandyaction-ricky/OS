"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { apiRequest } from "@/lib/api-client";
import { SUPABASE_URL } from "@/lib/config";
import { editorScreenDoc } from "@/lib/editor-screen-doc";
import { md } from "./youtube-process-frame";

const ROUTE = "/api/v1/content/youtube-automation/editor";
const STORE = "editor-screen:";
type Lock = { name: string; pc: string; since: string } | null;
type Screen = { versions: unknown[]; lock: Lock };

/**
 * 편집 화면 이식 ② (2026-11-05, 대표 결정 「그대로 띄우기」): the editor screen made on a member's computer opens over the 제작 tab, in a
 * sandboxed frame. The frame asks this page for everything (public/editor-screen-shim.js); this page answers from the OS with the
 * viewer's own sign-in, only for the asks below. It opens once the editing computer has put a version's files up.
 */
export function EditorScreenEntry({ token, projectId, title, onFinal }: { token: string | null; projectId: string; title: string; onFinal: () => void }) {
  const [ready, setReady] = useState(false);
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (!token) return;
    let live = true;
    apiRequest<Screen>(`${ROUTE}?projectId=${projectId}&view=screen`, { token }).then(s => { if (live) setReady(s.versions.length > 0); }, () => undefined);
    return () => { live = false; };
  }, [token, projectId]);
  if (!ready || !token) return null;
  return <>
    <div className="yp-row-btns" style={{ marginTop: 10 }}>
      <button type="button" className="yp-btn" onClick={() => setOpen(true)}>편집 화면 열기</button>
      <span className="yp-muted" style={{ fontSize: 12 }}>손으로 자르고 옮긴 뒤 「완성」을 누르면 새 최종본이 돼요</span>
    </div>
    {open ? <EditorScreen token={token} projectId={projectId} title={title} onFinal={onFinal} onClose={() => setOpen(false)} /> : null}
  </>;
}

function EditorScreen({ token, projectId, title, onFinal, onClose }: { token: string; projectId: string; title: string; onFinal: () => void; onClose: () => void }) {
  const frame = useRef<HTMLIFrameElement>(null);
  const lock = useRef<Lock>(null);
  const [doc, setDoc] = useState<string | null>(null);
  const [made, setMade] = useState<{ by: string | null; at: string | null } | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let live = true;
    apiRequest<{ files: Record<string, string>; by: string | null; at: string | null }>(`${ROUTE}?projectId=${projectId}&view=screen_code`, { token }).then(code => {
      if (!live) return;
      const store: Record<string, string> = {};
      try { for (const key of Object.keys(localStorage)) if (key.startsWith(STORE)) store[key.slice(STORE.length)] = localStorage.getItem(key) ?? ""; } catch { /* the screen starts with its defaults */ }
      const page = editorScreenDoc(code.files, { origin: location.origin, storage: SUPABASE_URL, store });
      if (!page) setError("편집 화면 파일이 아직 OS에 없어요. 화면을 만든 분이 올리면 열려요.");
      else { setDoc(page); setMade({ by: code.by, at: code.at }); }
    }, reason => { if (live) setError(reason instanceof Error ? reason.message : "편집 화면을 열지 못했어요."); });
    return () => { live = false; };
  }, [token, projectId]);

  const answer = useCallback(async (op: string, body: Record<string, unknown>) => {
    const get = <T,>(query: string) => apiRequest<T>(`${ROUTE}?projectId=${projectId}&${query}`, { token });
    const post = <T,>(action: string, rest: Record<string, unknown>) => apiRequest<T>(ROUTE, { token, method: "POST", body: JSON.stringify({ action, projectId, ...rest }) });
    if (op === "state") { const s = await get<Screen>("view=screen"); lock.current = s.lock; return s; }
    if (op === "files") return get(`view=screen_files&version=${encodeURIComponent(String(body.version))}`);
    if (op === "edit") return { id: (await post<{ orderId: string }>("order", { text: String(body.text || "손 편집"), ...(body.version ? { version: body.version } : {}), manual: body.manual })).orderId };
    if (op === "cancel") return post("edit_cancel", { orderId: body.id });
    if (op === "save") return post("save", {});
    if (op === "base") return post("base", { version: body.version ?? null });
    if (op === "say") return { id: (await post<{ sayId: string }>("say", { sentences: [String(body.text ?? "")], takes: 3 })).sayId };
    if (op === "say_status") return post("say_status", { sayId: body.id });
    if (op === "image") {
      // A picture goes where the editing computer's own pictures go: only the person who opened the editor on it can put one.
      const file = body.file, pc = lock.current?.pc;
      if (!(file instanceof Blob)) throw new Error("사진 파일이 아니에요.");
      if (!pc) throw new Error("편집하는 컴퓨터에서 편집기를 열었을 때만 사진을 넣을 수 있어요.");
      const slot = await post<{ file: string; path: string; uploadUrl: string }>("image_upload", { pc, type: file.type });
      const put = await fetch(slot.uploadUrl, { method: "PUT", headers: { "content-type": file.type, "x-upsert": "true" }, body: file });
      if (!put.ok) throw new Error("사진을 올리지 못했어요.");
      return { file: (await post<{ file: string }>("image_saved", { pc, file: slot.file, path: slot.path })).file };
    }
    throw new Error("OS 편집 화면에서는 아직 못 쓰는 기능이에요.");
  }, [token, projectId]);

  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      const win = frame.current?.contentWindow, d = event.data;
      if (!win || event.source !== win || !d || d.os !== "editor" || typeof d.op !== "string") return;
      if (d.op === "store") {
        try { if (d.body?.value == null) localStorage.removeItem(STORE + d.body?.key); else localStorage.setItem(STORE + d.body.key, String(d.body.value).slice(0, 2000)); } catch { /* kept for this visit only */ }
        return;
      }
      if (d.op === "final") { onFinal(); return; }
      answer(d.op, d.body ?? {}).then(result => win.postMessage({ os: "editor", id: d.id, result }, "*"),
        reason => win.postMessage({ os: "editor", id: d.id, error: reason instanceof Error ? reason.message : "OS에 닿지 않아요.", status: (reason as { status?: number }).status ?? 500 }, "*"));
    };
    addEventListener("message", onMessage);
    return () => removeEventListener("message", onMessage);
  }, [answer, onFinal]);

  return <div className="yp-escreen" role="dialog" aria-modal="true" aria-label={`${title} 편집 화면`}>
    <div className="yp-escreen-bar">
      <b>{title}</b><span className="yp-muted">편집 화면{made?.at ? ` · ${md(made.at)}${made.by ? ` ${made.by}` : ""} 올림` : ""}</span>
      <button type="button" className="yp-btn yp-sm" onClick={onClose}>닫기</button>
    </div>
    {doc ? <iframe ref={frame} title={`${title} 편집 화면`} srcDoc={doc} sandbox="allow-scripts allow-modals" allow="fullscreen; clipboard-write" allowFullScreen />
      : <p className={error ? "yp-unsaved" : "yp-muted"} role={error ? "alert" : undefined} style={{ padding: 24 }}>{error || "편집 화면을 여는 중이에요."}</p>}
  </div>;
}
