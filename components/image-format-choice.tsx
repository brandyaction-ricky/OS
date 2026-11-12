"use client";

import { useId, useState } from "react";
import { CREATIVE_SIZES, IMAGE_FORMAT_IDS, IMAGE_FORMATS, isWarehouseFormat, type CreativeSize, type ImageFormatId } from "@/lib/image-creative/formats";

interface PickerProps {
  reference?:boolean;
  recommendations: { id: ImageFormatId; reason: string }[];
  selected: ImageFormatId[];
  onSelect: (id: ImageFormatId) => void;
  size: CreativeSize;
  availableIds?: readonly ImageFormatId[];
  assetHint?: string;
  disabled?: boolean;
}

export function ImageFormatSample({id,size}: {id:ImageFormatId;size:CreativeSize}) {
  // eslint-disable-next-line @next/next/no-img-element -- derived from the production PNG.
  return <img className="ic-format-sample" src={`/image-format-test/examples/${id}-${size}.webp`}
    width={CREATIVE_SIZES[size].width} height={CREATIVE_SIZES[size].height}
    alt={IMAGE_FORMATS[id].name + " 광고 구성 예시"} loading="lazy" decoding="async"/>;
}

function ImageFormatChoice({ id, size, reason, assetHint, selected, onSelect, disabled }: {
  id: ImageFormatId; size: CreativeSize; reason?: string; assetHint?: string; selected: boolean; onSelect: () => void; disabled?: boolean;
}) {
  const format = IMAGE_FORMATS[id];
  const description = useId();
  return <button type="button" className="ic-format-choice" aria-label={format.name}
    aria-pressed={selected} aria-describedby={description} disabled={disabled} onClick={onSelect}>
    <ImageFormatSample id={id} size={size}/>
    <span className="ic-format-caption">
      <span className="ic-format-heading"><strong>{format.name}</strong>
        <span className="ic-format-indicator" aria-hidden="true">{selected ? "✓" : ""}</span>
      </span>
      <span id={description} className="ic-format-description">{reason || format.when}
        {format.assetRequired && <small>{assetHint ?? (id === "thumbnail_subject" ? "사진 업로드 또는 구독 AI로 제작" : "사진 또는 이미지 필요")}</small>}
      </span>
    </span>
  </button>;
}

export function ImageFormatPicker({ recommendations, selected, onSelect, size, availableIds = IMAGE_FORMAT_IDS, assetHint, disabled, reference }: PickerProps) {
  const [expanded, setExpanded] = useState(false);
  const supported = availableIds.filter(id => !isWarehouseFormat(id) || size === "portrait");
  const recommended = recommendations.filter(row => supported.includes(row.id));
  const featured: PickerProps["recommendations"] = recommended.length ? recommended : (["M01", "split_compare", "note"] as const)
    .filter(id => supported.includes(id)).map(id => ({ id, reason: IMAGE_FORMATS[id].when }));
  if (!reference && supported.includes("thumbnail_subject") && !featured.some(row => row.id === "thumbnail_subject")) {
    featured.push({ id: "thumbnail_subject", reason: "유튜브 썸네일 방식으로 사진 한 장과 짧은 제목을 조합합니다." });
  }
  const others = supported.filter(id => !featured.some(row => row.id === id));
  const otherSelection = others.filter(id => selected.includes(id)).map(id => IMAGE_FORMATS[id].name).join(", ");
  const card = (id: ImageFormatId, reason?: string) => <ImageFormatChoice key={id} id={id} size={size}
    reason={reason} assetHint={assetHint} selected={selected.includes(id)} onSelect={() => onSelect(id)} disabled={disabled}/>;
  return <div className="ic-format-picker">
    {featured.length > 0 && <div className="ic-format-choice-grid">{featured.map(row => card(row.id, row.reason))}</div>}
    {others.length > 0 && <details className="ic-details" onToggle={event => setExpanded(event.currentTarget.open)}>
      <summary>{reference ? `다른 레퍼런스 ${others.length}개 보기` : featured.length ? "다른 제작 포맷 보기" : "제작 포맷 보기"}{!expanded && otherSelection && " · 선택한 포맷 " + otherSelection}</summary>
      {expanded && <div className="ic-format-choice-grid">{others.map(id => card(id))}</div>}
    </details>}
  </div>;
}
