"use client";
// 카드 만들기 › 사진 › AI로 그리기 (대표 2026-11-02): the PD writes the scene, picks 캐릭터 창고 pictures to keep the faces, and GPT draws
// one picture for the card. A picture already on the card can be kept in the 창고 under a name (캐릭터로 저장).
import { useEffect, useState, type DragEvent, type ReactNode } from "react";
import { Sparkles, X } from "lucide-react";
import { imageEstimate } from "@/lib/cost";
import { CARD_DRAW_QUALITY, CARD_DRAW_REFS_MAX, CARD_DRAW_SCENE_MAX, CARD_DRAW_STYLES, myGptDrawPrompt, type CardCharacterView, type CardDrawQuality, type CardDrawStyle } from "@/lib/cardnews/draw";
import type { CardPhoto } from "@/lib/cardnews/formats";
import { CostTag, useCostConfirm, useCostModels } from "./cost-notice";
import type { YpPage } from "./youtube-process-frame";

/** The picked 창고 pictures side by side in one PNG, the order they were picked: 「내 GPT로 그리기」 pastes it into ChatGPT. */
async function referenceSheet(urls: string[]) {
  const pictures = await Promise.all(urls.map(async url => createImageBitmap(await (await fetch(url)).blob())));
  const height = 768, gap = 24, widths = pictures.map(picture => Math.round(picture.width * height / picture.height));
  const canvas = document.createElement("canvas");
  canvas.width = widths.reduce((sum, width) => sum + width, 0) + gap * (pictures.length - 1); canvas.height = height;
  const context = canvas.getContext("2d")!;
  context.fillStyle = "#fff"; context.fillRect(0, 0, canvas.width, height);
  pictures.reduce((x, picture, index) => { context.drawImage(picture, x, 0, widths[index], height); picture.close(); return x + widths[index] + gap; }, 0);
  return new Promise<Blob>((resolve, reject) => canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error("참고 그림을 만들지 못했어요.")), "image/png"));
}

