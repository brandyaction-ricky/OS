"use client";
/* eslint-disable @next/next/no-img-element */

import { Download, Grid3X3, ImageOff, List, RotateCcw, Save, SlidersHorizontal, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { listKnowledgeAssets } from "@/lib/api-client";
import type { KnowledgeAsset } from "@/lib/knowledge-assets";
import type { KnowledgeDocument } from "@/lib/types";
import { statusLabel } from "./dashboard";

type Layout = "gallery" | "table";
type Property = "folder" | "tags" | "status" | "owner" | "updated";
type ViewState = { name: string; layout: Layout; query: string; tag: string; owner: string; status: string; sort: string; cardSize: string; properties: Property[] };
const DEFAULT_PROPERTIES: Property[] = ["folder", "tags", "status", "updated"];
const STORAGE_KEY = "brandy-knowledge-gallery-views-v1";

function shortDate(value: string) {
  return new Intl.DateTimeFormat("ko-KR", { year: "2-digit", month: "short", day: "numeric" }).format(new Date(value));
}

export function KnowledgeGallery({ documents, folder, token, ownerNames, revision, onOpen, onRestore }: {
  documents: KnowledgeDocument[];
  folder: string;
  token: string | null;
  ownerNames: Map<string, string>;
  revision: number;
  onOpen: (id: string) => void;
  onRestore: () => void;
}) {
  const [layout, setLayout] = useState<Layout>("gallery");
  const [query, setQuery] = useState("");
  const [tag, setTag] = useState("");
  const [owner, setOwner] = useState("");
  const [status, setStatus] = useState("");
  const [sort, setSort] = useState("updated_desc");
  const [cardSize, setCardSize] = useState("medium");
  const [properties, setProperties] = useState<Property[]>(DEFAULT_PROPERTIES);
  const [assets, setAssets] = useState<KnowledgeAsset[]>([]);
  const [loading, setLoading] = useState(false);
  const [preview, setPreview] = useState<KnowledgeAsset | null>(null);
  const [savedViews, setSavedViews] = useState<ViewState[]>([]);
  const [viewName, setViewName] = useState("");

  useEffect(() => {
    try { setSavedViews(JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "[]")); } catch { setSavedViews([]); }
  }, []);
  useEffect(() => {
    if (!documents.length) { setAssets([]); return; }
    let active = true;
    setLoading(true);
    Promise.all(Array.from({ length: Math.ceil(documents.length / 100) }, (_, index) => listKnowledgeAssets(token, {
      documentIds: documents.slice(index * 100, index * 100 + 100).map((document) => document.id), covers: true,
    }))).then((pages) => { if (active) setAssets(pages.flatMap((page) => page.assets)); })
      .catch(() => { if (active) setAssets([]); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [documents, revision, token]);

  const covers = useMemo(() => {
    const map = new Map<string, KnowledgeAsset>();
    for (const asset of assets) if (!map.has(asset.documentId) && asset.url) map.set(asset.documentId, asset);
    return map;
  }, [assets]);
  const tags = useMemo(() => [...new Set(documents.flatMap((document) => document.tags))].sort((a, b) => a.localeCompare(b, "ko")), [documents]);
  const owners = useMemo(() => [...new Set(documents.map((document) => document.owner_id))], [documents]);
  const visible = useMemo(() => documents.filter((document) => {
    const haystack = `${document.title} ${document.folder} ${document.tags.join(" ")} ${document.content_md}`.toLocaleLowerCase("ko-KR");
    return (!query || haystack.includes(query.toLocaleLowerCase("ko-KR"))) && (!tag || document.tags.includes(tag)) && (!owner || document.owner_id === owner) && (!status || document.status === status);
  }).sort((a, b) => {
    if (sort === "title_asc") return a.title.localeCompare(b.title, "ko", { numeric: true });
    if (sort === "title_desc") return b.title.localeCompare(a.title, "ko", { numeric: true });
    if (sort === "updated_asc") return a.updated_at.localeCompare(b.updated_at);
    return b.updated_at.localeCompare(a.updated_at);
  }), [documents, owner, query, sort, status, tag]);

  const toggleProperty = (property: Property) => setProperties((current) => current.includes(property) ? current.filter((item) => item !== property) : [...current, property]);
  const saveView = () => {
    const name = viewName.trim();
    if (!name) return;
    const next = [...savedViews.filter((view) => view.name !== name), { name, layout, query, tag, owner, status, sort, cardSize, properties }];
    setSavedViews(next); localStorage.setItem(STORAGE_KEY, JSON.stringify(next)); setViewName("");
  };
  const applyView = (view: ViewState) => {
    setLayout(view.layout); setQuery(view.query); setTag(view.tag); setOwner(view.owner); setStatus(view.status); setSort(view.sort); setCardSize(view.cardSize); setProperties(view.properties);
  };
  const reset = () => { setQuery(""); setTag(""); setOwner(""); setStatus(""); setSort("updated_desc"); setCardSize("medium"); setProperties(DEFAULT_PROPERTIES); };

  return <div className="knowledge-gallery">
    <header className="knowledge-gallery-header"><div><span>이미지 갤러리</span><h2>{folder || "현재 불러온 문서"}</h2><p>{visible.length}개 문서 · {assets.length}개 연결 이미지{loading ? " · 대표 이미지 확인 중…" : ""}</p></div><button className="secondary-button" type="button" onClick={onRestore}>원본 이미지 복원</button></header>
    <div className="knowledge-gallery-toolbar">
      <div className="knowledge-gallery-layout"><button type="button" className={layout === "gallery" ? "active" : ""} onClick={() => setLayout("gallery")}><Grid3X3 size={14} /> 갤러리</button><button type="button" className={layout === "table" ? "active" : ""} onClick={() => setLayout("table")}><List size={14} /> 표</button></div>
      <input aria-label="갤러리 문서 검색" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="제목·폴더·태그 검색" />
      <select aria-label="태그 필터" value={tag} onChange={(event) => setTag(event.target.value)}><option value="">모든 태그</option>{tags.map((item) => <option key={item}>{item}</option>)}</select>
      <select aria-label="소유자 필터" value={owner} onChange={(event) => setOwner(event.target.value)}><option value="">모든 소유자</option>{owners.map((id) => <option key={id} value={id}>{ownerNames.get(id) || "소유자 미지정"}</option>)}</select>
      <select aria-label="상태 필터" value={status} onChange={(event) => setStatus(event.target.value)}><option value="">모든 상태</option>{["draft", "team", "review", "reviewed", "canonical"].map((item) => <option key={item} value={item}>{statusLabel(item as KnowledgeDocument["status"])}</option>)}</select>
      <select aria-label="갤러리 정렬" value={sort} onChange={(event) => setSort(event.target.value)}><option value="updated_desc">최근 수정 순</option><option value="updated_asc">오래된 순</option><option value="title_asc">제목 가나다 순</option><option value="title_desc">제목 역순</option></select>
      {layout === "gallery" ? <select aria-label="카드 크기" value={cardSize} onChange={(event) => setCardSize(event.target.value)}><option value="small">작게</option><option value="medium">보통</option><option value="large">크게</option></select> : null}
      <details className="knowledge-gallery-properties"><summary><SlidersHorizontal size={14} /> 카드 속성</summary><div>{(["folder", "tags", "status", "owner", "updated"] as Property[]).map((property) => <label key={property}><input type="checkbox" checked={properties.includes(property)} onChange={() => toggleProperty(property)} />{{ folder: "폴더", tags: "태그", status: "상태", owner: "소유자", updated: "수정일" }[property]}</label>)}</div></details>
      <button type="button" className="ghost-button" onClick={reset}><RotateCcw size={13} /> 초기화</button>
    </div>
    <div className="knowledge-saved-views"><input aria-label="보기 이름" value={viewName} onChange={(event) => setViewName(event.target.value)} placeholder="현재 보기 이름" /><button type="button" disabled={!viewName.trim()} onClick={saveView}><Save size={13} /> 보기 저장</button>{savedViews.map((view) => <button type="button" key={view.name} onClick={() => applyView(view)}>{view.name}</button>)}</div>
    {layout === "gallery" ? <div className={`knowledge-gallery-grid size-${cardSize}`}>{visible.map((document) => {
      const cover = covers.get(document.id);
      return <article key={document.id} className="knowledge-gallery-card"><button type="button" className="knowledge-gallery-cover" onClick={() => cover ? setPreview(cover) : onOpen(document.id)}>{cover ? <img src={cover.url} alt={`${document.title} 대표 이미지`} loading="lazy" /> : <span><ImageOff size={24} /> 대표 이미지 없음</span>}</button><button type="button" className="knowledge-gallery-copy" onClick={() => onOpen(document.id)}><strong>{document.title}</strong>{properties.includes("folder") ? <small>{document.folder || "분류 없음"}</small> : null}{properties.includes("tags") && document.tags.length ? <span>{document.tags.slice(0, 4).map((item) => <em key={item}>#{item}</em>)}</span> : null}<span>{properties.includes("status") ? <i>{statusLabel(document.status)}</i> : null}{properties.includes("owner") ? <i>{ownerNames.get(document.owner_id) || "소유자 미지정"}</i> : null}{properties.includes("updated") ? <time>{shortDate(document.updated_at)}</time> : null}</span></button></article>;
    })}</div> : <div className="knowledge-gallery-table"><table><thead><tr><th>문서</th>{properties.includes("folder") ? <th>폴더</th> : null}{properties.includes("tags") ? <th>태그</th> : null}{properties.includes("status") ? <th>상태</th> : null}{properties.includes("owner") ? <th>소유자</th> : null}{properties.includes("updated") ? <th>수정일</th> : null}</tr></thead><tbody>{visible.map((document) => <tr key={document.id} onClick={() => onOpen(document.id)}><td><strong>{document.title}</strong></td>{properties.includes("folder") ? <td>{document.folder || "분류 없음"}</td> : null}{properties.includes("tags") ? <td>{document.tags.join(", ")}</td> : null}{properties.includes("status") ? <td>{statusLabel(document.status)}</td> : null}{properties.includes("owner") ? <td>{ownerNames.get(document.owner_id) || "소유자 미지정"}</td> : null}{properties.includes("updated") ? <td>{shortDate(document.updated_at)}</td> : null}</tr>)}</tbody></table></div>}
    {!visible.length ? <p className="quiet-state">조건에 맞는 문서가 없습니다.</p> : null}
    {preview ? <div className="knowledge-image-lightbox" role="dialog" aria-modal="true" aria-label={`${preview.fileName} 크게 보기`} onClick={() => setPreview(null)}><button type="button" aria-label="닫기" onClick={() => setPreview(null)}><X size={20} /></button><img src={preview.url} alt={preview.fileName} onClick={(event) => event.stopPropagation()} /><a href={preview.url} download={preview.fileName} onClick={(event) => event.stopPropagation()}><Download size={14} /> 원본 내려받기</a></div> : null}
  </div>;
}
