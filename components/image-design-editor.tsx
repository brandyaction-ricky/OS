"use client";

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { ImageCreativeView } from "@/lib/image-creative/view";
import { isWarehouseFormat } from "@/lib/image-creative/formats";
import { type CreativeVariant, type ImageDesign } from "@/lib/image-creative/model";
import { defaultPlacement, PLACEMENT_IDS, resolvePlacement } from "@/lib/image-creative/placement";
import { LegacySavedPng } from "./legacy-saved-png";
import { WarehouseVariantPreview } from "./warehouse-variant-preview";

export function LegacyPreview({ variant, url, onCheck }: { variant: CreativeVariant; url?: string; onCheck?: (problems:string[])=>void }) {
  const placement = resolvePlacement(variant.size, variant.design?.placement, variant.design?.outputWidth);
  const box = useRef<HTMLDivElement>(null); const report=useRef(onCheck);
  useEffect(()=>{report.current=onCheck;},[onCheck]);
  useLayoutEffect(()=>{let live=true;const check=()=>{if(!live||!box.current)return;const fields=[...box.current.querySelectorAll<HTMLElement>("[data-image-field]")].filter(el=>el.scrollHeight>el.clientHeight+1 || el.scrollWidth>el.clientWidth+1).map(el=>el.dataset.imageField || "문구");const badImage=box.current.querySelector("[data-image-missing]") || [...box.current.querySelectorAll("img")].some(img=>!img.complete || !img.naturalWidth);report.current?.([...new Set(fields)].map(field=>`${field} 영역의 글자가 잘려요.`).concat(badImage?["이미지를 불러오는 중이거나 확인이 필요해요."]:[]));};check();void document.fonts?.ready.then(check);box.current?.addEventListener("load",check,true);box.current?.addEventListener("error",check,true);const target=box.current;return()=>{live=false;target?.removeEventListener("load",check,true);target?.removeEventListener("error",check,true);};},[variant,url]);
  useLayoutEffect(() => {
    const element = box.current;
    if (!element) return;
    element.style.setProperty("--ic-canvas-width", placement.width + "px");
    element.style.setProperty("--ic-canvas-height", placement.height + "px");
    const measure = () => element.style.setProperty("--ic-preview-scale", String(element.clientWidth / placement.width));
    const ro = new ResizeObserver(measure); ro.observe(element); measure();
    return () => ro.disconnect();
  }, [placement.width, placement.height]);
  return <div ref={box} className="ic-preview" data-size={placement.size}><div className="ic-preview-canvas"><ImageCreativeView variant={variant} assetUrl={url} /></div></div>;
}

const fontLabels = { original: "포맷 기본 글꼴", sans: "고딕 · 프리텐다드", serif: "명조 · 고운바탕", hand: "손글씨 · 개구", sign: "간판체 · 검은고딕" } satisfies Record<ImageDesign["font"], string>;
const cardLabels = { original: "포맷 기본 디자인", frame: "테두리 프레임", paper: "종이 카드" } satisfies Record<ImageDesign["card"], string>;

export function designSummary(variant: CreativeVariant): string {
  if (!variant.design) return "";
  const { font, card, placement, outputWidth } = variant.design;
  const spec = resolvePlacement(variant.size, placement, outputWidth);
  return [fontLabels[font], cardLabels[card], spec.label, `${spec.width}×${spec.height}`].join(" · ");
}

export function SafeZoneOverlay({ size, design }: { size: CreativeVariant["size"]; design?: ImageDesign }) {
  const { width, height, safe } = resolvePlacement(size, design?.placement, design?.outputWidth);
  const mask = `M0 0H${width}V${height}H0Z M${safe.x} ${safe.y}h${safe.width}v${safe.height}h${-safe.width}Z`;
  return <svg className="ic-safe-overlay" viewBox={`0 0 ${width} ${height}`} aria-hidden="true" focusable="false">
    <path d={mask} fill="rgba(23, 22, 39, .43)" fillRule="evenodd" />
    <rect x={safe.x} y={safe.y} width={safe.width} height={safe.height} fill="none" stroke="#171627" strokeWidth="2.5" vectorEffect="non-scaling-stroke" />
    <rect x={safe.x} y={safe.y} width={safe.width} height={safe.height} fill="none" stroke="#fff" strokeWidth="1.5" strokeDasharray="6 4" vectorEffect="non-scaling-stroke" />
  </svg>;
}

