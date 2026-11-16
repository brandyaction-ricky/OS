import Link from "next/link";
import { useState } from "react";

export function ImageSubscriptionHelp({ jobId, needsImage = false }: { jobId?: string; needsImage?: boolean }) {
  const [copyResult, setCopyResult] = useState<{ id: string; copied: boolean }>();
  const request = jobId && !needsImage
    ? `Brandy OS MCP에서 내 이미지 광고 작업 ${jobId}을 찾아 수령하고, 요청된 결과를 같은 작업에 제출해 줘.`
    : undefined;
  async function copyRequest() {
    if (!request || !jobId) return;
    try {
      await navigator.clipboard.writeText(request);
      setCopyResult({ id: jobId, copied: true });
    } catch {
      setCopyResult({ id: jobId, copied: false });
    }
  }
  return <>
    {request && <div className="ic-row">
      <button type="button" className="secondary-button" onClick={copyRequest}>
        {copyResult?.id === jobId && copyResult?.copied ? "실행 문구 복사됨" : "이 작업 실행 문구 복사"}
      </button>
      <span className="ic-muted">OS에 연결한 Codex나 Claude 채팅에 붙여넣으세요.</span>
      {copyResult && copyResult.id === jobId && !copyResult.copied && <pre><code>{request}</code></pre>}
    </div>}
    <details className="ic-details">
      <summary>AI 연결 확인</summary>
      <Link href="/settings/access">내 AI 연결 설정</Link>
      {!needsImage && <>
        <p>자동으로 받으려면 구독 AI를 연결한 Mac에서 수신기를 실행해 두세요.</p>
        <a href="/myin-local/image-ad-subscription.mjs" download>자동 수신 실행 파일 받기</a>
        <p>Codex 구독</p><pre><code>node ~/Downloads/image-ad-subscription.mjs --codex</code></pre>
        <p>Claude Code 구독</p><pre><code>node ~/Downloads/image-ad-subscription.mjs</code></pre>
      </>}
    </details>
  </>;
}
