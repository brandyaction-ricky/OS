"use client";

import Image from "next/image";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { CARD_FORMAT_IDS, CARD_FORMATS, type CardFormatId, type CardPhoto } from "@/lib/cardnews/formats";
import { FORMAT_INPUT, PRODUCTION_TYPES, formatRange, type ProductionInput } from "@/lib/cardnews/production";
import { useLeaveGuard } from "./youtube-process-frame";

interface Props {
  aiAvailable: boolean; onRequestAI: (value: ProductionInput) => Promise<boolean>;
  initial: ProductionInput;
  thumbnail: (id: CardFormatId, position: "cover" | "body" | "end") => ReactNode;
  save: (data: ProductionInput, create: boolean) => Promise<boolean>;
  upload: (file: File) => Promise<CardPhoto>;
  resolvePhoto: (path: string) => Promise<string>;
  onReady: () => void;
}
export function CardProductionStart({ initial, thumbnail, save, upload, resolvePhoto, onReady, aiAvailable, onRequestAI }: Props) {
  const [method, setMethod] = useState("manual");
  const [data, setData] = useState(initial);
  const [dirty, setDirty] = useState(false);
  const [state, setState] = useState("");
  const [loading, setLoading] = useState(false);
  const [refUrl, setRefUrl] = useState("");
  const [purpose, setPurpose] = useState<"design" | "use">(initial.reference?.purpose ?? "design");
  const rev = useRef(0), creating = useRef(false);
  const saveRef = useRef(save); saveRef.current = save;
  const type = FORMAT_INPUT[data.format].type;
  const change = (patch: Partial<ProductionInput>) => {
    rev.current++; setData(d => ({ ...d, ...patch })); setDirty(true); setState("저장 대기");
  };
  useLeaveGuard(dirty);
  const persist = useCallback(async (value: ProductionInput, create: boolean, revision: number) => {
    setState("저장 중…");
    const ok = await saveRef.current(value, create);
    if (revision === rev.current) { setDirty(!ok); setState(ok ? "저장 완료" : "저장 실패 · 입력 내용을 확인하고 다시 저장해 주세요."); }
    return ok;
  }, []);
  useEffect(() => {
    if (!dirty || creating.current) return;
    const timer = setTimeout(() => { void persist(data, false, rev.current); }, 750);
    return () => clearTimeout(timer);
  }, [data, dirty, persist]);
  const path = data.reference?.photo.path;
  useEffect(() => {
    let live = true; setRefUrl("");
    if (path) resolvePhoto(path).then(url => { if (live) setRefUrl(url); }, () => {});
    return () => { live = false; };
  }, [path, resolvePhoto]);
  const choose = (id: CardFormatId) => change({ format: id, detail: id === data.format ? data.detail : "" });
  return <section className="yp-fsec yp-production" aria-label="유형별 카드 제작">
    <h2>제작 방식 선택</h2>
    <div className="yp-production-types">{Object.entries(PRODUCTION_TYPES).map(([key, row]) =>
      <button type="button" className="yp-card-format" key={key} aria-pressed={key === type} onClick={() => { if (key !== type) choose(row.example); }}>
        <span aria-hidden="true">{thumbnail(row.example, "body")}</span><span><b>{row.name}</b><small>{row.detail}</small></span></button>)}</div>
    <h3>포맷 선택</h3><div className="yp-production-formats">{CARD_FORMAT_IDS.filter(id => FORMAT_INPUT[id].type === type).map(id => {
      const { count, min, max } = formatRange(id);
      return <button type="button" className="yp-card-format" key={id} aria-pressed={data.format === id} onClick={() => choose(id)}>
        <span aria-hidden="true" className="yp-production-strip">{(["cover", "body", "end"] as const).map(pos => <span key={pos}>{thumbnail(id, pos)}</span>)}</span>
        <b>{CARD_FORMATS[id].name}</b><small>{CARD_FORMATS[id].when}</small><small>기본 {count}장 · {min}~{max}장</small><small>입력 자료 · {FORMAT_INPUT[id].label}</small>
      </button>;
    })}</div>
    <fieldset disabled={loading}><legend>제작 내용</legend>
      <label>작업명 · 필수<input className="yp-in" value={data.title} maxLength={200} onChange={e => change({ title: e.target.value })} /></label>
      <label>원문·메모 · 필수<textarea className="yp-in" rows={4} value={data.memo} maxLength={16000} placeholder="핵심 사례나 문장을 한 줄씩 적어 주세요." onChange={e => change({ memo: e.target.value })} /></label>
      <label>{FORMAT_INPUT[data.format].label} · 선택<textarea className="yp-in" value={data.detail} maxLength={2000} placeholder={FORMAT_INPUT[data.format].hint} onChange={e => change({ detail: e.target.value })} /></label>
      <label>제작 요청 · 선택<textarea className="yp-in" value={data.direction} maxLength={1800} placeholder="독자에게 강조할 내용이나 원하는 장면" onChange={e => change({ direction: e.target.value })} /></label>
      <div className="yp-row-btns"><label>참고 이미지 용도<select className="yp-in" value={data.reference?.purpose ?? purpose} onChange={e => {
        const selected = e.target.value as typeof purpose; setPurpose(selected); if (data.reference) change({ reference: { ...data.reference, purpose: selected } });
      }}><option value="design">디자인 참고</option><option value="use">표지에 실제 사용</option></select></label>
      <label>참고 이미지 · 선택<input type="file" accept="image/png,image/jpeg,image/webp" onChange={async e => {
        const file = e.target.files?.[0]; e.target.value = ""; if (!file) return;
        setLoading(true);
        try { change({ reference: { purpose: data.reference?.purpose ?? purpose, photo: await upload(file) } }); }
        catch (err) { setState(err instanceof Error ? err.message : "이미지 업로드 실패"); } finally { setLoading(false); }
      }} /></label>{data.reference && <><button className="yp-btn" onClick={() => change({ reference: undefined })}>참고 이미지 제거</button>{refUrl && <Image unoptimized src={refUrl} width={72} height={72} className="yp-card-reference-img" alt="업로드한 참고 이미지" />}</>}</div>
      {aiAvailable && <label>페이지 구성 방식<select className="yp-in" value={method} onChange={e => setMethod(e.target.value)}><option value="manual">입력한 원문으로 구성</option><option value="ai">AI로 장별 원고 작성</option></select></label>}
    </fieldset>
    <div className="yp-row-btns"><button className="yp-btn yp-pri" disabled={loading || !data.title.trim() || !data.memo.trim()} onClick={async () => {
      if (creating.current) return; creating.current = true; setLoading(true);
      try {
        if (method === "ai" && aiAvailable) {
          if (await onRequestAI(data)) { setDirty(false); setState("저장 완료"); } else setState("저장 실패");
        } else if (await persist(data, true, rev.current)) onReady();
      } finally { creating.current = false; setLoading(false); }
    }}>페이지 구성 만들기</button><span role="status">{state}</span>{state.startsWith("저장 실패") && <button className="yp-btn" onClick={() => void persist(data, false, rev.current)}>다시 저장</button>}</div>
  </section>;
}