type EditorProps = {
  projectId: string; base: CreativeVariant; assetUrl?: string;
  onSave: (baseId: string, id: string, design: ImageDesign) => Promise<void>; onClose: () => void;
};
export function ImageDesignEditor({ projectId, base, assetUrl, onSave, onClose }: EditorProps) {
  const original = useMemo<ImageDesign>(() => base.design || { font: "original", card: "original", placement: defaultPlacement(base.size) }, [base]);
  const [design, setDesign] = useState(original);
  const [guide, setGuide] = useState(true);
  const [busy, setBusy] = useState(false);
  const [issue, setIssue] = useState("");
  const [render, setRender] = useState<{ key: string; problems: string[] } | null>(null);
  const requestId = useRef("");
  const section = useRef<HTMLElement>(null);
  useEffect(() => { section.current?.focus({ preventScroll: true }); section.current?.scrollIntoView({ block: "start" }); }, []);
  const placement = resolvePlacement(base.size, design.placement, design.outputWidth);
  const draft = useMemo(() => ({ ...base, size: placement.size, design }), [base, design, placement.size]);
  const key = JSON.stringify([design.font, design.card, design.placement, design.outputWidth || 1080]);
  const changed = design.font !== original.font || design.card !== original.card ||
    design.placement !== original.placement || (design.outputWidth || 1080) !== (original.outputWidth || 1080);
  const onCheck = (problems: string[]) => setRender(old =>
    old?.key === key && old.problems.join("\n") === problems.join("\n") ? old : { key, problems });
  function update(next: ImageDesign) {
    setIssue(""); setRender(null); requestId.current = ""; setDesign(next);
  }
  async function save() {
    if (busy || !changed || render?.key !== key || render.problems.length) return;
    setBusy(true); setIssue("");
    try {
      requestId.current ||= crypto.randomUUID();
      await onSave(base.id, requestId.current, design);
    } catch (error) { setIssue(error instanceof Error ? error.message : "수정본을 저장하지 못했어요."); }
    finally { setBusy(false); }
  }
  return <section ref={section} tabIndex={-1} className="ic-editor" aria-label="디자인 편집">
    <div className="ic-editor-preview">
      <div className="ic-artboard">
        {isWarehouseFormat(base.formatId)
          ? <WarehouseVariantPreview key={key} variant={draft} assetUrl={assetUrl} onCheck={onCheck}/>
          : <LegacySavedPng key={key} projectId={projectId} baseId={base.id} variant={draft} assetUrl={assetUrl} onCheck={onCheck}/>}
        {guide && <SafeZoneOverlay size={base.size} design={design}/>}
      </div>
      <label className="ic-check ic-guide-switch"><input type="checkbox" checked={guide} onChange={e=>setGuide(e.target.checked)}/> 세이프 존 표시</label>
      <p className="ic-muted">점선 안이 주요 내용을 배치할 영역입니다. 가이드선은 PNG에서 제외됩니다.</p>
    </div>
    <fieldset className="ic-editor-fields" disabled={busy}>
      <legend>디자인 편집</legend>
      <label className="ic-field">제목 글꼴<select className="field" value={design.font} onChange={e=>update({ ...design, font: e.target.value as ImageDesign["font"] })}>
        {Object.entries(fontLabels).map(([value, label])=><option key={value} value={value}>{label}</option>)}</select></label>
      <label className="ic-field">카드 디자인<select className="field" value={design.card} onChange={e=>update({ ...design, card: e.target.value as ImageDesign["card"] })}>
        {Object.entries(cardLabels).map(([value, label])=><option key={value} value={value}>{label}</option>)}</select></label>
      <label className="ic-field">게재 위치와 비율<select className="field" value={design.placement} onChange={e=>update({ ...design, placement: e.target.value as ImageDesign["placement"] })}>
        {PLACEMENT_IDS.map(id=><option key={id} value={id}>{resolvePlacement(base.size,id).label}</option>)}</select></label>
      <label className="ic-field">출력 해상도<select className="field" value={design.outputWidth || 1080} onChange={e=>update({ ...design, outputWidth: e.target.value === "1440" ? 1440 : 1080 })}>
        {([1080, 1440] as const).map(w=>{const p=resolvePlacement(base.size,design.placement,w);return <option key={w} value={w}>{p.width} × {p.height} px</option>;})}</select></label>
      {issue && <p role="alert">{issue}</p>}
      {render?.key===key && render.problems.length>0 && <p role="status" className="ic-muted">{render.problems.join(" · ")}</p>}
      <div className="ic-row"><button type="button" className="primary-button" disabled={!changed || render?.key!==key || render.problems.length>0} onClick={()=>void save()}>수정본 저장</button>
        <button type="button" className="secondary-button" onClick={onClose}>닫기</button></div>
    </fieldset>
  </section>;
}
