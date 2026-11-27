"use client";

import { useState } from "react";
import { isWarehouseFormat, type ImageFormatId } from "@/lib/image-creative/formats";
import { warehouseDocumentUrl } from "@/lib/image-creative/reference-canon";
import { useImageReferenceCatalog } from "./use-image-reference-catalog";

type Props = { selected?: readonly ImageFormatId[]; onSelect?: (id: ImageFormatId) => void; local?: boolean };
export function ImageFormatLibrary({ selected = [], onSelect, local = false }: Props) {
  const {catalog, error, offline, refresh} = useImageReferenceCatalog(local);
  const entries = catalog?.entries ?? [];
  const groups = [...new Set(entries.map(format => format.group))];
  const [query, setQuery] = useState("");
  const [group, setGroup] = useState("");
  const [recommended, setRecommended] = useState(true);
  const [limit, setLimit] = useState(8);
  const wanted = query.toLocaleLowerCase().trim();
  const formats = entries.filter(format =>
    (!recommended || isWarehouseFormat(format.id)) &&
    (!group || format.group === group) &&
    (!wanted || [format.id, format.name, format.keep, format.slots].join(" ").toLocaleLowerCase().includes(wanted))
  );

  return <section className="panel panel-pad-lg ic-panel ic-format-library" aria-labelledby="image-library-title">
    <div className="ic-section-heading"><div><h2 id="image-library-title">포맷 창고</h2>
      <p className="ic-muted">마음에 드는 디자인을 펼쳐 구성과 바꿀 요소를 확인하세요.</p></div>
      {offline && <span className="ic-status-badge">오프라인 체험용 예시</span>}
    </div>
    {error && <p role="alert">{error} <button type="button" className="secondary-button" onClick={() => void refresh().catch(() => {})}>다시 읽기</button></p>}
    {!catalog && !error && <p role="status">OS 포맷 창고를 읽고 있어요.</p>}
    <div className="ic-library-filters">
      <label className="ic-field">찾을 포맷
        <input className="field" value={query} placeholder="말풍선, 비교, 검색창…"
          onChange={event => { setQuery(event.target.value); setLimit(8); }} />
      </label>
      <label className="ic-field">분류
        <select className="field" value={group} onChange={event => { setGroup(event.target.value); setLimit(8); }}>
          <option value="">전체 분류</option>
          {groups.map(name => <option key={name} value={name}>{name}</option>)}
        </select>
      </label>
    </div>
    <div className="ic-library-filter-meta">
      <label className="ic-check"><input type="checkbox" checked={recommended}
        onChange={event => { setRecommended(event.target.checked); setLimit(8); }} /> 바로 제작할 수 있는 창고 포맷만 보기</label>
      {catalog && <span role="status" className="ic-library-count">{formats.length}개 포맷</span>}
    </div>
    <div className="ic-library-grid">{formats.slice(0, limit).map(format => {
      return <details key={format.id} className="ic-library-card" data-selected={selected.includes(format.id as ImageFormatId) || undefined}>
        <summary aria-label={format.name}><span className="ic-library-preview">
        {format.archivedThumbnail
          // eslint-disable-next-line @next/next/no-img-element -- original picture saved in the approved chapter
          ? <img className="ic-format-library-sample" src={format.archivedThumbnail} alt={format.name + " 원 광고"} loading="lazy"/>
          : isWarehouseFormat(format.id) &&
          // eslint-disable-next-line @next/next/no-img-element -- packaged public format example
          <img className="ic-format-library-sample" src={'/image-format-test/examples/' + format.id + '-portrait.webp'}
            width={216} height={270} alt={format.name + " 광고 구성 예시"} loading="lazy"/>}
          {!format.archivedThumbnail && !isWarehouseFormat(format.id) && <span className="ic-library-no-preview">{format.group}<small>구성 설명 보기</small></span>}
        </span><span className="ic-library-caption"><span className="ic-library-category">{format.group}</span><strong>{format.name}</strong>
          <span className="ic-library-card-action">{selected.includes(format.id as ImageFormatId) ? "✓ 작업에 선택됨" : "구성 살펴보기"}<span aria-hidden="true">⌄</span></span>
        </span></summary>
        <div className="ic-library-card-body"><p>{format.keep}</p>
        <p><strong>바꿀 요소</strong><br/>{format.slots}</p>
        <div className="ic-library-links">
          {format.documentId && <a href={warehouseDocumentUrl(format.documentId)} target="_blank" rel="noreferrer">OS 포맷 {format.id} · v{format.version}</a>}
          {format.thumbnail && <a href={format.thumbnail} target="_blank" rel="noreferrer">실제 광고 이미지</a>}
          {format.source && <a href={format.source} target="_blank" rel="noreferrer">원 광고 출처</a>}
          {isWarehouseFormat(format.id) && (onSelect
            ? <button type="button" className="secondary-button" aria-pressed={selected.includes(format.id)}
                onClick={() => { if (isWarehouseFormat(format.id)) onSelect(format.id); }}>
                {selected.includes(format.id) ? "작업에서 선택 해제" : "이 작업에 사용"}
              </button>
            : <a href="#image-format-compare">5종 비교 만들기</a>)}
        </div></div>
      </details>;
    })}</div>
    {catalog && formats.length === 0 && <div className="ic-library-empty"><strong>이 조건에 맞는 포맷이 없습니다.</strong><p className="ic-muted">다른 검색어를 입력하거나 분류를 바꿔보세요.</p>
      <button type="button" className="secondary-button" onClick={()=>{setQuery("");setGroup("");setRecommended(true);setLimit(8);}}>필터 초기화</button></div>}
    {formats.length > limit && <div className="ic-library-more"><button type="button" className="secondary-button" onClick={() => setLimit(n => n + 8)}>더 보기</button><span className="ic-muted">{formats.length}개 중 {Math.min(limit,formats.length)}개 표시</span></div>}
  </section>;
}
