"use client";
// 카드 만들기 › 그림 한꺼번에 (대표 2026-11-04): tick the 웹툰 cards to draw — the ones without a picture start ticked — and draw them in
// one go: on the company API (one click, the cost asked first) or in the PD's own ChatGPT (one sheet and one brief, then the pictures
// pasted or dropped back, each going to the next ticked card). Since 2026-11-08 ChatGPT draws them all at once and hands back one ZIP:
// put in whole, each picture goes to the card its file name says.
import { useEffect, useRef, useState } from "react";
import { Images } from "lucide-react";
import { imageEstimate } from "@/lib/cost";
import { cardsForFiles, castCharacters, myGptBatchPrompt, myGptFileName, type CardCharacterView } from "@/lib/cardnews/draw";
import { unzipImages } from "@/lib/unzip";
import type { CardDraft, CardPhoto } from "@/lib/cardnews/formats";
import { referenceSheet } from "./card-draw-panel";
import { CostTag, useCostConfirm, useCostModels } from "./cost-notice";
import type { YpPage } from "./youtube-process-frame";

type CardState = "drawing" | "done" | "fail";
const isZip = (file: File) => /\.zip$/i.test(file.name) || /zip/.test(file.type);
/** Dropped, picked or pasted files as pictures: a ZIP opens into the pictures inside it, sorted by file name. */
const pictures = async (files: File[]) => (await Promise.all(files.map(file => isZip(file) ? unzipImages(file) : file.type.startsWith("image/") ? [file] : [])))
  .flat().sort((a, b) => a.name.localeCompare(b.name, "ko", { numeric: true }));

