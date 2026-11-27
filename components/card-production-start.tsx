"use client";

import Link from "next/link";
import { MYIN_DESIGNS } from "@/lib/cardnews/myin-example";
import Image from "next/image";
import { ArrowRight, Check, ImagePlus } from "lucide-react";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { CARD_FORMAT_IDS, CARD_FORMATS, type CardFormatId, type CardPhoto } from "@/lib/cardnews/formats";
import { FORMAT_INPUT, PRODUCTION_TYPES, formatRange, type ProductionInput } from "@/lib/cardnews/production";
import { useLeaveGuard } from "./youtube-process-frame";

const EXAMPLE_PAGES = [["cover", "표지"], ["body", "본문"], ["end", "마지막 장"]] as const;

interface Props {
  aiAvailable: boolean; onRequestAI: (value: ProductionInput) => Promise<boolean>;
  initial: ProductionInput;
  thumbnail: (id: CardFormatId, position: "cover" | "body" | "end", width: number) => ReactNode;
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
  const previewDialog = useRef<HTMLDialogElement>(null);
  const [previewPage, setPreviewPage] = useState(0);
  const fileInput = useRef<HTMLInputElement>(null);
  const detailsByFormat = useRef<Partial<Record<CardFormatId, string>>>({});
  const [uploadError, setUploadError] = useState("");
  const [uploading, setUploading] = useState(false);
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
  const choose = (id: CardFormatId) => {
    if (id === data.format) return;
    detailsByFormat.current[data.format] = data.detail;
    change({ format: id, detail: detailsByFormat.current[id] ?? "" });
  };
  const format = CARD_FORMATS[data.format];
  const input = FORMAT_INPUT[data.format];
  const { count, min, max } = formatRange(data.format);
  const missing = !data.title.trim() ? "작업명을 입력해 주세요." : !data.memo.trim() ? "원문·메모를 입력해 주세요." : "";
  const busy = loading || uploading;
  async function attach(file: File) {
    setUploadError("");
    if (!["image/jpeg", "image/png", "image/webp"].includes(file.type)) {
      setUploadError("JPG, PNG 또는 WebP 이미지를 선택해 주세요.");
      return;
    }
    setUploading(true);
    try {
      const photo = await upload(file);
      change({ reference: { purpose: data.reference?.purpose ?? purpose, photo } });
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : "이미지를 첨부하지 못했어요. 다시 선택해 주세요.");
    } finally { setUploading(false); }
  }
  return <section className="yp-fsec yp-production" aria-label="유형별 카드 제작">
    <div className="yp-production-block">
      <h2 className="yp-production-heading">제작 방식 선택</h2>
      <p className="yp-hint">정본 확인 → 내용 기획 → 원고 검토 → 그림 생성 → PNG 출력</p>
      <Link className="yp-btn" href="/content/cardnews/myin">마이인 정본 기반 8장 제작 예시 열기 ↗</Link>
      <div className="yp-production-types" role="group" aria-label="제작 유형">{Object.entries(PRODUCTION_TYPES).map(([key, row]) =>
        <button type="button" className="yp-production-choice" key={key} disabled={busy} aria-pressed={key === type} onClick={() => { if (key !== type) choose(row.example); }}>
          <div aria-hidden="true">{thumbnail(row.example, "body", 40)}</div>
          <span className="yp-choice-copy"><strong>{row.name}</strong><small className="yp-production-meta">{row.detail}</small></span>
          {key === type && <Check size={16} aria-hidden="true" />}
        </button>)}</div>
      {data.format === "list" && <label className="yp-field"><span>디자인 기준</span><select className="yp-in" value={data.design ?? "legacy"} disabled={busy} onChange={e => change({ design: e.target.value as ProductionInput["design"] })}><option value="legacy">기존 디자인 유지</option>{MYIN_DESIGNS.map(d => <option key={d.id} value={d.id}>마이인 · {d.name}</option>)}</select><small>새로 만드는 초안에 적용됩니다. 기존 초안은 유지해요.</small></label>}
      <h3 className="yp-production-subhead">포맷 선택</h3>
      <div className="yp-production-layout">
        <div className="yp-production-formats" role="group" aria-label="포맷 선택">{CARD_FORMAT_IDS.filter(id => FORMAT_INPUT[id].type === type).map(id =>
          <button type="button" className="yp-production-choice" aria-pressed={data.format === id} disabled={busy} key={id} onClick={() => choose(id)}>
            <span className="yp-choice-copy"><strong>{CARD_FORMATS[id].name}</strong><small className="yp-production-meta">{CARD_FORMATS[id].when}</small></span>
            {data.format === id && <Check size={16} aria-hidden="true" />}
          </button>)}</div>
        <section className="yp-production-example" aria-label="선택 포맷 미리보기">
          <div className="yp-production-example-head"><strong>{format.name} 예시</strong><small className="yp-production-meta">기본 {count}장 · {min}~{max}장</small></div>
          <div className="yp-production-strip">{EXAMPLE_PAGES.map(([pos, label], index) =>
            <button type="button" className="yp-production-slide" key={pos} aria-label={label + " 예시 크게 보기"} onClick={() => { setPreviewPage(index); previewDialog.current?.showModal(); }}>
              <div aria-hidden="true">{thumbnail(data.format, pos, 72)}</div><span>{label} ↗</span>
            </button>)}</div>
          <small className="yp-production-meta">입력 자료 · {input.label}</small>
        </section>
      </div>
    </div>
    <dialog ref={previewDialog} className="yp-modal yp-production-dialog" aria-label="포맷 예시 크게 보기">
      <div className="yp-modal-h"><strong>{format.name} · {EXAMPLE_PAGES[previewPage][1]}</strong><span className="yp-sp" />
        <button type="button" className="yp-btn" onClick={() => previewDialog.current?.close()}>닫기</button></div>
      <div className="yp-production-dialog-body">{thumbnail(data.format, EXAMPLE_PAGES[previewPage][0], 252)}
        <div className="yp-row-btns">{EXAMPLE_PAGES.map(([key,label], i) => <button type="button" key={key} className="yp-btn" aria-pressed={i === previewPage} onClick={() => setPreviewPage(i)}>{label}</button>)}</div>
      </div>
    </dialog>
    <fieldset disabled={busy} className="yp-production-fields" aria-labelledby="yp-production-content">
      <h3 id="yp-production-content" className="yp-production-heading">제작 내용</h3>
      <label className="yp-production-field"><span>작업명 <small className="yp-production-meta">필수</small></span><input required className="yp-in" value={data.title} maxLength={200} onChange={e => change({ title: e.target.value })} /></label>
      <label className="yp-production-field"><span>원문·메모 <small className="yp-production-meta">필수</small></span><textarea required className="yp-in" rows={3} value={data.memo} maxLength={16000} placeholder="핵심 사례나 문장을 한 줄씩 적어 주세요." onChange={e => change({ memo: e.target.value })} /></label>
      <div className="yp-production-pair">
        <label className="yp-production-field"><span>{input.label} <small className="yp-production-meta">선택</small></span><textarea className="yp-in" value={data.detail} maxLength={2000} placeholder={input.hint} onChange={e => change({ detail: e.target.value })} /></label>
        <label className="yp-production-field"><span>제작 요청 <small className="yp-production-meta">선택</small></span><textarea className="yp-in" value={data.direction} maxLength={1800} placeholder="독자에게 강조할 내용이나 원하는 장면" onChange={e => change({ direction: e.target.value })} /></label>
      </div>
      <div className="yp-production-asset">
        {data.reference && refUrl && <Image unoptimized src={refUrl} width={48} height={48} className="yp-card-reference-img" alt="업로드한 참고 이미지" />}
        <span className="yp-choice-copy"><strong>참고 이미지 <small className="yp-production-meta">선택</small></strong><small className="yp-production-meta">{uploading ? "이미지 첨부 중…" : data.reference ? `첨부됨 · ${data.reference.photo.w} × ${data.reference.photo.h}` : "JPG · PNG · WebP"}</small></span>
        <div className="yp-production-asset-controls">
          <select aria-label="참고 이미지 용도" className="yp-in" value={data.reference?.purpose ?? purpose} onChange={e => {
            const selected = e.target.value as typeof purpose; setPurpose(selected); if (data.reference) change({ reference: { ...data.reference, purpose: selected } });
          }}><option value="design">디자인 참고</option><option value="use">표지에 실제 사용</option></select>
          <input ref={fileInput} hidden aria-label="참고 이미지 파일" type="file" accept="image/png,image/jpeg,image/webp" onChange={e => {
            const file = e.target.files?.[0]; e.target.value = ""; if (file) void attach(file);
          }} />
          <button type="button" className="yp-btn" onClick={() => fileInput.current?.click()}><ImagePlus size={16} aria-hidden="true" />{data.reference ? "이미지 교체" : "이미지 첨부"}</button>
          {data.reference && <button type="button" className="yp-btn" aria-label="참고 이미지 제거" onClick={() => { setUploadError(""); change({ reference: undefined }); }}>제거</button>}
        </div>
        {uploadError && <span className="yp-production-error" role="alert">{uploadError}</span>}
      </div>
      {aiAvailable && <label className="yp-production-field">페이지 구성 방식<select className="yp-in" value={method} onChange={e => setMethod(e.target.value)}><option value="manual">입력한 원문으로 구성</option><option value="ai">AI로 장별 원고 작성</option></select></label>}
    </fieldset>
    <div className="yp-production-footer">
      <span role="status">{missing || state}</span>{state.startsWith("저장 실패") && <button className="yp-btn" onClick={() => void persist(data, false, rev.current)}>다시 저장</button>}
      <button type="button" className="yp-btn yp-pri" disabled={busy || Boolean(missing)} onClick={async () => {
        if (creating.current) return; creating.current = true; setLoading(true);
        try {
          if (method === "ai" && aiAvailable) {
            if (await onRequestAI(data)) { setDirty(false); setState("저장 완료"); } else setState("저장 실패");
          } else if (await persist(data, true, rev.current)) onReady();
        } finally { creating.current = false; setLoading(false); }
      }}>{loading ? "구성 만드는 중…" : "페이지 구성 만들기"}<ArrowRight size={16} aria-hidden="true" /></button>
    </div>
  </section>;
}
