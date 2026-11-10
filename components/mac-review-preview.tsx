"use client";

import { useEffect, useRef, useState } from "react";
import { useSession } from "./session-provider";

type Props = {
  projectId: string;
  variantId: string;
  runId: string;
  title: string;
  onReady: (ready: boolean) => void;
};

export function MacReviewPreview({ projectId, variantId, runId, title, onReady }: Props) {
  const { accessToken } = useSession();
  const report = useRef(onReady);
  useEffect(() => { report.current = onReady; }, [onReady]);
  const [url, setUrl] = useState("");
  const [issue, setIssue] = useState("");
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    let objectUrl = "";
    report.current(false);
    setUrl("");
    setIssue("");
    void (async () => {
      if (!accessToken) throw new Error("로그인 후 최종 출력물을 열 수 있어요.");
      const query = new URLSearchParams({ variantId, runId });
      const response = await fetch(`/api/v1/content/image-creatives/${encodeURIComponent(projectId)}/preview?${query}`, {
        headers: { authorization: "Bearer " + accessToken }, signal: controller.signal, cache: "no-store",
      });
      if (!response.ok) {
        const body = await response.json().catch(() => null);
        throw new Error(body?.error?.message || "Mac이 출력한 검수용 파일을 불러오지 못했어요.");
      }
      const blob = await response.blob();
      if (controller.signal.aborted) return;
      if (blob.type !== "image/png" || !blob.size) throw new Error("검수용 이미지가 비어 있어요.");
      objectUrl = URL.createObjectURL(blob);
      const image = new Image();
      image.src = objectUrl;
      await image.decode();
      if (controller.signal.aborted) return;
      setUrl(objectUrl);
    })().catch(error => {
      if (!controller.signal.aborted) setIssue(error instanceof Error ? error.message : "최종 출력물을 열지 못했어요.");
    });
    return () => {
      controller.abort();
      if (objectUrl) URL.revokeObjectURL(objectUrl);
      report.current(false);
    };
  }, [accessToken, projectId, variantId, runId, attempt]);

  if (!url) return <div role="status">{issue || "Mac이 출력한 검수용 파일을 여는 중입니다."}
    {issue && <button type="button" className="secondary-button" onClick={() => setAttempt(n => n + 1)}>다시 불러오기</button>}
  </div>;
  // eslint-disable-next-line @next/next/no-img-element -- this is the authenticated PNG, already decoded by the browser
  return <img className="ic-compare-photo" src={url} alt={title}
    onLoad={() => report.current(true)} onError={() => { report.current(false); setIssue("최종 출력물을 표시하지 못했어요."); setUrl(""); }} />;
}
