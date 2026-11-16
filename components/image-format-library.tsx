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

  return <section className="panel panel-pad-lg ic-panel" aria-labelledby="image-library-title">
    <h2 id="image-library-title">포맷 창고</h2>
    {offline && <p className="ic-muted">오프라인 체험용 예시</p>}
    {error && <p role="alert">{error} <button type="button" className="secondary-button" onClick={() => void refresh().catch(() => {})}>다시 읽기</button></p>}
    {!catalog && !error && <p role="status">OS 포맷 창고를 읽고 있어요.</p>}
    <div className="ic-grid">
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
    <div className="ic-row">
      <label><input type="checkbox" checked={recommended}
        onChange={event => { setRecommended(event.target.checked); setLimit(8); }} /> 바로 제작할 수 있는 창고 포맷만 보기</label>
      {catalog && <span role="status" className="ic-muted">{formats.length}개</span>}
    </div>
    <div className="ic-actions">{formats.slice(0, limit).map(format => {
      return <details key={format.id} className="ic-panel">
        <summary>{format.name}</summary>
        {format.archivedThumbnail
          // eslint-disable-next-line @next/next/no-img-element -- original picture saved in the approved chapter
          ? <img className="ic-format-library-sample" src={format.archivedThumbnail} alt={format.name + " 원 광고"} loading="lazy"/>
          : isWarehouseFormat(format.id) &&
          // eslint-disable-next-line @next/next/no-img-element -- packaged public format example
          <img className="ic-format-library-sample" src={'/image-format-test/examples/' + format.id + '-portrait.webp'}
            width={216} height={270} alt={format.name + " 광고 구성 예시"} loading="lazy"/>}
        <p>{format.keep}</p>
        <p><strong>바꿀 요소</strong> {format.slots}</p>
        <div className="ic-row">
          {format.documentId && <a href={warehouseDocumentUrl(format.documentId)} target="_blank" rel="noreferrer">OS 포맷 {format.id} · v{format.version}</a>}
          {format.thumbnail && <a href={format.thumbnail} target="_blank" rel="noreferrer">실제 광고 이미지</a>}
          {format.source && <a href={format.source} target="_blank" rel="noreferrer">원 광고 출처</a>}
          {isWarehouseFormat(format.id) && (onSelect
            ? <button type="button" className="secondary-button" aria-pressed={selected.includes(format.id)}
                onClick={() => { if (isWarehouseFormat(format.id)) onSelect(format.id); }}>
                {selected.includes(format.id) ? "작업에서 선택 해제" : "이 작업에 사용"}
              </button>
            : <a href="#image-format-compare">5종 비교 만들기</a>)}
        </div>
      </details>;
    })}</div>
    {catalog && formats.length === 0 && <p>이 조건에 맞는 포맷이 없습니다.</p>}
    {formats.length > limit && <button className="secondary-button" onClick={() => setLimit(n => n + 8)}>더 보기</button>}
  </section>;
}
