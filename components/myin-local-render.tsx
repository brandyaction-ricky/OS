"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { Check, Copy, KeyRound, LoaderCircle } from "lucide-react";
import { apiRequest } from "@/lib/api-client";
import { localBlocker, type LocalRenderStatus } from "@/lib/myin-local";
export { localBlocker } from "@/lib/myin-local";

// 내 컴퓨터로 시안 (owner decision 2026-10-27): ③'s drafts can be made on the member's own Mac with the render PC's engine.
// This file is the place picker, the member's computer status and the one-time connection; the panel only places them.
export type DraftPlace = "pc" | "local";

/** This member's own Mac, read once a minute while a screen that can use it is open. */
export function useLocalRender(token: string | null, enabled: boolean) {
  const [status, setStatus] = useState<LocalRenderStatus | null>(null);
  const load = useCallback(async () => {
    if (!token) return;
    try { setStatus((await apiRequest<{ local: LocalRenderStatus }>("/api/v1/content/youtube-automation/myin?local=1", { token })).local); }
    catch { setStatus(null); }
  }, [token]);
  useEffect(() => {
    if (!enabled) return;
    void load();
    const timer = window.setInterval(() => void load(), 60_000);
    return () => window.clearInterval(timer);
  }, [enabled, load]);
  return { status, reload: load };
}

/** 시안을 만들 곳: 렌더 PC (default) or this member's own Mac, with a one-line state for the latter. */
export function DraftPlacePicker({ value, onChange, status, token, onConnected }: { value: DraftPlace; onChange: (place: DraftPlace) => void;
  status: LocalRenderStatus | null; token: string | null; onConnected: () => void }) {
  const blocker = localBlocker(status);
  const [connect, setConnect] = useState(false);
  useEffect(() => { if (blocker && value === "local") onChange("pc"); }, [blocker, value, onChange]);
  return <div style={{ display: "grid", gap: 6 }}>
    <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 8 }}>
      <span>시안을 만들 곳</span>
      <div className="segmented" role="group" aria-label="시안을 만들 곳">
        <button type="button" aria-pressed={value === "pc"} onClick={() => onChange("pc")}>렌더 PC</button>
        <button type="button" aria-pressed={value === "local"} disabled={Boolean(blocker)} title={blocker ?? undefined} onClick={() => onChange("local")}>내 컴퓨터</button>
      </div>
      <small>{value === "local" ? "내 맥에서 바로 만들어요 · 렌더 PC를 기다리지 않아요" : blocker ? `내 컴퓨터: ${blocker}` : "내 컴퓨터도 쓸 수 있어요 · 켜짐 · 엔진 같음"}</small>
      {status?.state !== "online" ? <button type="button" className="secondary-button compact" onClick={() => setConnect(!connect)}>{connect ? "닫기" : "내 컴퓨터 연결"}</button> : null}
    </div>
    {connect ? <LocalConnect token={token} onDone={onConnected} /> : null}
  </div>;
}

/** The one-time setup: a 「내 컴퓨터 렌더」 key (shown once) inside the start command, after the engine bundle is unpacked. */
function LocalConnect({ token, onDone }: { token: string | null; onDone: () => void }) {
  const [command, setCommand] = useState("");
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState("");
  const field = useRef<HTMLTextAreaElement>(null);
  const issue = async () => {
    setBusy(true); setError(""); setCopied(false);
    try {
      const { key } = await apiRequest<{ key: string }>("/api/v1/agent-keys/self", { method: "POST", token, body: JSON.stringify({ tool: "render" }) });
      setCommand(`~/myin-local/start.sh ${key}`);
      onDone();
    } catch (reason) { setError(reason instanceof Error ? reason.message : "연결 키를 만들지 못했어요."); }
    finally { setBusy(false); }
  };
  // Some app browsers refuse the clipboard API; selecting the field and the older copy command still works there.
  const copy = async () => {
    try { await navigator.clipboard.writeText(command); setCopied(true); return; } catch { /* fall back below */ }
    field.current?.select();
    if (document.execCommand("copy")) setCopied(true); else setError("자동 복사가 막혔어요. 칸이 선택되어 있으니 ⌘C로 복사해 주세요.");
  };
  return <div className="yt-note" style={{ display: "grid", gap: 8 }}>
    <strong>내 컴퓨터 연결 · 처음 한 번만</strong>
    <ol style={{ margin: 0, paddingLeft: 20, display: "grid", gap: 4 }}>
      <li>렌더 PC와 같은 엔진 묶음을 받아 설치해요. <a href="/knowledge/search?q=%EB%82%B4%20%EC%BB%B4%ED%93%A8%ED%84%B0%EB%A1%9C%20%EC%8B%9C%EC%95%88%20%EB%A7%8C%EB%93%A4%EA%B8%B0" target="_blank" rel="noreferrer">설치 안내 열기</a></li>
      <li>아래에서 시작 명령을 만들어 터미널에 붙여 넣어요. 창을 열어 두면 1분 안에 「켜짐」으로 바뀌어요.</li>
    </ol>
    {!command ? <div className="yt-actions"><button type="button" className="primary-button" disabled={busy} onClick={() => void issue()}>{busy ? <LoaderCircle size={14} className="spin" /> : <KeyRound size={14} />}시작 명령 만들기</button>
      <small>내 이름으로 연결 키(90일)를 만들어요. 다시 누르면 이전 키는 끊겨요.</small></div>
      : <div style={{ display: "grid", gap: 8 }}>
        <textarea ref={field} readOnly rows={2} aria-label="시작 명령" value={command} onFocus={(event) => event.currentTarget.select()}
          style={{ padding: 8, resize: "none", border: "1px solid var(--line)", borderRadius: 7, background: "var(--panel-2)", color: "inherit", font: "11px ui-monospace,SFMono-Regular,Menlo,monospace", wordBreak: "break-all" }} />
        <div className="yt-actions"><button type="button" className="secondary-button" onClick={() => void copy()}>{copied ? <Check size={14} /> : <Copy size={14} />}{copied ? "복사됨" : "명령 복사"}</button>
          <small>지금 한 번만 보여요. 키가 들어 있으니 단톡방 · 문서 · AI 대화창에 붙이지 마세요.</small></div>
      </div>}
    {error ? <p className="inline-alert" role="alert">{error}</p> : null}
  </div>;
}
