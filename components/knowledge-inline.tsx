"use client";
import { Download, FileText, Paperclip } from "lucide-react";
import { useEffect, useState } from "react";
import { getKnowledgeAttachmentUrl } from "@/lib/api-client";
import { parseKnowledgeAttachmentTarget, type KnowledgeAttachmentReference } from "@/lib/knowledge-attachments";
import { markdownInlineTokens, safeMarkdownUrl } from "@/lib/knowledge-markdown";
import { useSession } from "./session-provider";

function fileSize(value?: number) {
  if (!value) return "";
  if (value < 1024) return `${value}B`;
  if (value < 1024 * 1024) return `${Math.ceil(value / 1024)}KB`;
  return `${(value / 1024 / 1024).toFixed(value >= 10 * 1024 * 1024 ? 0 : 1)}MB`;
}

function KnowledgeAttachment({ reference }: { reference: KnowledgeAttachmentReference }) {
  const { accessToken } = useSession();
  const [url, setUrl] = useState("");
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let active = true;
    setUrl(""); setFailed(false);
    getKnowledgeAttachmentUrl(accessToken, reference.path)
      .then((result) => { if (active) setUrl(result.url); })
      .catch(() => { if (active) setFailed(true); });
    return () => { active = false; };
  }, [accessToken, reference.path]);

  if (reference.type.startsWith("image/")) {
    if (failed) return <span className="knowledge-image-missing" role="img" aria-label={`${reference.name} 이미지 없음`}><strong>이미지를 표시할 수 없습니다 · {reference.name}</strong><small>파일이 삭제됐거나 접근 권한이 없습니다.</small></span>;
    // Private attachment URLs are short-lived and resolved after authentication, so Next Image cannot optimize them ahead of time.
    // eslint-disable-next-line @next/next/no-img-element
    return url ? <img className="knowledge-markdown-image" src={url} alt={reference.name} loading="lazy" onError={() => setFailed(true)} /> : <span className="knowledge-attachment-loading">이미지 불러오는 중 · {reference.name}</span>;
  }

  if (reference.type.startsWith("video/")) {
    return <span className="knowledge-video-attachment"><span><Paperclip size={14} /><strong>{reference.name}</strong>{reference.size ? <small>{fileSize(reference.size)}</small> : null}</span>{failed ? <em>영상을 불러오지 못했습니다.</em> : url ? <video src={url} controls preload="metadata" /> : <em>영상 불러오는 중…</em>}</span>;
  }

  return <span className="knowledge-file-attachment"><FileText size={18} /><span><strong>{reference.name}</strong><small>{reference.size ? `${fileSize(reference.size)} · ` : ""}{reference.type}</small></span>{failed ? <em>파일을 열 수 없습니다.</em> : url ? <a href={url} target="_blank" rel="noopener noreferrer"><Download size={14} /> 열기</a> : <em>불러오는 중…</em>}</span>;
}

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
    if (part.type === "image") {
      const attachment = parseKnowledgeAttachmentTarget(part.target!);
      return attachment ? <KnowledgeAttachment key={`${index}:${part.target}`} reference={attachment} /> : <MarkdownImage key={`${index}:${part.target}`} src={part.target!} alt={part.text} />;
    }
    if (part.type === "link") {
      const attachment = parseKnowledgeAttachmentTarget(part.target!);
      if (attachment) return <KnowledgeAttachment key={`${index}:${part.target}`} reference={attachment} />;
      const href = safeMarkdownUrl(part.target!);
      if (href) return <a key={index} href={href} target={/^https?:\/\//i.test(href) ? "_blank" : undefined} rel="noopener noreferrer">{part.text || href}</a>;
      if (/^(?![a-z]+:|\/\/)[^?#]+\.md(?:#.*)?$/i.test(part.target!)) return <button key={index} type="button" className="wiki-link" onClick={() => onOpenLink(part.target!)}>{part.text}</button>;
      return <span key={index} title="지원하지 않는 링크 주소">{part.text}</span>;
    }
    return <span key={index}>{part.text}</span>;
  })}</>;
}
