"use client";

import { useState } from "react";
import catalog from "@/lib/image-creative/warehouse-formats.json";
import { IMAGE_FORMATS, isWarehouseFormat, type ImageFormatId } from "@/lib/image-creative/formats";

const groups = [...new Set(catalog.entries.map(format => format.group))];
const libraryUrl = "https://brandyaction-os.vercel.app/knowledge/doc/";

type Props = { selected?: readonly ImageFormatId[]; onSelect?: (id: ImageFormatId) => void };
export function ImageFormatLibrary({ selected = [], onSelect }: Props) {
  const [query, setQuery] = useState("");
  const [group, setGroup] = useState("");
  const [recommended, setRecommended] = useState(true);
  const [limit, setLimit] = useState(8);
  const wanted = query.toLocaleLowerCase().trim();
  const formats = catalog.entries.filter(format =>
    (!recommended || isWarehouseFormat(format.id)) &&
    (!group || format.group === group) &&
    (!wanted || [format.id, format.name, isWarehouseFormat(format.id) ? IMAGE_FORMATS[format.id].name : "", format.keep, format.slots].join(" ").toLocaleLowerCase().includes(wanted))
  );

  return <section className="panel panel-pad-lg ic-panel" aria-labelledby="image-library-title">
    <h2 id="image-library-title">포맷 창고</h2>
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
      <span role="status" className="ic-muted">{formats.length}개</span>
    </div>
    <div className="ic-actions">{formats.slice(0, limit).map(format => {
      const chapter = catalog.chapterIds[format.id[0] as keyof typeof catalog.chapterIds];
      const displayName = isWarehouseFormat(format.id) ? IMAGE_FORMATS[format.id].name : format.name;
      return <details key={format.id} className="ic-panel">
        <summary>{displayName}</summary>
        {isWarehouseFormat(format.id) &&
          // eslint-disable-next-line @next/next/no-img-element -- packaged public format example
          <img className="ic-format-library-sample" src={'/image-format-test/examples/' + format.id + '-portrait.webp'}
            width={216} height={270} alt={displayName + " 광고 구성 예시"} loading="lazy"/>}
        <p>{format.keep}</p>
        <p><strong>바꿀 요소</strong> {format.slots}</p>
        <div className="ic-row">
          <a href={libraryUrl + chapter} target="_blank" rel="noreferrer">OS 포맷 {format.id}</a>
          {format.thumbnail && <a href={format.thumbnail} target="_blank" rel="noreferrer">실제 광고 이미지</a>}
          {isWarehouseFormat(format.id) && (onSelect
            ? <button type="button" className="secondary-button" aria-pressed={selected.includes(format.id)}
                onClick={() => { if (isWarehouseFormat(format.id)) onSelect(format.id); }}>
                {selected.includes(format.id) ? "작업에서 선택 해제" : "이 작업에 사용"}
              </button>
            : <a href="#image-format-compare">5종 비교 만들기</a>)}
        </div>
      </details>;
    })}</div>
    {formats.length === 0 && <p>이 조건에 맞는 포맷이 없습니다.</p>}
    {formats.length > limit && <button className="secondary-button" onClick={() => setLimit(n => n + 8)}>더 보기</button>}
  </section>;
}
