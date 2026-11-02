"use client";
// 카드 만들기 › 사진 › AI로 그리기 (대표 2026-11-02): the PD writes the scene, picks 캐릭터 창고 pictures to keep the faces, and GPT draws
// one picture for the card. A picture already on the card can be kept in the 창고 under a name (캐릭터로 저장).
import { useEffect, useState, type ReactNode } from "react";
import { Sparkles, X } from "lucide-react";
import { imageEstimate } from "@/lib/cost";
import { CARD_DRAW_QUALITY, CARD_DRAW_REFS_MAX, CARD_DRAW_SCENE_MAX, CARD_DRAW_STYLES, type CardCharacterView, type CardDrawQuality, type CardDrawStyle } from "@/lib/cardnews/draw";
import type { CardPhoto } from "@/lib/cardnews/formats";
import { CostTag, useCostConfirm, useCostModels } from "./cost-notice";
import type { YpPage } from "./youtube-process-frame";

/** `children`: the photo buttons the 「AI로 그리기」 button sits beside. */
export function CardDrawPanel({ page, projectId, photo, onPhoto, children }: { page: YpPage; projectId: string; photo?: CardPhoto; onPhoto: (photo: CardPhoto) => void; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const [scene, setScene] = useState("");
  const [style, setStyle] = useState<CardDrawStyle>("webtoon");
  const [quality, setQuality] = useState<CardDrawQuality>("medium");
  const [refs, setRefs] = useState<string[]>([]);
  const [characters, setCharacters] = useState<CardCharacterView[] | null>(null);
  const [busy, setBusy] = useState("");
  const [name, setName] = useState("");
  const cost = useCostConfirm();
  const model = useCostModels().image;
  const amount = imageEstimate(model, quality, refs.length);
  const client = page.client, fail = page.fail;
  useEffect(() => {
    if (!open || characters || !client) return;
    client.cardCharacters().then(setCharacters, reason => { setCharacters([]); fail(reason); });
  }, [open, characters, client, fail]);
  if (!client) return <div className="yp-row-btns">{children}</div>;
  const run = async (what: string, work: () => Promise<void>) => { setBusy(what); try { await work(); } catch (reason) { page.fail(reason); } finally { setBusy(""); } };
  const draw = () => run("draw", async () => {
    if (!await cost.confirm({ model, amount, detail: `그림 1장${refs.length ? ` · 캐릭터 그림 ${refs.length}장 참고` : ""}`, note: "GPT 크레딧(매달 500달러)에서 나가요. 그림은 설명용이에요 — 실제 기록처럼 쓰지 않아요.", ok: "그리기" })) return;
    onPhoto(await client.cardDraw(projectId, { scene: scene.trim(), style, quality, refs }));
  });
  const keep = () => run("keep", async () => {
    if (!photo) return;
    setCharacters(await client.addCardCharacter({ projectId, path: photo.path, name: name.trim() }));
    setName("");
  });
  const drop = (row: CardCharacterView) => run("drop", async () => {
    if (!window.confirm(`캐릭터 그림 「${row.name}」을 창고에서 뺄까요?`)) return;
    setCharacters(await client.removeCardCharacter(row.id));
    setRefs(current => current.filter(id => id !== row.id));
  });
  const row = <div className="yp-row-btns">{children}{open ? null : <button type="button" className="yp-btn yp-sm" onClick={() => setOpen(true)}><Sparkles size={13} aria-hidden="true" />AI로 그리기</button>}</div>;
  if (!open) return <>{row}{cost.element}</>;
  return <>{row}<div className="yp-card-draw" role="group" aria-label="AI로 그리기">
    <label className="yp-field"><span className="yp-fld-h"><b>어떤 장면인가요?</b><span className="yp-card-n">{[...scene].length}/{CARD_DRAW_SCENE_MAX}</span></span>
      <textarea className="yp-in" rows={3} maxLength={CARD_DRAW_SCENE_MAX} aria-label="장면 설명" value={scene} placeholder="예) 밤 11시 사무실, 한결이 모니터 앞에서 「괜찮아요」라고 웃는데 책상 밑에서 낙서 캐릭터가 빼꼼 내다봐요" onChange={event => setScene(event.target.value)} /></label>
    <div className="yp-row-btns">
      <select aria-label="그림체" value={style} onChange={event => setStyle(event.target.value as CardDrawStyle)}>
        {(Object.keys(CARD_DRAW_STYLES) as CardDrawStyle[]).map(key => <option key={key} value={key}>{CARD_DRAW_STYLES[key].label}</option>)}</select>
      <select aria-label="품질" value={quality} onChange={event => setQuality(event.target.value as CardDrawQuality)}>
        {(Object.keys(CARD_DRAW_QUALITY) as CardDrawQuality[]).map(key => <option key={key} value={key}>{CARD_DRAW_QUALITY[key]}</option>)}</select></div>
    <fieldset className="yp-card-chars"><legend>캐릭터 창고 · 같은 얼굴로 그릴 그림 (최대 {CARD_DRAW_REFS_MAX}장)</legend>
      {characters === null ? <p className="yp-hint">불러오는 중…</p> : characters.length ? <ul>{characters.map(row => { const on = refs.includes(row.id);
        return <li key={row.id}><label className={on ? "yp-on" : ""}>
          <input type="checkbox" aria-label={row.name} checked={on} disabled={!on && refs.length >= CARD_DRAW_REFS_MAX} onChange={() => setRefs(on ? refs.filter(id => id !== row.id) : [...refs, row.id])} />
          {/* eslint-disable-next-line @next/next/no-img-element -- a signed storage address, shown as is */}
          <img src={row.url} alt="" /><span>{row.name}</span></label>
          <button type="button" aria-label={`${row.name} 빼기`} title="창고에서 빼기" disabled={Boolean(busy)} onClick={() => void drop(row)}><X size={12} /></button></li>; })}</ul>
        : <p className="yp-hint">아직 없어요. 마음에 드는 그림을 카드에 넣고 아래 「캐릭터로 저장」을 누르면, 다음부터 같은 얼굴로 그려요.</p>}</fieldset>
    {photo ? <div className="yp-row-btns">
      <input className="yp-in" aria-label="캐릭터 이름" maxLength={40} placeholder="이 장의 그림을 캐릭터로 저장 · 이름 (예: 한결 앞모습)" value={name} onChange={event => setName(event.target.value)} />
      <button type="button" className="yp-btn yp-sm" disabled={!name.trim() || Boolean(busy)} onClick={() => void keep()}>{busy === "keep" ? "저장 중…" : "캐릭터로 저장"}</button></div> : null}
    <div className="yp-row-btns">
      <button type="button" className="yp-btn yp-pri" disabled={[...scene.trim()].length < 2 || Boolean(busy)} onClick={() => void draw()}>{busy === "draw" ? "그리는 중 · 1~2분" : photo ? "다시 그리기" : "그리기"}</button>
      <CostTag kind="paid" amount={amount} />
      <button type="button" className="yp-btn yp-sm" disabled={busy === "draw"} onClick={() => setOpen(false)}>닫기</button></div>
    {cost.element}
  </div></>;
}
