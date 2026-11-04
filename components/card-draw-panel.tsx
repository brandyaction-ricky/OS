"use client";
// 카드 만들기 › 사진 › AI로 그리기 (대표 2026-11-02): the PD writes the scene, picks 캐릭터 창고 pictures to keep the faces, and GPT draws
// one picture for the card. A picture already on the card can be kept in the 창고 under a name (캐릭터로 저장).
import { useEffect, useRef, useState, type ReactNode } from "react";
import { Sparkles, X } from "lucide-react";
import { imageEstimate } from "@/lib/cost";
import { CARD_DRAW_QUALITY, CARD_DRAW_REFS_MAX, CARD_DRAW_SCENE_MAX, CARD_DRAW_STYLES, castCharacters, myGptDrawPrompt, type CardCharacterView, type CardDrawQuality, type CardDrawStyle } from "@/lib/cardnews/draw";
import type { CardPhoto } from "@/lib/cardnews/formats";
import { CostTag, useCostConfirm, useCostModels } from "./cost-notice";
import type { YpPage } from "./youtube-process-frame";

/** The picked 창고 pictures side by side in one PNG, the order they were picked: 「내 GPT로 그리기」 pastes it into ChatGPT. */
export async function referenceSheet(urls: string[]) {
  const pictures = await Promise.all(urls.map(async url => createImageBitmap(await (await fetch(url)).blob())));
  const height = 768, gap = 24, widths = pictures.map(picture => Math.round(picture.width * height / picture.height));
  const canvas = document.createElement("canvas");
  canvas.width = widths.reduce((sum, width) => sum + width, 0) + gap * (pictures.length - 1); canvas.height = height;
  const context = canvas.getContext("2d")!;
  context.fillStyle = "#fff"; context.fillRect(0, 0, canvas.width, height);
  pictures.reduce((x, picture, index) => { context.drawImage(picture, x, 0, widths[index], height); picture.close(); return x + widths[index] + gap; }, 0);
  return new Promise<Blob>((resolve, reject) => canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error("참고 그림을 만들지 못했어요.")), "image/png"));
}

/** `children`: the photo buttons the 「AI로 그리기」 button sits beside. `brief`: a 웹툰 card's own 장면 and 나오는 사람. `onFile`: puts a pasted or
 * dropped picture on the card (true once it is there). `label`: the card, as 「22장」. */
