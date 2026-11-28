"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { CostTag, useCostConfirm, useCostModels } from "./cost-notice";
import { imageEstimate, modelName, tokenEstimate } from "@/lib/cost";
import { GPT_TIERS } from "@/lib/youtube-process/gpt-draft";
import { apiRequest } from "@/lib/api-client";
import { GUIDE_CAST, slideSpec, type CardDraft, type CardSlide } from "@/lib/cardnews/formats";
import { mondayFields } from "@/lib/cardnews/planning";
import type { YpPage } from "./youtube-process-frame";

type Scope = "field" | "image" | "page" | "all";
type Row = { index: number; status: "대기" | "생성 중" | "완료" | "실패"; candidate?: CardSlide; error?: string };
export function CardRegeneration({ page, draft, index, version, disabled, apply, preview }: {
  page: YpPage; draft: CardDraft; index: number; version: number; disabled: boolean;
  apply: (draft: CardDraft) => void; preview: (draft: CardDraft, index: number) => ReactNode;
}) {
  const [scope, setScope] = useState<Scope>("field");
  const [fieldKey, setFieldKey] = useState("");
  const [rows, setRows] = useState<Row[]>([]);
  const [running, setRunning] = useState(false);
  const [message, setMessage] = useState("");
  const lock = useRef(false);
  const cost = useCostConfirm(), imageModel = useCostModels().image;
  const snapshot = useRef<{ draft: CardDraft; version: number; scope: Scope; key: string } | null>(null);
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const slide = draft.slides[index], fields = slideSpec(draft.format, slide.type)?.fields ?? [];
  const key = fields.some(f => f.key === fieldKey) ? fieldKey : fields[0]?.key;
  const stale = snapshot.current && (snapshot.current.version !== version || JSON.stringify(snapshot.current.draft) !== JSON.stringify(draft));
  const hasArt = (s: CardSlide) => Boolean(slideSpec(draft.format, s.type)?.photo || s.scene?.action);
  const canDraw = (s: CardSlide) => hasArt(s) && !s.imageLocked && Boolean(s.artDirection?.trim() || s.fields.scene?.trim() || s.scene?.action || s.photo);
  const allowed = scope === "all" ? draft.slides.some(s => !s.textLocked || canDraw(s))
    : scope === "image" ? hasArt(slide) && !slide.imageLocked : scope === "field" ? !slide.textLocked : !slide.textLocked || canDraw(slide);
  const generate = async (retry?: number) => {
    if (lock.current || disabled || !page.bundle || !page.client || (retry !== undefined && stale)) return;
    const indexes = retry !== undefined ? [retry] : scope === "all" ? draft.slides.map((_, i) => i).filter(i => !draft.slides[i].textLocked || canDraw(draft.slides[i])) : [index];
    lock.current = true;
    const textPages = indexes.filter(i => scope !== "image" && !draft.slides[i].textLocked).length;
    const imagePages = indexes.filter(i => scope === "image" || (scope !== "field" && canDraw(draft.slides[i]))).length;
    const textModel = GPT_TIERS.saving.model;
    const copyCost = tokenEstimate(textModel, 40000, 2500), artCost = imageEstimate(imageModel, "medium", 2);
    if (!page.demo && !await cost.confirm({
      model: [textPages && modelName(textModel), imagePages && modelName(imageModel)].filter(Boolean).join(" + "),
      amount: (textPages && copyCost === null) || (imagePages && artCost === null) ? null : textPages * (copyCost ?? 0) + imagePages * (artCost ?? 0),
      detail: `원고 ${textPages}장 · 그림 ${imagePages}장`, note: "결과를 비교한 뒤 적용한 항목만 바뀌어요.", ok: "수정안 생성",
    })) { lock.current = false; return; }
    setRunning(true); setMessage("");
    const run = retry === undefined ? { draft, version, scope, key } : snapshot.current!;
    snapshot.current = run;
    if (retry === undefined) setRows(indexes.map(i => ({ index: i, status: "대기" })));
    const update = (row: Row) => setRows(old => old.map(r => r.index === row.index ? row : r));
    try {
      for (const i of indexes) {
        if (!mounted.current) break;
        const original = run.draft.slides[i];
        update({ index: i, status: "생성 중" });
        try {
          let next = { ...original };
          if (run.scope !== "image" && !original.textLocked) {
            let copy: Record<string, string> | null;
            if (page.demo) {
              const first = mondayFields(original, i);
              copy = mondayFields(original, i, JSON.stringify(original.fields) === JSON.stringify(first));
            } else {
              const response = await apiRequest<{ fields: Record<string, string> }>(`/api/v1/content/youtube/projects/${page.bundle.project.id}/cards`, {
                token: page.accessToken, method: "POST", body: JSON.stringify({ action: "rewrite", draftId: run.draft.id, index: i, version: run.version, fieldKey: run.scope === "field" ? run.key : undefined }),
              });
              copy = response.fields;
            }
            if (!copy) throw new Error("이 장의 데모 예시는 제공되지 않아요.");
            next = { ...next, fields: { ...next.fields, ...(run.scope === "field" ? { [run.key]: copy[run.key] } : copy) } };
          }
          if (!original.imageLocked && (run.scope === "image" || (run.scope !== "field" && canDraw(original)))) {
            const scene = original.artDirection?.trim() || next.fields.scene?.trim() || original.scene?.action || Object.values(next.fields).filter(Boolean).join(" ");
            if (!scene?.trim()) throw new Error("그릴 장면과 행동을 먼저 적어 주세요.");
            const photo = await page.client.cardDraw(page.bundle.project.id, { scene, designReference: run.draft.production?.reference?.purpose === "design" ? run.draft.production.reference.photo.path : undefined, style: draft.format === "webtoon" ? "webtoon" : "simple", quality: "medium", refs: [], guideCharacter: GUIDE_CAST.find(name => name === original.scene?.character) });
            next = { ...next, photo };
          }
          update({ index: i, status: "완료", candidate: next });
        } catch (err) { update({ index: i, status: "실패", error: err instanceof Error ? err.message : "생성 실패" }); }
      }
    } finally { lock.current = false; setRunning(false); }
  };
  return <details className="yp-card-b" open={rows.length ? true : undefined}><summary>부분 수정 · 재생성</summary>{cost.element}
    <div className="yp-row-btns"><label>수정 범위 <select className="yp-in" disabled={running || rows.length > 0} value={scope} onChange={e => setScope(e.target.value as Scope)}>
      <option value="field">선택한 문구</option><option value="image">선택한 이미지</option><option value="page">현재 페이지</option><option value="all">전체 페이지</option></select></label>
      {scope === "field" && <label>문구 <select value={key} disabled={running || rows.length > 0} onChange={e => setFieldKey(e.target.value)}>{fields.map(f => <option key={f.key} value={f.key}>{f.label}</option>)}</select></label>}
      <button className="yp-btn" disabled={!allowed || disabled || running || rows.length > 0} onClick={() => void generate()}>{scope === "all" ? "전체 페이지 다시 만들기" : `${index + 1}장만 다시 만들기`}</button>{!page.demo && <CostTag kind="paid" />}</div>
    {scope === "all" && <p>모든 장의 잠금 해제된 문구와 지정한 장면을 새로 생성해요. 적용 전까지 현재 편집본이 유지돼요.</p>}
    {rows.map(row => <div key={row.index}><b>{row.index + 1}장 · {row.status}</b>{row.error && <p>{row.error} <button className="yp-btn" disabled={running || Boolean(stale)} onClick={() => void generate(row.index)}>이 장 재시도</button></p>}
      {row.candidate && <div className="yp-row-btns"><div>현재{preview(draft, row.index)}</div><div>수정안{preview({ ...draft, slides: draft.slides.map((s, i) => i === row.index ? row.candidate! : s) }, row.index)}</div></div>}</div>)}
    {rows.length > 0 && <div className="yp-row-btns"><button className="yp-btn" disabled={running} onClick={() => { setRows([]); snapshot.current = null; }}>취소</button>
      <button className="yp-btn yp-pri" disabled={running || disabled || Boolean(stale) || !rows.some(r => r.candidate)} onClick={() => {
        if (stale) return;
        apply({ ...draft, slides: draft.slides.map((s, i) => rows.find(row => row.index === i)?.candidate ?? s) }); setRows([]); snapshot.current = null; setMessage("완료한 수정안을 적용했어요.");
      }}>완료한 수정안 적용</button></div>}
    <p role="status">{stale ? "편집 내용이 바뀌었어요. 수정안을 취소하고 다시 생성해 주세요." : message}</p>
  </details>;
}
