"use client";
/* eslint-disable @next/next/no-img-element */
import { Download, ExternalLink, FileText, Paperclip, RefreshCw, X } from "lucide-react";
import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { getKnowledgeAttachmentUrl, listKnowledgeAssets } from "@/lib/api-client";
import { parseKnowledgeAttachmentTarget, type KnowledgeAttachmentReference } from "@/lib/knowledge-attachments";
import { markdownInlineTokens, safeMarkdownUrl } from "@/lib/knowledge-markdown";
import { useSession } from "./session-provider";

type WikiResolver = (target:string)=>{label:string;href?:string};
const KnowledgeInlineContext = createContext<{ documentId: string; revision: number; onRelink?: (reference: string) => void; resolveWiki?:WikiResolver }>({ documentId: "", revision: 0 });

export function KnowledgeInlineProvider({ documentId, revision, onRelink, resolveWiki, children }: { documentId: string; revision: number; onRelink?: (reference: string) => void; resolveWiki?:WikiResolver; children: ReactNode }) {
  return <KnowledgeInlineContext.Provider value={{ documentId, revision, onRelink, resolveWiki }}>{children}</KnowledgeInlineContext.Provider>;
}

function fileSize(value?: number) {
  if (!value) return "";
  if (value < 1024) return `${value}B`;
  if (value < 1024 * 1024) return `${Math.ceil(value / 1024)}KB`;
  return `${(value / 1024 / 1024).toFixed(value >= 10 * 1024 * 1024 ? 0 : 1)}MB`;
}

function KnowledgeImageFrame({ url, alt, remote = false }: { url: string; alt: string; remote?: boolean }) {
  const [preview, setPreview] = useState(false);
  return <span className="knowledge-image-frame">
    <button type="button" className="knowledge-image-open" onClick={() => setPreview(true)} aria-label={`${alt} 크게 보기`}>
      {/* Private attachment URLs are short-lived and resolved after authentication, so Next Image cannot optimize them ahead of time. */}
      <img className="knowledge-markdown-image" src={url} alt={alt} loading="lazy" referrerPolicy={remote ? "no-referrer" : undefined} />
    </button>
    <span className="knowledge-image-actions"><button type="button" onClick={() => setPreview(true)}><ExternalLink size={13} /> 크게 보기</button><a href={url} download={alt}><Download size={13} /> 내려받기</a></span>
    {preview ? <span className="knowledge-image-lightbox" role="dialog" aria-modal="true" aria-label={`${alt} 크게 보기`} onClick={() => setPreview(false)}><button type="button" aria-label="닫기" onClick={() => setPreview(false)}><X size={20} /></button><img src={url} alt={alt} onClick={(event) => event.stopPropagation()} /></span> : null}
  </span>;
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
    return url ? <KnowledgeImageFrame url={url} alt={reference.name} /> : <span className="knowledge-attachment-loading">이미지 불러오는 중 · {reference.name}</span>;
  }

  if (reference.type.startsWith("video/")) {
    return <span className="knowledge-video-attachment"><span><Paperclip size={14} /><strong>{reference.name}</strong>{reference.size ? <small>{fileSize(reference.size)}</small> : null}</span>{failed ? <em>영상을 불러오지 못했습니다.</em> : url ? <video src={url} controls preload="metadata" /> : <em>영상 불러오는 중…</em>}</span>;
  }

  return <span className="knowledge-file-attachment"><FileText size={18} /><span><strong>{reference.name}</strong><small>{reference.size ? `${fileSize(reference.size)} · ` : ""}{reference.type}</small></span>{failed ? <em>파일을 열 수 없습니다.</em> : url ? <a href={url} target="_blank" rel="noopener noreferrer"><Download size={14} /> 열기</a> : <em>불러오는 중…</em>}</span>;
}

function MissingImage({ label, reference, onRelink }: { label: string; reference: string; onRelink?: (reference: string) => void }) {
  return <span className="knowledge-image-missing" role="img" aria-label={`${label} 이미지 없음`}><strong>이미지 파일을 연결해 주세요 · {label}</strong><small>원문은 그대로 보존됩니다. 같은 파일을 연결하면 이 자리와 갤러리에 바로 표시됩니다.</small><code>{reference}</code>{onRelink ? <button type="button" className="secondary-button compact" onClick={() => onRelink(reference)}><RefreshCw size={13} /> 다시 연결</button> : null}</span>;
}

function LocalKnowledgeImage({ src, alt }: { src: string; alt: string }) {
  const { accessToken } = useSession();
  const { documentId, revision, onRelink } = useContext(KnowledgeInlineContext);
  const [state, setState] = useState<"loading" | "missing" | "ready">("loading");
  const [url, setUrl] = useState("");
  useEffect(() => {
    if (!documentId) { setState("missing"); return; }
    let active = true;
    setState("loading"); setUrl("");
    listKnowledgeAssets(accessToken, { documentIds: [documentId], reference: src })
      .then((result) => { if (!active) return; const asset = result.assets[0]; setUrl(asset?.url ?? ""); setState(asset?.url ? "ready" : "missing"); })
      .catch(() => { if (active) setState("missing"); });
    return () => { active = false; };
  }, [accessToken, documentId, revision, src]);
  if (state === "loading") return <span className="knowledge-attachment-loading">이미지 연결 확인 중 · {alt || src}</span>;
  if (state === "missing") return <MissingImage label={alt || src} reference={src} onRelink={documentId ? onRelink : undefined} />;
  return <KnowledgeImageFrame url={url} alt={alt || src} />;
}

function MarkdownImage({ src, alt }: { src: string; alt: string }) {
  const [failed, setFailed] = useState(false);
  const url = safeMarkdownUrl(src, true);
  if (!url) return <LocalKnowledgeImage src={src} alt={alt} />;
  if (failed) return <MissingImage label={alt || src} reference={src} />;
  // User-authored remote images keep their original access controls; never proxy with privileged credentials.
  return <span onError={() => setFailed(true)}><KnowledgeImageFrame url={url} alt={alt} remote /></span>;
}

export function WikiInline({ text, onOpenLink }: { text: string; onOpenLink: (title: string) => void }) {
  const {resolveWiki}=useContext(KnowledgeInlineContext);
  return <>{markdownInlineTokens(text).map((part, index) => {
    if (part.type === "code") return <code key={index}>{part.text}</code>;
    if (part.type === "bold") return <strong key={index}>{part.text}</strong>;
    if (part.type === "wiki") {
      if(resolveWiki){const resolved=resolveWiki(part.target!);return resolved.href?<a key={index} className="wiki-link" href={resolved.href}>{resolved.label}</a>:<span key={index} className="kw-muted-link">{resolved.label}</span>;}
      return <button key={index} className="wiki-link" type="button" onClick={() => onOpenLink(part.target!)}>{part.text}</button>;
    }
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