export function CardDrawBatch({ page, projectId, draft, onPlace, onFile }: { page: YpPage; projectId: string; draft: CardDraft;
  onPlace: (index: number, photo: CardPhoto) => void; onFile: (index: number, file: File) => Promise<boolean> }) {
  const [open, setOpen] = useState(false);
  const [characters, setCharacters] = useState<CardCharacterView[] | null>(null);
  const [ticked, setTicked] = useState<number[] | null>(null);
  const [states, setStates] = useState<Record<number, CardState>>({});
  const [busy, setBusy] = useState("");
  const [mine, setMine] = useState(false);
  const [hint, setHint] = useState("");
  const [promptText, setPromptText] = useState("");
  const [dragging, setDragging] = useState(false);
  const dragTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cost = useCostConfirm();
  const model = useCostModels().image;
  const client = page.client, fail = page.fail;
  useEffect(() => {
    if (!open || characters || !client) return;
    client.cardCharacters().then(setCharacters, reason => { setCharacters([]); fail(reason); });
  }, [open, characters, client, fail]);
  const cards = draft.slides.map((slide, index) => ({ slide, index })).filter(({ slide }) => slide.type === "toon" || slide.type === "panel");
  const chosen = ticked ?? cards.filter(({ slide }) => !slide.photo).map(({ index }) => index);
  const scene = (index: number) => (draft.slides[index]?.fields.scene ?? "").trim();
  const refsOf = (index: number) => castCharacters(characters ?? [], draft.slides[index]?.fields.cast ?? "");
  const drawable = chosen.filter(index => [...scene(index)].length >= 2).sort((a, b) => a - b);
  const amount = drawable.reduce((sum, index) => sum + (imageEstimate(model, "high", refsOf(index).length) ?? 0), 0);
  const set = (index: number, state: CardState) => setStates(current => ({ ...current, [index]: state }));
  // Pictures coming back from ChatGPT go to the card their file name says (「card-05.png」), or else fill the ticked cards in order,
  // skipping the ones already filled.
  const pending = drawable.filter(index => states[index] !== "done" && states[index] !== "drawing");
  const putRef = useRef<(files: File[]) => Promise<void>>(async () => {});
  putRef.current = async raw => {
    let files: File[];
    try { files = await pictures(raw); } catch (reason) { setHint(reason instanceof Error ? reason.message : "ZIP을 열지 못했어요."); return; }
    if (!files.length) { setHint("그림 파일이나 ChatGPT가 준 ZIP만 넣을 수 있어요."); return; }
    setHint("");
    const targets = cardsForFiles(files.map(file => file.name), cards.map(({ index }) => index), pending);
    for (const [at, file] of files.entries()) {
      const index = targets[at];
      if (index === undefined) { setHint("고른 장이 모두 찼어요. 더 넣으려면 장을 더 골라요."); return; }
      set(index, "drawing");
      set(index, await onFile(index, file) ? "done" : "fail");
    }
  };

  useEffect(() => {
    if (!mine) return;
    const outside = (event: DragEvent) => !event.dataTransfer || event.dataTransfer.types.includes("application/x-card-slide") || !event.dataTransfer.types.includes("Files");
    const paste = (event: ClipboardEvent) => {
      const files = [...(event.clipboardData?.files ?? [])].filter(file => file.type.startsWith("image/") || isZip(file));
      if (files.length) { event.preventDefault(); void putRef.current(files); }
    };
    const over = (event: DragEvent) => {
      if (outside(event)) return;
      event.preventDefault(); setDragging(true);
      if (dragTimer.current) clearTimeout(dragTimer.current);
      dragTimer.current = setTimeout(() => setDragging(false), 200);
    };
    const drop = (event: DragEvent) => {
      if (outside(event)) return;
      event.preventDefault(); setDragging(false);
      void putRef.current([...(event.dataTransfer?.files ?? [])]);
    };
    window.addEventListener("paste", paste); window.addEventListener("dragover", over); window.addEventListener("drop", drop);
    return () => { window.removeEventListener("paste", paste); window.removeEventListener("dragover", over); window.removeEventListener("drop", drop); };
  }, [mine]);

  if (!client) return null;
  const run = async (what: string, work: () => Promise<void>) => { setBusy(what); try { await work(); } catch (reason) { fail(reason); } finally { setBusy(""); } };
  const drawAll = () => run("api", async () => {
    if (!await cost.confirm({ model, amount, detail: `그림 ${drawable.length}장 · 장마다 나오는 사람의 캐릭터 그림 참고`, note: "GPT 크레딧(매달 500달러)에서 나가요. 그림은 설명용이에요 — 실제 기록처럼 쓰지 않아요.", ok: `${drawable.length}장 그리기` })) return;
    const queue = [...drawable];
    // Three at a time: a picture takes about half a minute.
    await Promise.all(Array.from({ length: Math.min(3, queue.length) }, async () => {
      for (let index = queue.shift(); index !== undefined; index = queue.shift()) {
        set(index, "drawing");
        try { onPlace(index, await client.cardDraw(projectId, { scene: scene(index), style: "webtoon", quality: "high", refs: refsOf(index).map(row => row.id) })); set(index, "done"); }
        catch { set(index, "fail"); }
      }
    }));
  });
  const sheetRows = (characters ?? []).filter(row => drawable.some(index => refsOf(index).some(ref => ref.id === row.id)));
  const copySheet = () => run("sheet", async () => {
    const blob = await referenceSheet(sheetRows.map(row => row.url));
    try { await navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]); setHint(""); }
    catch {
      const link = Object.assign(document.createElement("a"), { href: URL.createObjectURL(blob), download: "참고그림.png" });
      link.click(); URL.revokeObjectURL(link.href);
      setHint("이 브라우저는 그림 복사를 막아서 「참고그림.png」로 내려받았어요. ChatGPT 대화창에 끌어다 놓아요.");
    }
  });
  const copyPrompt = () => run("prompt", async () => {
    const text = myGptBatchPrompt("webtoon", sheetRows.map(row => row.name), drawable.map(index => ({ card: `${index + 1}장`, file: myGptFileName(index), scene: scene(index), refNames: refsOf(index).map(row => row.name) })));
    try { await navigator.clipboard.writeText(text); setPromptText(""); } catch { setPromptText(text); }
  });
  const pasteBack = () => run("paste", async () => {
    try {
      const files: File[] = [];
      for (const item of await navigator.clipboard.read()) {
        const type = item.types.find(kind => kind.startsWith("image/"));
        if (type) files.push(new File([await item.getType(type)], "my-gpt.png", { type }));
      }
      if (files.length) await putRef.current(files); else setHint("복사된 그림이 없어요. ChatGPT 그림에서 「이미지 복사」를 먼저 눌러요.");
    } catch { setHint("이 브라우저는 붙여 넣기 버튼을 막아요. ⌘V를 누르거나 그림 파일을 화면에 끌어다 놓아요."); }
  });
  const next = pending[0];
  const toggle = (index: number) => setTicked(chosen.includes(index) ? chosen.filter(row => row !== index) : [...chosen, index]);
  const label = (index: number) => { const fields = draft.slides[index].fields; return (fields.talk || fields.think || fields.narration || fields.title || scene(index) || (draft.slides[index].type === "toon" ? "표지" : "칸")).replace(/\s+/g, " ").slice(0, 28); };

  if (!open) return <div className="yp-row-btns"><button type="button" className="yp-btn yp-sm" onClick={() => setOpen(true)}><Images size={13} aria-hidden="true" />그림 한꺼번에</button></div>;
  return <div className="yp-card-batch" role="group" aria-label="그림 한꺼번에">
    {dragging ? <div className="yp-card-drop" aria-hidden="true"><span>여기에 놓으면 들어가요 · ZIP은 파일 이름대로{next === undefined ? "" : `, 이름 없는 그림은 ${next + 1}장부터`}</span></div> : null}
    <p className="yp-hint">그릴 장을 골라요. 그림이 없는 장은 미리 골라 뒀어요. 장면 설명이 있어야 그릴 수 있어요.</p>
    <ul className="yp-card-batch-list">{cards.map(({ slide, index }) => { const on = chosen.includes(index), state = states[index];
      return <li key={index}><label className={on ? "yp-on" : ""}><input type="checkbox" checked={on} disabled={Boolean(busy)} onChange={() => toggle(index)} aria-label={`${index + 1}장 고르기`} />
        <b>{index + 1}장</b><span>{label(index)}</span>
        <em>{state === "drawing" ? "그리는 중…" : state === "done" ? "✓ 넣었어요" : state === "fail" ? "못 넣었어요" : slide.photo ? "그림 있음" : [...scene(index)].length < 2 ? "장면 설명 없음" : "그림 없음"}</em></label></li>; })}</ul>
    <div className="yp-row-btns">
      <button type="button" className="yp-btn yp-pri" disabled={!drawable.length || characters === null || Boolean(busy)} onClick={() => void drawAll()}>{busy === "api" ? "그리는 중 · 장마다 30초쯤" : `회사 API로 ${drawable.length}장 그리기`}</button>
      <CostTag kind="paid" amount={amount} />
      <button type="button" className="yp-btn yp-sm" aria-expanded={mine} disabled={!drawable.length || characters === null || busy === "api"} onClick={() => setMine(!mine)}>내 GPT로 한꺼번에</button>
      <CostTag kind="ai" />
      <button type="button" className="yp-btn yp-sm" disabled={Boolean(busy)} onClick={() => { setOpen(false); setMine(false); }}>닫기</button></div>
    {mine ? <ol className="yp-card-mygpt" aria-label="내 GPT로 한꺼번에">
      <li><b>1</b><button type="button" className="yp-btn yp-sm" disabled={!sheetRows.length || Boolean(busy)} onClick={() => void copySheet()}>{busy === "sheet" ? "만드는 중…" : "참고 그림 복사"}</button>
        <span className="yp-hint"><a href="https://chatgpt.com/" target="_blank" rel="noreferrer">ChatGPT</a> 새 대화창에 붙여 넣어요 (⌘V)</span></li>
      <li><b>2</b><button type="button" className="yp-btn yp-sm" disabled={Boolean(busy)} onClick={() => void copyPrompt()}>그림 설명 복사 ({drawable.length}장)</button>
        <span className="yp-hint">이어서 붙여 넣고 보내요. 전부 그려서 ZIP 하나로 줘요 — 장 수가 많으면 수십 분 걸려요</span></li>
      <li><b>3</b><label className="yp-btn yp-sm">받은 ZIP 넣기
        <input type="file" accept=".zip,application/zip,image/png,image/jpeg,image/webp" multiple hidden aria-label="받은 ZIP · 그림 파일" onChange={event => { void putRef.current([...(event.target.files ?? [])]); event.target.value = ""; }} /></label>
        <button type="button" className="yp-btn yp-sm" disabled={Boolean(busy)} onClick={() => void pasteBack()}>그림 한 장 붙여 넣기</button>
        <span className="yp-hint">ChatGPT가 준 ZIP을 내려받아 고르거나 화면에 끌어다 놓아요. 파일 이름대로 장에 들어가요. 그림 한 장은 「이미지 복사」 후 ⌘V. {next === undefined ? "고른 장이 모두 찼어요" : `이름 없는 그림은 ${next + 1}장부터 들어가요`}</span></li>
      {hint ? <li className="yp-card-mygpt-note" role="status">{hint}</li> : null}
    </ol> : null}
    {promptText ? <label className="yp-field"><span className="yp-fld-h"><b>한꺼번에 그림 설명</b></span>
      <span className="yp-hint">이 브라우저는 자동 복사를 막아요. 아래 글을 누르면 전부 선택돼요. 복사해서 ChatGPT에 붙여 넣어요.</span>
      <textarea className="yp-in" rows={6} readOnly value={promptText} aria-label="한꺼번에 그림 설명" onFocus={event => event.currentTarget.select()} /></label> : null}
    {cost.element}
  </div>;
}