export function CardDrawPanel({ page, projectId, photo, onPhoto, onFile, label, brief, defaultStyle = "simple", children }: { page: YpPage; projectId: string; photo?: CardPhoto;
  onPhoto: (photo: CardPhoto) => void; onFile: (file: File) => Promise<boolean>; label: string; brief?: { scene: string; cast: string }; defaultStyle?: CardDrawStyle; children: ReactNode }) {
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
  // The card whose words were copied last: a picture coming back while another card is open is asked about first (11-04: a 1장 picture landed on 22장).
  const [copiedFor, setCopiedFor] = useState("");
  // The picture coming back from ChatGPT: where it is (올리는 중 · 넣었어요 with a thumbnail · 못 넣었어요), and a file being dragged over the page.
  const [placed, setPlaced] = useState<{ state: "busy" | "done" | "fail"; preview?: string } | null>(null);
  const [dragging, setDragging] = useState(false);
  const dragTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const putRef = useRef<(file: File) => Promise<void>>(async () => {});
  putRef.current = async (file: File) => {
    if (copiedFor && copiedFor !== label && !window.confirm(`${copiedFor} 그림 설명으로 그린 그림 같아요. ${label}에 넣을까요?`)) return;
    setPlaced({ state: "busy" });
    const preview = URL.createObjectURL(file);
    if (await onFile(file)) { setPlaced({ state: "done", preview }); setHint(""); setDone(current => current.includes("paste") ? current : [...current, "paste"]); }
    else { URL.revokeObjectURL(preview); setPlaced({ state: "fail" }); }
  };
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
    setRefs(castCharacters(characters, briefCast).map(row => row.id));
  }, [characters, briefCast]);
  // While 「내 GPT로 그리기」 is open, ⌘V anywhere (a text box gets only text) or a picture dropped anywhere on the page goes on the card;
  // a dragged file lights the whole page so it is clear where it lands. Reordering cards (their own drag type) is left alone.
  useEffect(() => {
    if (!mine) return;
    const image = (files?: FileList | null) => [...(files ?? [])].find(row => row.type.startsWith("image/"));
    const outside = (event: DragEvent) => !event.dataTransfer || event.dataTransfer.types.includes("application/x-card-slide")
      || !["Files", "text/uri-list"].some(type => event.dataTransfer!.types.includes(type));
    const paste = (event: ClipboardEvent) => { const file = image(event.clipboardData?.files); if (file) { event.preventDefault(); void putRef.current(file); } };
    const over = (event: DragEvent) => {
      if (outside(event)) return;
      event.preventDefault(); setDragging(true);
      if (dragTimer.current) clearTimeout(dragTimer.current);
      dragTimer.current = setTimeout(() => setDragging(false), 200);
    };
    const drop = async (event: DragEvent) => {
      if (outside(event)) return;
      event.preventDefault(); setDragging(false);
      const file = image(event.dataTransfer?.files);
      if (file) { void putRef.current(file); return; }
      // A picture dragged straight from a web page arrives as its address; it can be read only when that site allows it.
      const address = event.dataTransfer?.getData("text/uri-list").split("\n").find(line => /^https?:/.test(line.trim()));
      const blob = address ? await fetch(address.trim()).then(response => response.ok ? response.blob() : null, () => null) : null;
      if (blob?.type.startsWith("image/")) void putRef.current(new File([blob], "my-gpt.png", { type: blob.type }));
      else setHint("이 그림은 바로 끌어올 수 없어요. ChatGPT에서 그림을 내려받아 그 파일을 끌어다 놓거나, 「이미지 복사」 후 ⌘V를 눌러요.");
    };
    window.addEventListener("paste", paste); window.addEventListener("dragover", over); window.addEventListener("drop", drop);
    return () => { window.removeEventListener("paste", paste); window.removeEventListener("dragover", over); window.removeEventListener("drop", drop); };
  }, [mine]);
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
    setCopiedFor(label); step("prompt");
  });
  const pasteBack = () => run("paste", async () => {
    try {
      for (const item of await navigator.clipboard.read()) {
        const type = item.types.find(kind => kind.startsWith("image/"));
        if (type) { await putRef.current(new File([await item.getType(type)], "my-gpt.png", { type })); return; }
      }
      setHint("복사된 그림이 없어요. ChatGPT 그림에서 「이미지 복사」를 먼저 눌러요.");
    } catch { setHint("이 브라우저는 붙여 넣기 버튼을 막아요. ⌘V(윈도우는 Ctrl+V)를 눌러 붙여 넣거나 그림 파일을 여기에 끌어다 놓아요."); }
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
    {dragging ? <div className="yp-card-drop" aria-hidden="true"><span>여기에 놓으면 {label}에 들어가요</span></div> : null}
    {mine ? <ol className="yp-card-mygpt" aria-label="내 GPT로 그리기">
      <li className={done.includes("sheet") ? "yp-on" : ""}><b>1</b><button type="button" className="yp-btn yp-sm" disabled={!picked.length || Boolean(busy)} onClick={() => void copySheet()}>{busy === "sheet" ? "만드는 중…" : "참고 그림 복사"}</button>
        <span className="yp-hint">{picked.length ? <><a href="https://chatgpt.com/" target="_blank" rel="noreferrer">ChatGPT</a> 새 대화창에 붙여 넣어요 (⌘V)</> : "고른 캐릭터 그림이 없어요 — 2번부터 해요"}</span></li>
      <li className={done.includes("prompt") ? "yp-on" : ""}><b>2</b><button type="button" className="yp-btn yp-sm" disabled={Boolean(busy)} onClick={() => void copyPrompt()}>그림 설명 복사</button>
        <span className="yp-hint">이어서 붙여 넣고 보내요. 다 그려질 때까지 1~2분 기다려요</span></li>
      <li className={done.includes("paste") ? "yp-on" : ""}><b>3</b><button type="button" className="yp-btn yp-sm" disabled={Boolean(busy)} onClick={() => void pasteBack()}>그린 그림 붙여 넣기</button>
        <span className="yp-hint">ChatGPT 그림에서 「이미지 복사」를 누르고 여기를 눌러요. 그림 파일을 화면 아무 곳에 끌어다 놓아도 돼요</span></li>
      {placed ? <li className="yp-card-mygpt-placed" role="status">{placed.state === "busy" ? "올리는 중…" : placed.state === "fail" ? "넣지 못했어요. 다시 해 주세요."
        // eslint-disable-next-line @next/next/no-img-element -- the picture just put on the card, from the PD's own computer
        : <><img src={placed.preview} alt="" />✓ {label}에 넣었어요 · 위 미리보기에서 확인해요</>}</li> : null}
      {hint ? <li className="yp-card-mygpt-note" role="status">{hint}</li> : null}
    </ol> : null}
    {promptText ? <label className="yp-field"><span className="yp-fld-h"><b>그림 설명</b></span>
      <span className="yp-hint">이 브라우저는 자동 복사를 막아요. 아래 글을 누르면 전부 선택돼요. 복사해서 ChatGPT에 붙여 넣어요.</span>
      <textarea className="yp-in" rows={6} readOnly value={promptText} aria-label="그림 설명" onFocus={event => event.currentTarget.select()} /></label> : null}
    {cost.element}
  </div></>;
}
