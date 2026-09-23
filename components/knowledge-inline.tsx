"use client";
import { useState } from "react";
import { markdownInlineTokens, safeMarkdownUrl } from "@/lib/knowledge-markdown";

function MarkdownImage({ src, alt }: { src: string; alt: string }) {
  const [failed, setFailed] = useState(false);
  const url = safeMarkdownUrl(src, true);
  if (!url || failed) return <span className="knowledge-image-missing" role="img" aria-label={`${alt || src} 이미지 없음`}><strong>이미지를 표시할 수 없습니다 · {alt || src}</strong><small>원본 파일 연결 또는 접근권한을 확인하고, 편집에서 사용 가능한 이미지 주소로 다시 연결해 주세요.</small><code>{src}</code>{url ? <a href={url} target="_blank" rel="noopener noreferrer">원본 열기</a> : null}</span>;
  // User-authored remote images keep their original access controls; never proxy with privileged credentials.
  // eslint-disable-next-line @next/next/no-img-element
  return <img className="knowledge-markdown-image" src={url} alt={alt} loading="lazy" referrerPolicy="no-referrer" onError={() => setFailed(true)} />;
}

export function WikiInline({ text, onOpenLink }: { text: string; onOpenLink: (title: string) => void }) {
  return <>{markdownInlineTokens(text).map((part, index) => {
    if (part.type === "code") return <code key={index}>{part.text}</code>;
    if (part.type === "bold") return <strong key={index}>{part.text}</strong>;
    if (part.type === "wiki") return <button key={index} className="wiki-link" type="button" onClick={() => onOpenLink(part.target!)}>{part.text}</button>;
    if (part.type === "image") return <MarkdownImage key={`${index}:${part.target}`} src={part.target!} alt={part.text} />;
    if (part.type === "link") {
      const href = safeMarkdownUrl(part.target!);
      if (href) return <a key={index} href={href} rel="noopener noreferrer">{part.text || href}</a>;
      if (/^(?![a-z]+:|\/\/)[^?#]+\.md(?:#.*)?$/i.test(part.target!)) return <button key={index} type="button" className="wiki-link" onClick={() => onOpenLink(part.target!)}>{part.text}</button>;
      return <span key={index} title="지원하지 않는 링크 주소">{part.text}</span>;
    }
    return <span key={index}>{part.text}</span>;
  })}</>;
}