/** `children`: the photo buttons the 「AI로 그리기」 button sits beside. `brief`: a 웹툰 card's own 장면 and 나오는 사람. `onFile`: a picture the PD pastes or drops in. */
export function CardDrawPanel({ page, projectId, photo, onPhoto, onFile, brief, defaultStyle = "simple", children }: { page: YpPage; projectId: string; photo?: CardPhoto;
  onPhoto: (photo: CardPhoto) => void; onFile: (file: File) => void; brief?: { scene: string; cast: string }; defaultStyle?: CardDrawStyle; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const [scene, setScene] = useState("");
  const [style, setStyle] = useState<CardDrawStyle>(defaultStyle);
  const [quality, setQuality] = useState<CardDrawQuality>("medium");
  const [refs, setRefs] = useState<string[]>([]);
  const [characters, setCharacters] = useState<CardCharacterView[] | null>(null);
  const [busy, setBusy] = useState("");
  const [name, setName] = useState("");
  // 「내 GPT로 그리기」: three steps in the PD's own ChatGPT (copy the reference picture, copy the words, paste the picture back).
  const [mine, setMine] = useState(false);
  const [done, setDone] = useState<string[]>([]);
  const [hint, setHint] = useState("");
  const [promptText, setPromptText] = useState("");
  const cost = useCostConfirm();
  const model = useCostModels().image;
  const amount = imageEstimate(model, quality, refs.length);
  const client = page.client, fail = page.fail;
  useEffect(() => {
    if (!open || characters || !client) return;
    client.cardCharacters().then(setCharacters, reason => { setCharacters([]); fail(reason); });
  }, [open, characters, client, fail]);
  // A 웹툰 card fills the box with its 장면 and ticks the 창고 pictures whose names carry its 나오는 사람 (「낙서」 finds the 낙서 sheet).
  const briefScene = brief?.scene.trim() ?? "", briefCast = brief?.cast.trim() ?? "";
  useEffect(() => { if (briefScene) setScene(briefScene); }, [briefScene]);
  useEffect(() => {
    if (!characters || !briefCast) return;
    const names = briefCast.split(/[\s,·]+/).filter(Boolean);
    setRefs(characters.filter(row => names.some(name => row.name.includes(name))).slice(0, CARD_DRAW_REFS_MAX).map(row => row.id));
  }, [characters, briefCast]);
  // While 「내 GPT로 그리기」 is open, ⌘V anywhere (a text box gets only text) puts the copied picture on the card.
  useEffect(() => {
    if (!mine) return;
    const paste = (event: ClipboardEvent) => {
      const file = [...(event.clipboardData?.files ?? [])].find(row => row.type.startsWith("image/"));
      if (!file) return;
      event.preventDefault(); onFile(file);
      setDone(current => current.includes("paste") ? current : [...current, "paste"]);
    };
    window.addEventListener("paste", paste);
    return () => window.removeEventListener("paste", paste);
  }, [mine, onFile]);
  if (!client) return <div className="yp-row-btns">{children}</div>;
  const run = async (what: string, work: () => Promise<void>) => { setBusy(what); try { await work(); } catch (reason) { page.fail(reason); } finally { setBusy(""); } };
  const draw = () => run("draw", async () => {
    if (!await cost.confirm({ model, amount, detail: `그림 1장${refs.length ? ` · 캐릭터 그림 ${refs.length}장 참고` : ""}`, note: "GPT 크레딧(매달 500달러)에서 나가요. 그림은 설명용이에요 — 실제 기록처럼 쓰지 않아요.", ok: "그리기" })) return;
    onPhoto(await client.cardDraw(projectId, { scene: scene.trim(), style, quality, refs }));
  });
  const picked = refs.map(id => characters?.find(row => row.id === id)).filter((row): row is CardCharacterView => Boolean(row));
  const step = (key: string) => setDone(current => current.includes(key) ? current : [...current, key]);
  // Some browsers keep the clipboard closed (the app's own browser pane): the sheet is saved as a file and the words shown to copy by hand.
  const copySheet = () => run("sheet", async () => {
    const blob = await referenceSheet(picked.map(row => row.url));
    try { await navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]); setHint(""); }
    catch {
      const link = Object.assign(document.createElement("a"), { href: URL.createObjectURL(blob), download: "참고그림.png" });
      link.click(); URL.revokeObjectURL(link.href);
      setHint("이 브라우저는 그림 복사를 막아서 「참고그림.png」로 내려받았어요. ChatGPT 대화창에 끌어다 놓아요.");
    }
    step("sheet");
  });
  const copyPrompt = () => run("prompt", async () => {
    const text = myGptDrawPrompt(scene, style, picked.map(row => row.name));
    try { await navigator.clipboard.writeText(text); setPromptText(""); } catch { setPromptText(text); }
    step("prompt");
  });
  const pasteBack = () => run("paste", async () => {
    try {
      for (const item of await navigator.clipboard.read()) {
        const type = item.types.find(kind => kind.startsWith("image/"));
        if (type) { onFile(new File([await item.getType(type)], "my-gpt.png", { type })); step("paste"); setHint(""); return; }
      }
      setHint("복사된 그림이 없어요. ChatGPT 그림에서 「이미지 복사」를 먼저 눌러요.");
    } catch { setHint("이 브라우저는 붙여 넣기 버튼을 막아요. ⌘V(윈도우는 Ctrl+V)를 눌러 붙여 넣거나 그림 파일을 여기에 끌어다 놓아요."); }
  });
  const dropped = (event: DragEvent) => {
    const file = [...event.dataTransfer.files].find(row => row.type.startsWith("image/"));
    if (!file) return;
    event.preventDefault(); onFile(file); step("paste");
  };
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
  // 「내 GPT로 그리기」 sits beside 「AI로 그리기」 from the start (대표 2026-11-04: inside the panel nobody found it) and opens its steps.
  const row = <div className="yp-row-btns">{children}{open ? null : <>
    <button type="button" className="yp-btn yp-sm" onClick={() => setOpen(true)}><Sparkles size={13} aria-hidden="true" />AI로 그리기</button>
    <button type="button" className="yp-btn yp-sm" onClick={() => { setOpen(true); setMine(true); }}>내 GPT로 그리기</button><CostTag kind="ai" /></>}</div>;
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
      <button type="button" className="yp-btn yp-sm" aria-expanded={mine} disabled={[...scene.trim()].length < 2 || characters === null} onClick={() => setMine(!mine)}>내 GPT로 그리기</button>
      <CostTag kind="ai" />
      <button type="button" className="yp-btn yp-sm" disabled={busy === "draw"} onClick={() => setOpen(false)}>닫기</button></div>
    {mine ? <ol className="yp-card-mygpt" aria-label="내 GPT로 그리기" onDragOver={event => event.preventDefault()} onDrop={dropped}>
      <li className={done.includes("sheet") ? "yp-on" : ""}><b>1</b><button type="button" className="yp-btn yp-sm" disabled={!picked.length || Boolean(busy)} onClick={() => void copySheet()}>{busy === "sheet" ? "만드는 중…" : "참고 그림 복사"}</button>
        <span className="yp-hint">{picked.length ? <><a href="https://chatgpt.com/" target="_blank" rel="noreferrer">ChatGPT</a> 새 대화창에 붙여 넣어요 (⌘V)</> : "고른 캐릭터 그림이 없어요 — 2번부터 해요"}</span></li>
      <li className={done.includes("prompt") ? "yp-on" : ""}><b>2</b><button type="button" className="yp-btn yp-sm" disabled={Boolean(busy)} onClick={() => void copyPrompt()}>그림 설명 복사</button>
        <span className="yp-hint">이어서 붙여 넣고 보내요. 다 그려질 때까지 1~2분 기다려요</span></li>
      <li className={done.includes("paste") ? "yp-on" : ""}><b>3</b><button type="button" className="yp-btn yp-sm" disabled={Boolean(busy)} onClick={() => void pasteBack()}>그린 그림 붙여 넣기</button>
        <span className="yp-hint">ChatGPT 그림에서 「이미지 복사」를 누르고 여기를 눌러요. 그림 파일을 이 칸에 끌어다 놓아도 돼요</span></li>
      {hint ? <li className="yp-card-mygpt-note" role="status">{hint}</li> : null}
    </ol> : null}
    {promptText ? <label className="yp-field"><span className="yp-fld-h"><b>그림 설명</b></span>
      <span className="yp-hint">이 브라우저는 자동 복사를 막아요. 아래 글을 누르면 전부 선택돼요. 복사해서 ChatGPT에 붙여 넣어요.</span>
      <textarea className="yp-in" rows={6} readOnly value={promptText} aria-label="그림 설명" onFocus={event => event.currentTarget.select()} /></label> : null}
    {cost.element}
  </div></>;
}
