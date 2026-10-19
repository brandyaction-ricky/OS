"use client";

import { Check, Copy, KeyRound, LoaderCircle } from "lucide-react";
import { useRef, useState } from "react";
import { apiRequest } from "@/lib/api-client";
import { useSession } from "./session-provider";

type Tool = "claude" | "codex";
const STEPS: Record<Tool, string[]> = {
  claude: [
    "Claude 앱(또는 claude.ai)에서 설정 › 커넥터로 갑니다.",
    "‘사용자 지정 커넥터 추가’를 누르고 이름은 브랜디 OS, 주소 칸에 복사한 주소를 붙여 넣습니다. 인증은 ‘로그인 없음’을 고르고, 나머지는 그대로 둔 채 추가합니다.",
    "도구 권한은 읽기 전용 도구 전부와 ‘Process youtube ai job’만 항상 허용, ‘Delete document’·‘Delete record’는 차단, 나머지 쓰기 도구는 손 모양(매번 확인)으로 둡니다.",
    "새 대화에서 ‘브랜디 OS로 원고 공정 정본 찾아줘’라고 해 보고, 문서가 나오면 연결된 것입니다.",
  ],
  codex: [
    "Codex 앱에서 플러그인 › 오른쪽 위 추가 › ‘사용자 지정 MCP 서버 추가’를 누릅니다.",
    "이름은 브랜디 OS, 유형은 오른쪽의 ‘스트리밍 가능한 HTTP’를 누릅니다(STDIO 아님). 바뀐 칸 중 URL에 복사한 주소를 붙여 넣고, 토큰·헤더 칸은 비워 둔 채 저장합니다.",
    "새 대화에서 브랜디 OS 도구로 ‘원고 공정 정본’을 찾아 보고, 문서가 나오면 연결된 것입니다.",
  ],
};

/** [내 AI 연결]: issue my own AI key (app/api/v1/agent-keys/self) and show the one address to paste into my AI's connector settings. */
export function MyAiConnect() {
  const { accessToken } = useSession();
  const [tool, setTool] = useState<Tool>("claude");
  const [address, setAddress] = useState("");
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState("");
  const issue = async () => {
    setBusy(true); setError(""); setCopied(false);
    try { setAddress((await apiRequest<{ connectorUrl: string }>("/api/v1/agent-keys/self", { method: "POST", token: accessToken, body: JSON.stringify({ tool }) })).connectorUrl); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "연결 주소를 만들지 못했습니다."); }
    finally { setBusy(false); }
  };
  const field = useRef<HTMLTextAreaElement>(null);
  // Some app browsers refuse the clipboard API; selecting the field and the older copy command still works there.
  const copy = async () => {
    setError("");
    try { await navigator.clipboard.writeText(address); setCopied(true); return; } catch { /* fall back below */ }
    field.current?.select();
    if (document.execCommand("copy")) setCopied(true);
    else setError("자동 복사가 막혔습니다. 주소 칸이 선택되어 있으니 ⌘C(윈도우는 Ctrl+C)로 복사해 주세요.");
  };

  return <div style={{ display: "grid", gap: 10 }}>
    {!address ? <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 8 }}>
      <select aria-label="연결할 AI" value={tool} onChange={(event) => setTool(event.target.value as Tool)} style={{ minHeight: 34 }}>
        <option value="claude">Claude</option><option value="codex">ChatGPT · Codex</option>
      </select>
      <button type="button" className="primary-button" disabled={busy} onClick={() => void issue()}>{busy ? <LoaderCircle size={14} className="spin" /> : <KeyRound size={14} />}내 AI 연결 주소 만들기</button>
      <small>내 이름으로 초안 쓰기 키(90일)를 만듭니다. 같은 AI로 다시 누르면 이전 주소는 끊깁니다.</small>
    </div> : <div style={{ display: "grid", gap: 8 }}>
      <strong>연결 주소 · 지금 한 번만 보입니다</strong>
      <textarea ref={field} readOnly rows={3} aria-label="연결 주소" value={address} onFocus={(event) => event.currentTarget.select()}
        style={{ padding: 8, resize: "none", border: "1px solid var(--line)", borderRadius: 7, background: "var(--panel-2)", color: "inherit", font: "11px ui-monospace,SFMono-Regular,Menlo,monospace", wordBreak: "break-all" }} />
      <div style={{ display: "flex", gap: 6 }}>
        <button type="button" className="secondary-button" onClick={() => void copy()}>{copied ? <Check size={14} /> : <Copy size={14} />}{copied ? "복사됨" : "주소 복사"}</button>
        <button type="button" className="secondary-button" onClick={() => setAddress("")}>닫기</button>
      </div>
      <ol style={{ margin: 0, paddingLeft: 20, display: "grid", gap: 4 }}>{STEPS[tool].map((step) => <li key={step}>{step}</li>)}</ol>
      <small>이 주소는 비밀번호와 같습니다. 단톡방·문서·AI 대화창에 붙이지 마세요. 잃어버렸으면 다시 만들면 됩니다.</small>
    </div>}
    {error ? <p className="inline-alert danger" role="alert">{error}</p> : null}
  </div>;
}
