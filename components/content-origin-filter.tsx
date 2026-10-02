"use client";
import { CONTENT_ORIGIN_LABELS, type ContentOriginFilter as OriginFilter } from "@/lib/content-origin";
export function ContentOriginFilter({ value, onChange }: { value: OriginFilter; onChange: (value: OriginFilter) => void }) {
  return <label className="content-origin-filter">콘텐츠 종류<select value={value} onChange={event => onChange(event.target.value as OriginFilter)}>{Object.entries(CONTENT_ORIGIN_LABELS).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label>;
}
