"use client";

import { useState } from "react";
import { IMAGE_FORMATS, isWarehouseFormat, type ImageFormatId } from "@/lib/image-creative/formats";
import { warehouseDocumentUrl } from "@/lib/image-creative/reference-canon";
import { useImageReferenceCatalog } from "./use-image-reference-catalog";

type Props = {
  selected: readonly ImageFormatId[];
  onSelect: (id: ImageFormatId) => void;
  onSelectionChange: (ids: ImageFormatId[]) => void;
  onContinue: () => void;
  hasProject: boolean;
  disabled?: boolean;
  local?: boolean;
};

export function ImageFormatLibrary({selected,onSelect,onSelectionChange,onContinue,hasProject,disabled=false,local=false}: Props) {
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
  const selectable = formats.map(format=>format.id).filter(isWarehouseFormat);
  const allSelected = selectable.length > 0 && selectable.every(id=>selected.includes(id));
  const formatName = (id:ImageFormatId) => entries.find(format=>format.id===id)?.name ?? IMAGE_FORMATS[id].name;

  return <section className="panel panel-pad-lg ic-panel ic-format-library" aria-labelledby="image-library-title">
    <div className="ic-section-heading"><div><h2 id="image-library-title" tabIndex={-1}>광고 디자인 고르기</h2>
      <p className="ic-muted">원하는 디자인을 고르고 광고 내용을 입력하세요. 예시 속 사진과 문구는 다음 단계에서 바꿉니다.</p></div>
      {offline && <span className="ic-status-badge">체험용 디자인 예시</span>}
    </div>
    <div className="ic-library-guide"><strong>이렇게 사용하세요</strong><ol><li>디자인 선택</li><li>상품·고객 정보 입력</li><li>사진·문구 준비</li></ol>
      <p>한 개를 고르면 광고 한 장, 여러 개를 고르면 같은 내용으로 디자인을 비교할 수 있어요.</p></div>
    {error && <p role="alert">{error} <button type="button" className="secondary-button" onClick={() => void refresh().catch(() => {})}>다시 읽기</button></p>}
    {!catalog && !error && <p role="status">포맷 창고에서 디자인을 불러오고 있어요.</p>}
    <div className="ic-library-filters">
      <label className="ic-field">디자인 검색
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
        onChange={event => { setRecommended(event.target.checked); setLimit(8); }} /> 바로 제작 가능한 디자인만</label>
      <div className="ic-row">{catalog && <span role="status" className="ic-library-count">{formats.length}개 디자인</span>}
        {selectable.length > 1 && <button type="button" className="secondary-button" disabled={disabled || allSelected}
          onClick={()=>onSelectionChange([...new Set([...selected,...selectable])])}>{selectable.length}개 디자인 모두 선택</button>}
      </div>
    </div>
    <div className="ic-library-grid">{formats.slice(0, limit).map(format => {
      const usable = isWarehouseFormat(format.id);
      const checked = selected.includes(format.id as ImageFormatId);
      return <article key={format.id} className="ic-library-card" data-selected={checked || undefined} aria-label={format.name + " 디자인"}>
        <div className="ic-library-preview">
          {format.archivedThumbnail
            // eslint-disable-next-line @next/next/no-img-element -- original picture saved in the approved chapter
            ? <img className="ic-format-library-sample" src={format.archivedThumbnail} alt={format.name + " 원 광고"} loading="lazy"/>
            : usable ?
            // eslint-disable-next-line @next/next/no-img-element -- packaged public format example
            <img className="ic-format-library-sample" src={'/image-format-test/examples/' + format.id + '-portrait.webp'}
              width={216} height={270} alt={format.name + " 광고 구성 예시"} loading="lazy"/>
            : <span className="ic-library-no-preview">{format.group}<small>아래에서 구성 설명을 확인하세요</small></span>}
          {checked && <span className="ic-library-picked">✓ 선택됨</span>}
        </div>
        <div className="ic-library-caption"><span className="ic-library-category">{format.group}</span><h3>{format.name}</h3>
          {usable ? <button type="button" className={checked ? "primary-button" : "secondary-button"} aria-pressed={checked}
            aria-label={format.name + (checked ? " 선택 해제" : " 선택")} disabled={disabled} onClick={()=>{if(isWarehouseFormat(format.id))onSelect(format.id);}}>
            {checked ? "✓ 선택됨 · 해제" : "이 디자인 선택"}
          </button> : <p className="ic-field-hint">구성 참고용 · 자동 제작은 지원하지 않아요.</p>}
        </div>
        <details className="ic-library-card-details"><summary>구성·바꿀 요소 보기</summary>
          <div className="ic-library-card-body"><p>{format.keep}</p><p><strong>바꿀 요소</strong><br/>{format.slots}</p>
            <div className="ic-library-links">
              {format.documentId && <a href={warehouseDocumentUrl(format.documentId)} target="_blank" rel="noreferrer">포맷 창고 원문 · v{format.version}</a>}
              {format.thumbnail && <a href={format.thumbnail} target="_blank" rel="noreferrer">실제 광고 이미지</a>}
              {format.source && <a href={format.source} target="_blank" rel="noreferrer">원 광고 출처</a>}
            </div>
          </div>
        </details>
      </article>;
    })}</div>
    {catalog && formats.length === 0 && <div className="ic-library-empty"><strong>이 조건에 맞는 디자인이 없습니다.</strong><p className="ic-muted">다른 검색어를 입력하거나 분류를 바꿔보세요.</p>
      <button type="button" className="secondary-button" onClick={()=>{setQuery("");setGroup("");setRecommended(true);setLimit(8);}}>필터 초기화</button></div>}
    {formats.length > limit && <div className="ic-library-more"><button type="button" className="secondary-button" onClick={() => setLimit(n => n + 8)}>더 보기</button><span className="ic-muted">{formats.length}개 중 {Math.min(limit,formats.length)}개 표시</span></div>}
    <div className="ic-library-selection" data-has-selection={selected.length > 0 || undefined}>
      <div className="ic-library-selection-summary"><strong aria-live="polite">{selected.length ? "선택한 디자인 "+selected.length+"개" : "사용할 디자인을 선택해주세요"}</strong>
        {selected.length > 0 && <ul className="ic-library-selected-list">{selected.map(id=><li key={id}><button type="button" disabled={disabled} aria-label={formatName(id)+" 선택 목록에서 제거"} onClick={()=>onSelect(id)}>{formatName(id)} <span aria-hidden="true">×</span></button></li>)}</ul>}
        <p className="ic-field-hint">{!hasProject ? "작업을 만들기 전에 골라도 괜찮아요. 새 작업에 선택한 디자인이 그대로 적용됩니다." : selected.length > 1 ? "같은 사진과 문구로 선택한 디자인을 비교합니다." : "선택 후 상품·고객 정보를 입력하고 사진과 문구를 준비하세요."}</p>
      </div>
      <div className="ic-library-next-actions">{selected.length > 0 && <button type="button" className="secondary-button" disabled={disabled} onClick={()=>onSelectionChange([])}>전체 해제</button>}
        <button type="button" className="primary-button" disabled={disabled || !selected.length} onClick={onContinue}>{hasProject ? "다음: 광고 내용 입력" : "이 디자인으로 작업 시작"}</button>
      </div>
    </div>
  </section>;
}
