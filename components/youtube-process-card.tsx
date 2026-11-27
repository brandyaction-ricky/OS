"use client";
import { CardCanonContext } from "./card-canon-context";
import { CanonRail } from "./canon-rail";
// 카드뉴스 (설계서 2026-10-30): 주제 → 카드 만들기 → 최종 검토 → 내보내기. Cards are written and seen in one place: the preview is the
// same drawing the PNG uses (lib/cardnews/card-slide), so what the PD sees is what gets downloaded.
import "./youtube-process-card.css";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createContext, Fragment, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState, type MouseEvent, type ReactNode } from "react";
import { ArrowDown, ArrowRight, ArrowUp, Copy, Download, GalleryHorizontal, ImagePlus, Plus, Trash2 } from "lucide-react";
import { CardSlideView } from "@/lib/cardnews/card-slide";
import { formatSample } from "@/lib/cardnews/format-sample";
import { mondayFields, planningOutline } from "@/lib/cardnews/planning";
import { cardPublicationProgress, cardsMissing, instagramPostId } from "@/lib/cardnews/cards";
import { GUIDE_CAST, MYIN_CAST, type CharacterScene, type MyinCharacter, addCardSlide, CARD_FORMAT_IDS, CARD_FORMATS, CARD_SIZE, firstCardLine, cardLetters, cardMaxSlides, cardProblems, moveCardSlide, parseCardHashtags, removeCardSlide, slideSpec, TOON_AIM, toonBattery, toonUploads, type CardDraft, type CardFormatId, type CardPhoto } from "@/lib/cardnews/formats";
import { isCardTestProject, type CardSourceChoice } from "@/lib/cardnews/sources";
import { apiRequest } from "@/lib/api-client";
import { modelName } from "@/lib/cost";
import { draftTag, GPT_TIERS, type GptTier } from "@/lib/youtube-process/gpt-draft";
import type { YpScreenCheck } from "@/lib/youtube-process/stages";
import { groupScreenIssues } from "@/lib/youtube-screen-check";
import { projectName, stepHref, type YpProject } from "@/lib/youtube-process/project";
import { CostTag, tokenEstimate, useCostConfirm } from "./cost-notice";
import { useSession } from "./session-provider";
import { JobLine, SendDialog, useStaffJob } from "./youtube-process-ai";
import { errorMessage, youtubeProcessClient, type YpClient } from "./youtube-process-data";
import { CardDrawBatch } from "./card-draw-batch";
import { CardDrawPanel } from "./card-draw-panel";
import { CardSourcePicker } from "./card-source-picker";
import { channelFormats } from "@/lib/youtube-process/channel-style";
import { useChannelCards } from "./youtube-channel-styles";
import { CardUrlBookmarks } from "./card-url-bookmarks";
import { GateBanner, gateAction, gateSub, LockedStep, stepAction, Subject, useGate, useLeaveGuard, YpFrame, YpSection, type YpPage } from "./youtube-process-frame";

const SOURCE_NAME = { longform: "롱폼", short: "숏폼", threads: "스레드", none: "" } as const;

/** Card photos by path → an address the browser can load. Screens that show a project's own cards provide it; elsewhere a photo is a grey box. */
const CardPhotos = createContext<Record<string, string>>({});
// Signed addresses last an hour; one is reused for 50 minutes so moving between cards and steps asks again only for new photos.
const signedPhotos = new Map<string, { until: number; url: Promise<string> }>();
function useCardPhotoUrls(page: YpPage, drafts: (CardDraft | null | undefined)[]) {
  const [urls, setUrls] = useState<Record<string, string>>({});
  const client = page.client, projectId = page.bundle?.project.id;
  const paths = [...new Set(drafts.flatMap(draft => draft?.slides.flatMap(slide => slide.photo ? [slide.photo.path] : []) ?? []))].sort().join("\n");
  useEffect(() => {
    if (!client || !projectId || !paths) return;
    let live = true;
    void Promise.all(paths.split("\n").map(async path => {
      let hit = signedPhotos.get(path);
      if (!hit || hit.until < Date.now()) { hit = { until: Date.now() + 50 * 60_000, url: client.assetUrl(projectId, path) }; signedPhotos.set(path, hit); }
      return [path, await hit.url.catch(() => { signedPhotos.delete(path); return ""; })] as const;
    })).then(rows => { if (live) setUrls(current => ({ ...current, ...Object.fromEntries(rows.filter(([, url]) => url)) })); });
    return () => { live = false; };
  }, [client, projectId, paths]);
  return urls;
}

/** A photo shrunk in the browser before it goes up (a card shows it at most 864px wide): JPEG, or PNG when it may be a cut-out (누끼). */
async function shrinkPhoto(file: File) {
  const bitmap = await createImageBitmap(file).catch(() => { throw new Error("이 사진은 열 수 없어요. JPG나 PNG로 넣어 주세요."); });
  const scale = Math.min(1, 1296 / Math.max(bitmap.width, bitmap.height));
  const w = Math.max(1, Math.round(bitmap.width * scale)), h = Math.max(1, Math.round(bitmap.height * scale));
  const canvas = document.createElement("canvas");
  canvas.width = w; canvas.height = h;
  canvas.getContext("2d")?.drawImage(bitmap, 0, 0, w, h);
  bitmap.close();
  const png = file.type === "image/png";
  const blob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, png ? "image/png" : "image/jpeg", 0.86));
  if (!blob) throw new Error("사진을 줄이지 못했어요. 다른 사진으로 해 주세요.");
  return { file: new File([blob], `${file.name.replace(/\.[^.]+$/, "") || "photo"}.${png ? "png" : "jpg"}`, { type: blob.type }), w, h };
}

/** One card at `width` px, drawn at 1080 × 1350 and scaled; reports the fields whose text runs past their lines. */
export function CardPreview({ draft, index, width, onOver }: { draft: CardDraft; index: number; width: number; onOver?: (index: number, fields: string[]) => void }) {
  const box = useRef<HTMLDivElement>(null);
  const photos = useContext(CardPhotos);
  const report = useRef(onOver);
  useEffect(() => { report.current = onOver; }, [onOver]);
  useLayoutEffect(() => {
    let live = true;
    const measure = () => { if (!live || !box.current) return;
      report.current?.(index, [...box.current.querySelectorAll<HTMLElement>("[data-card-field]")].filter(el => el.scrollHeight > el.clientHeight + 1).map(el => el.dataset.cardField ?? "")); };
    measure();
    void document.fonts?.ready.then(measure);
    return () => { live = false; };
  }, [draft, index]);
  const scale = width / CARD_SIZE.width;
  return <div className="yp-card-pv" style={{ width, height: Math.round(CARD_SIZE.height * scale) }} ref={box}>
    <div style={{ transform: `scale(${scale})`, transformOrigin: "0 0", width: CARD_SIZE.width, height: CARD_SIZE.height }}><CardSlideView draft={draft} index={index} photos={photos} /></div>
  </div>;
}

/** 주제 찾기 › 카드뉴스: a topic of its own (the other three ways in are buttons on a finished video or an approved Threads post). */
export function CardStart({ initial = "", sheet = false }: { initial?: string; sheet?: boolean }) {
  const { accessToken, demo } = useSession();
  const client = useMemo(() => youtubeProcessClient(accessToken, demo), [accessToken, demo]);
  const router = useRouter();
  const [form, setForm] = useState({ title: initial, target: "", note: "", channel: "" });
  // 다채널 1단계: the channels that run 카드뉴스; a 카드뉴스 from a video takes that video's channel.
  const channels = useChannelCards().filter(card => channelFormats(card).includes("card"));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [projects, setProjects] = useState<YpProject[] | null>(null);
  const [tab, setTab] = useState<"open" | "done">("open");
  useEffect(() => { let active = true; if (client && !sheet) client.list().then(rows => { if (active) setProjects(rows); }, reason => { if (active) setError(errorMessage(reason)); }); return () => { active = false; }; }, [client, sheet]);
  const [entry, setEntry] = useState<"source" | "new">("source");
  const bring = async (source: CardSourceChoice, focus: string) => {
    if (!client || busy) return;
    setBusy(true); setError("");
    try { const made = await client.createCard(source.from === "project" ? { from: "project", projectId: source.id, focus } : { from: "threads", itemId: source.id, focus }); router.push(stepHref(1, made.id)); }
    catch (reason) { setError(errorMessage(reason)); } finally { setBusy(false); }
  };
  const start = async () => {
    if (!client) return;
    setBusy(true); setError("");
    const channel = form.channel || channels[0]?.id;
    try { const made = await client.createCard({ from: "none", title: form.title.trim(), target: form.target.trim(), note: form.note.trim(), ...(channel ? { channel } : {}) }); router.push(stepHref(1, made.id)); }
    catch (reason) { setError(errorMessage(reason)); setBusy(false); }
  };
  const open = (projects ?? []).filter(project => !isCardTestProject(project) && project.yp.topic.type === "card" && project.yp.stage !== "done");
  const done = (projects ?? []).filter(project => !isCardTestProject(project) && project.yp.topic.type === "card" && project.yp.stage === "done" && project.yp.cardPublication?.status === "published");
  const ready = form.title.trim().length >= 2 && form.target.trim().length > 0;
  return <>
    {sheet && <div className="yp-row-btns yp-card-entry">{(["source", "new"] as const).map(mode => <button key={mode} className="yp-btn" aria-pressed={entry === mode} onClick={() => setEntry(mode)}>{mode === "source" ? "완료한 콘텐츠에서" : "새 주제로"}</button>)}</div>}
    {(!sheet || entry === "source") && <CardSourcePicker client={client} busy={busy} onPick={bring} expanded={sheet} />}
    {sheet && entry === "source" && error && <p role="alert">{error}</p>}
    {(!sheet || entry === "new") &&
    <form className="yp-card yp-pf-start yp-pf-card" onSubmit={event => { event.preventDefault(); if (ready) void start(); }}>
      <div className="yp-card-h">카드뉴스 시작하기</div>
      <div className="yp-card-b" style={{ display: "grid", gap: 10 }}>
        <p className="yp-hint" style={{ margin: 0 }}>새 주제를 직접 쓰거나 위에서 완료한 롱폼·숏폼·스레드 주제를 가져와 시작해요.</p>
        {channels.length > 1 ? <label className="yp-field" style={{ margin: 0 }}><span className="yp-fld-h"><b>채널</b></span>
          <select className="yp-in" aria-label="채널" value={form.channel || channels[0].id} onChange={event => setForm({ ...form, channel: event.target.value })}>
            {channels.map(card => <option key={card.id} value={card.id}>{card.name}</option>)}</select></label> : null}
        <label className="yp-field" style={{ margin: 0 }}><span className="yp-fld-h"><b>한 줄 주제</b><span className="yp-need">필수</span></span>
          <input className="yp-in" value={form.title} maxLength={200} onChange={event => setForm({ ...form, title: event.target.value })} placeholder="예) 월요일마다 무거운 사람의 공통점" aria-label="한 줄 주제" /></label>
        <label className="yp-field" style={{ margin: 0 }}><span className="yp-fld-h"><b>누구에게</b><span className="yp-need">필수</span></span>
          <input className="yp-in" value={form.target} maxLength={300} onChange={event => setForm({ ...form, target: event.target.value })} placeholder="예) 일이 안 맞는 것 같은데 이유를 모르는 3~7년 차 직장인" aria-label="누구에게" /></label>
        <label className="yp-field" style={{ margin: 0 }}><span className="yp-fld-h"><b>메모 · 근거</b><span className="yp-opt">선택</span></span>
          <textarea className="yp-in" rows={3} value={form.note} maxLength={2000} onChange={event => setForm({ ...form, note: event.target.value })} placeholder="담을 내용, 근거 자료, 참고 카드뉴스 주소" aria-label="메모 · 근거" /></label>
        {error ? <p className="yp-errline" role="alert">{error}</p> : null}
        <div className="yp-row-btns"><button type="submit" className="yp-btn yp-pri" disabled={busy || !ready}>{busy ? "만드는 중…" : "카드 만들러 가기"} <ArrowRight size={14} aria-hidden="true" /></button></div>
      </div>
    </form>}
    {!sheet && <><div className="yp-card-tabs" role="tablist" aria-label="카드뉴스 상태" onKeyDown={event => {
      if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
      event.preventDefault();
      const tabs = [...event.currentTarget.querySelectorAll<HTMLButtonElement>("[role=tab]")];
      const index = event.key === "Home" ? 0 : event.key === "End" ? 1 : (tabs.indexOf(event.target as HTMLButtonElement) + (event.key === "ArrowRight" ? 1 : -1) + 2) % 2;
      tabs[index]?.focus(); setTab(index ? "done" : "open");
    }}>
      {([{ key: "open", label: "만드는 중인 카드뉴스", count: open.length }, { key: "done", label: "완료된 카드뉴스", count: done.length }] as const).map(item =>
        <button key={item.key} id={`yp-card-tab-${item.key}`} type="button" role="tab" aria-selected={tab === item.key} aria-controls="yp-card-status-panel" tabIndex={tab === item.key ? 0 : -1} className={tab === item.key ? "yp-on" : ""} onClick={() => setTab(item.key)}>{item.label}<span className="yp-card-tab-count">{item.count}</span></button>)}
    </div>
    <CardList key={tab} tab={tab} title={tab === "done" ? "완료된 카드뉴스" : "만드는 중인 카드뉴스"} client={client} projects={projects === null ? null : tab === "done" ? done : open} /></>}
  </>;
}

function CardList({ title, projects, client, tab }: { title: string; projects: YpProject[] | null; client: YpClient | null; tab: "open" | "done" }) {
  const [query, setQuery] = useState(""), [page, setPage] = useState(0), [covers, setCovers] = useState<Record<string, CardDraft>>({}), [coverError, setCoverError] = useState(false);
  const rows = (projects ?? []).filter(project => projectName(project).toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()));
  const shown = rows.slice(page * 12, (page + 1) * 12);
  const ids = shown.map(project => project.id).join(",");
  useEffect(() => {
    if (!client || !ids) return;
    let active = true; setCoverError(false);
    client.cardCovers(ids.split(",")).then(result => { if (active) setCovers(result); }, () => { if (active) { setCovers({}); setCoverError(true); } });
    return () => { active = false; };
  }, [client, ids]);
  return <section className="yp-card" id="yp-card-status-panel" role="tabpanel" aria-labelledby={`yp-card-tab-${tab}`} tabIndex={0} style={{ marginTop: 14 }}><div className="yp-card-h">{title} {projects ? projects.length : ""}</div>
    <div className="yp-card-b"><input className="yp-in" aria-label="카드뉴스 검색" placeholder="카드뉴스 제목으로 찾기" value={query} onChange={event => { setQuery(event.target.value); setPage(0); }} />{coverError && <p className="yp-hint" role="status">표지는 불러오지 못했지만 카드뉴스는 열 수 있어요.</p>}</div>
    <div className="yp-card-b">{projects === null ? <p className="yp-hint" role="status">불러오는 중이에요…</p>
      : rows.length ? <ul className="yp-hist yp-card-catalog">{shown.map(project => <li key={project.id} style={{ alignItems: "center", gap: 10 }}>
        <Link className="yp-card-cover" href={stepHref(project.yp.stage === "done" ? 5 : project.yp.stage === "topic" ? 0 : project.yp.stage === "draft" ? 1 : project.yp.stage === "review" ? 4 : 5, project.id)} aria-label={`${projectName(project)} 표지로 열기`}>
          {covers[project.id] ? <CardPreview draft={covers[project.id]} index={0} width={72} /> : <span className="yp-card-cover-empty">표지 준비 중</span>}
        </Link>
        <span style={{ flex: 1, minWidth: 0 }}><b>{projectName(project)}</b></span>
        <Link className="yp-btn yp-sm" href={stepHref(project.yp.stage === "done" ? 5 : project.yp.stage === "topic" ? 0 : project.yp.stage === "draft" ? 1 : project.yp.stage === "review" ? 4 : 5, project.id)}>열기</Link></li>)}</ul>
      : <p className="yp-pempty">{query ? "찾는 카드뉴스가 없어요." : "아직 없어요."}</p>}</div>
    {rows.length > 12 && <div className="yp-card-b yp-row-btns"><button type="button" className="yp-btn yp-sm" disabled={!page} onClick={() => setPage(value => value - 1)}>이전</button><span>{page + 1} / {Math.ceil(rows.length / 12)}</span><button type="button" className="yp-btn yp-sm" disabled={(page + 1) * 12 >= rows.length} onClick={() => setPage(value => value + 1)}>다음</button></div>}
  </section>;
}

/** [카드뉴스로 만들기] on a finished longform (쇼츠 · 칼럼) or 숏폼 (내보내기), with the 카드뉴스 already made from it. */
export function CardFromProject({ page }: { page: YpPage }) {
  const router = useRouter();
  const project = page.bundle?.project;
  const [made, setMade] = useState<YpProject[] | null>(null);
  const [focus, setFocus] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (page.client && project) page.client.list().then(rows => setMade(rows.filter(row => row.yp.cardFrom?.id === project.id)), () => setMade([])); }, [page.client, project]);
  if (!project || !["upload", "shorts", "done"].includes(project.yp.stage)) return null;
  const make = async () => {
    if (!page.client) return;
    setBusy(true);
    try { const card = await page.client.createCard({ from: "project", projectId: project.id, focus: focus.trim() }); router.push(stepHref(1, card.id)); }
    catch (reason) { page.fail(reason); setBusy(false); }
  };
  return <YpSection title="카드뉴스로 만들기" gq="이 영상의 내용으로 인스타 카드뉴스를 만들어요">
    {project.yp.topic.type !== "short" ? <label className="yp-field" style={{ margin: "0 0 8px" }}><span className="yp-fld-h"><b>이 부분 위주로</b><span className="yp-opt">선택</span></span>
      <input className="yp-in" value={focus} maxLength={500} onChange={event => setFocus(event.target.value)} placeholder="예) 본론 2 · 결정이 많다는 이야기" aria-label="이 부분 위주로" /></label> : null}
    <div className="yp-row-btns"><button type="button" className="yp-btn yp-pri" disabled={busy} onClick={() => void make()}><GalleryHorizontal size={14} aria-hidden="true" /> {busy ? "만드는 중…" : "카드뉴스로 만들기"}</button></div>
    {made?.length ? <ul className="yp-hist" style={{ marginTop: 10 }}>{made.map(row => <li key={row.id}><span style={{ flex: 1 }}>{projectName(row)}</span><Link className="yp-lnk" href={stepHref(row.yp.stage === "draft" ? 1 : row.yp.stage === "review" ? 4 : 5, row.id)}>열기 →</Link></li>)}</ul> : null}
  </YpSection>;
}

/** [카드뉴스로 만들기] on an approved Threads post (콘텐츠 자동화 › 쓰레드). */
export function CardFromThreads({ itemId }: { itemId: string }) {
  const { accessToken, demo } = useSession();
  const client = useMemo(() => youtubeProcessClient(accessToken, demo), [accessToken, demo]);
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const make = async () => {
    if (!client) return;
    setBusy(true); setError("");
    try { const card = await client.createCard({ from: "threads", itemId }); router.push(stepHref(1, card.id)); }
    catch (reason) { setError(errorMessage(reason)); setBusy(false); }
  };
  return <span><button type="button" disabled={busy} onClick={() => void make()}>{busy ? "만드는 중…" : "카드뉴스로 만들기"}</button>{error ? <small role="alert"> {error}</small> : null}</span>;
}

const bare = (draft: CardDraft) => ({ id: draft.id, format: draft.format, slides: draft.slides, caption: draft.caption, hashtags: draft.hashtags });
const draftLabel = (draft: CardDraft) => draft.ai ? draftTag(draft.ai.by, draft.ai.model) : "직접 쓴 초안";

/** 카드 만들기: pick formats, draft them (AI or by hand), compare, pick one, edit it on the preview, then 카드 확정. */
export function CardMakeScreen({ page, header }: { page: YpPage; header: ReactNode }) {
  const stage = page.bundle?.stages.cards;
  const project = page.bundle?.project;
  const cards = stage?.data;
  const editable = project?.yp.stage === "draft" && project.yp.gates.draft.state !== "ok";
  const editorRef = useRef<HTMLDivElement>(null);
  const [chosen, setChosen] = useState<CardFormatId[]>([]);
  const [sampleFormat, setSampleFormat] = useState<CardFormatId>("list");
  const sample = useMemo(() => formatSample(sampleFormat), [sampleFormat]);
  const [planning, setPlanning] = useState(false);
  const [planSaved, setPlanSaved] = useState(false);
  const [brief, setBrief] = useState("");
  const [rewriting, setRewriting] = useState(false);
  const [compareAll, setCompareAll] = useState(false);
  const [send, setSend] = useState(false);
  const [draft, setDraft] = useState<CardDraft | null>(null);
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [slide, setSlide] = useState(0);
  const [undo, setUndo] = useState<CardDraft | null>(null);
  // 꼬리 맞추기: which bubble's tail the next tap on the big preview points (only on the card it was pressed on).
  const [aim, setAim] = useState<{ index: number; key: keyof typeof TOON_AIM } | null>(null);
  const [composing, setComposing] = useState(false);
  const [over, setOver] = useState<Record<number, string[]>>({});
  const [photoBusy, setPhotoBusy] = useState(false);
  const picked = cards?.drafts.find(row => row.id === cards.picked) ?? null;
  const photos = useCardPhotoUrls(page, [draft, ...(cards?.drafts ?? [])]);
  useEffect(() => { if (!dirty) setDraft(picked); }, [picked, dirty]);
  const defaultsFor = useRef<string | undefined>(undefined);
  useEffect(() => {
    if (!project || !cards || defaultsFor.current === project.id) return;
    defaultsFor.current = project.id;
    const formats = cards.briefFormats ?? cards.recommend?.formats.slice(0, 3) ?? [];
    setChosen(formats);
    setSampleFormat(formats[0] ?? "list");
  }, [project, cards]);
  const reload = page.reload;
  const job = useStaffJob(page, "card", useCallback(() => { setDirty(false); void reload(); }, [reload]));
  const onOver = useCallback((index: number, fields: string[]) => setOver(current => JSON.stringify(current[index] ?? []) === JSON.stringify(fields) ? current : { ...current, [index]: fields }), []);
  // Saves follow one another (two formats written by hand, then typing): each goes on the version the last one left.
  const version = useRef(0);
  const pageRef = useRef(page); pageRef.current = page;
  const draftRef = useRef(draft); draftRef.current = draft;
  const editRev = useRef(0), pending = useRef(0);
  const queue = useRef<Promise<YpProject | null>>(Promise.resolve(null));
  useEffect(() => { if (stage) version.current = Math.max(version.current, stage.version); }, [stage]);
  const save = useCallback((patch: Record<string, unknown>) => {
    const targetId = pageRef.current.bundle?.project.id;
    pending.current += 1; setBusy(true);
    const run = queue.current.then(async () => {
      const current = pageRef.current, stored = current.bundle?.stages.cards;
      if (!current.client || !stored || !targetId || current.bundle?.project.id !== targetId) return null;
      try {
        const result = await current.client.saveStage(targetId, "cards", Math.max(version.current, stored.version), patch);
        version.current = result.stage.version;
        current.setBundle(bundle => bundle?.project.id === targetId ? { ...bundle, project: result.project, stages: { ...bundle.stages, cards: result.stage } } : bundle);
        return result.project;
      } catch (reason) { current.fail(reason); return null; }
    }).finally(() => { pending.current -= 1; setBusy(pending.current > 0); });
    queue.current = run;
    return run;
  }, []);
  const persistDraft = useCallback(async () => {
    const snapshot = draftRef.current, rev = editRev.current;
    if (!snapshot) return null;
    const saved = await save({ draft: bare(snapshot) });
    if (saved && rev === editRev.current) setDirty(false);
    return saved;
  }, [save]);
  // 카드 확정 saves what was just typed first (the same flush every confirm step uses since 2026-10-30).
  const control = useGate(page, "draft", async () => {
    if (dirty) return persistDraft();
    await queue.current;
    return pageRef.current.bundle?.project ?? null;
  });
  useLeaveGuard(dirty);
  // Edits save themselves a moment after typing stops.
  useEffect(() => {
    if (!dirty || !draft || composing) return;
    const timer = window.setTimeout(() => { void persistDraft(); }, 1200);
    return () => window.clearTimeout(timer);
  }, [dirty, draft, composing, persistDraft]);
  const edit = (next: CardDraft) => { editRev.current += 1; draftRef.current = next; setDraft(next); setDirty(true); };
  const structure = (next: CardDraft, selected: number) => { if (!draft || next === draft) return; setUndo(draft); edit(next); setOver({}); setSlide(selected); };
  const setScene = (scene?: CharacterScene) => {
    if (draft) structure({ ...draft, slides: draft.slides.map((row, index) => index === current ? { ...row, scene } : row) }, current);
  };


  if (!page.bundle || !project || !cards) return <YpFrame page={page} view={1} action={null} header={header} title="카드 만들기" sub="" />;

  const overList = Object.entries(over).filter(([index, fields]) => fields.length && Number(index) < (draft?.slides.length ?? 0))
    .map(([index, fields]) => `${Number(index) + 1}장 ${fields.map(key => slideSpec(draft!.format, draft!.slides[Number(index)].type)?.fields.find(field => field.key === key)?.label ?? key).join(" · ")} 칸이 넘쳐요`);
  const problems = draft ? cardProblems(draft) : { blocking: [], warnings: [] };
  const missing = cardsMissing(draft ? { ...cards, drafts: cards.drafts.map(row => row.id === draft.id ? draft : row) } : cards) || overList[0] || "";
  const gptConfigured = job.status?.gptConfigured === true;
  const action = gateAction(page, "draft", 1, control, missing);
  if (action.kind === "button" && editable) {
    action.notice = page.demo ? <span className="yp-hint">연습 · 그림 검사 비용 없음</span> : !gptConfigured ? null : <CostTag kind="paid" what="확정 시 자동 그림 검사 · 정밀 기준 (잔액이 낮으면 절약)" amount={tokenEstimate(GPT_TIERS.precise.model, 10_000, 8_000)} upTo />;
    action.extra = <>{action.notice}{action.extra}</>;
  }
  const current = draft?.slides[slide] ? slide : 0;
  const scene = draft?.slides[current]?.scene;
  const spec = draft ? slideSpec(draft.format, draft.slides[current].type) : null;
  const addBlank = async () => { for (const format of chosen) if (!(await save({ add: format }))) return; };
  const sampleProject = page.demo && project.id === "demo-p13";
  const savePlan = () => save({ brief: brief.trim(), briefFormats: chosen });
  const openPlan = () => {
    setPlanSaved(false);
    setBrief(cards.brief || [project.title, project.yp.topic.target && `독자 · ${project.yp.topic.target}`,
      cards.focus || project.yp.topic.note, chosen.includes("list") && "읽고 나서 독자가 할 일과 저장할 양식을 적어 주세요.", planningOutline(chosen)].filter(Boolean).join("\n"));
    setPlanning(true);
  };
  const rewrite = async () => {
    if (!draft || !stage || rewriting || dirty || busy) return;
    const original = draft.slides[current];
    const rev = editRev.current;
    if (!page.demo && !window.confirm("선택한 장의 원고를 회사 GPT로 다시 생성할까요? API 비용이 발생합니다.")) return;
    setRewriting(true);
    try {
      let fields: Record<string, string> | null;
      if (page.demo) {
        const first = mondayFields(original, current);
        fields = mondayFields(original, current, JSON.stringify(original.fields) === JSON.stringify(first));
      } else {
        const result = await apiRequest<{ fields: Record<string, string> }>(`/api/v1/content/youtube/projects/${project.id}/cards`, {
          token: page.accessToken, method: "POST", body: JSON.stringify({ action: "rewrite", draftId: draft.id, index: current, version: stage.version }),
        });
        fields = result.fields;
      }
      if (!fields) throw new Error("이 장에 해당하는 데모 예시가 없어요.");
      if (draftRef.current?.id !== draft.id || editRev.current !== rev || pageRef.current.bundle?.stages.cards.version !== stage.version)
        throw new Error("생성 중 초안이 변경됐어요. 현재 편집본에서 다시 시도해 주세요.");
      structure({ ...draft, slides: draft.slides.map((row, index) => index === current ? { ...row, fields: { ...row.fields, ...fields } } : row) }, current);
    } catch (reason) { page.fail(reason); } finally { setRewriting(false); }
  };
  // A photo (or a drawn picture) lands on the card that was open when it was picked, on the draft as it is by then.
  const placePhoto = (photo: CardPhoto, at: number) => { const latest = draftRef.current; if (latest) edit({ ...latest, slides: latest.slides.map((row, index) => index === at ? { ...row, photo } : row) }); };
  /** True once the picture is on the card (「내 GPT로 그리기」 says so). */
  const putPhoto = async (file: File | undefined, at: number) => {
    if (!file || !draft || !page.client) return false;
    setPhotoBusy(true);
    try {
      const shrunk = await shrinkPhoto(file);
      const asset = await page.client.uploadAsset(project.id, "card", shrunk.file);
      placePhoto({ path: asset.path, w: shrunk.w, h: shrunk.h }, at);
      return true;
    } catch (reason) { page.fail(reason); return false; } finally { setPhotoBusy(false); }
  };
  const dropPhoto = (at: number) => { if (draft) edit({ ...draft, slides: draft.slides.map((row, index) => index === at ? { ...row, photo: undefined } : row) }); };

  return <CardPhotos.Provider value={photos}><YpFrame page={page} view={1} action={action} header={header} title="카드 만들기"
    sub={gateSub(project, "draft", "포맷을 골라 초안을 뽑고, 하나를 골라 다듬은 뒤 카드를 확정해요.", "카드를 확정했어요. 최종 검토에서 한 장씩 봐요.")}
    todo={editable ? [{ label: "초안", done: cards.drafts.length > 0 }, { label: "고른 초안", done: Boolean(picked) }, { label: "글자 수 · 넘침", done: Boolean(draft) && !problems.blocking.length && !overList.length }] : undefined}>
    <GateBanner page={page} gate="draft" />
    <Subject page={page} />
    <CardCanonContext source={page.bundle.stages.cards.data.source} focus={page.bundle.stages.cards.data.focus} />
    <CanonRail refs={draft?.ai?.trace} legacy={draft?.ai?.canon} check={draft ? (problems.blocking.length ? `필수 수정 ${problems.blocking.length}건` : (problems.warnings.length ? `확인 권장 ${problems.warnings.length}건` : "자동 검사 통과")) : undefined} pending={!draft} />
    {cards.source.kind !== "none" ? <details className="yp-card yp-card-src"><summary>원본 · {SOURCE_NAME[cards.source.kind]} 「{cards.source.title}」{cards.focus ? ` · 이 부분 위주로: ${cards.focus}` : ""}</summary>
      <pre>{cards.source.text}</pre></details> : null}

    {editable ? <YpSection n={1} title="포맷 고르기" gq="최대 3개를 한 번에 뽑아 나란히 비교해요">
      <div className="yp-card-formats">{CARD_FORMAT_IDS.map(id => { const format = CARD_FORMATS[id]; const on = chosen.includes(id);
        return <label key={id} className={`yp-card-format${on ? " yp-on" : ""}`}>
          <input type="checkbox" aria-label={format.name} checked={on} disabled={!on && chosen.length >= 3} onChange={() => { setSampleFormat(id); setChosen(on ? chosen.filter(row => row !== id) : [...chosen, id]); }} />
          <span><b>{format.name}</b>{cards.recommend?.formats.includes(id) ? <span className="yp-tag yp-acc">추천</span> : null}<small>{format.when}</small>
            <small>{format.slides.map(row => row.min === row.max ? `${row.label} ${row.min}` : `${row.label} ${row.min}~${row.max}`).join(" · ")}장</small></span></label>; })}</div>
      <section className="yp-format-sample" aria-label="포맷 결과 예시">
        <CardPreview draft={sample} index={1} width={184} />
        <div><label>본문 카드 예시 <select className="yp-in" value={sampleFormat} onChange={event => setSampleFormat(event.target.value as CardFormatId)}>
          {CARD_FORMAT_IDS.map(id => <option key={id} value={id}>{CARD_FORMATS[id].name}</option>)}</select></label>
          <p>{CARD_FORMATS[sampleFormat].when}</p>
          {Object.entries(sample.slides[1].fields).map(([key,value]) => <p key={key}><small>{slideSpec(sampleFormat, sample.slides[1].type)?.fields.find(field => field.key === key)?.label}</small> {value}</p>)}
        </div></section>
      {chosen.includes("list") && <a className="yp-btn" href="/card-information/compare.html" target="_blank" rel="noreferrer">정보전달형 기존·개선 6장 비교 ↗</a>}
      {cards.recommend?.why ? <p className="yp-hint">추천 이유: {cards.recommend.why}</p> : null}
      {!gptConfigured && <p className="yp-hint" role="status">{page.demo ? "데모에서는 기획안과 예시를 확인할 수 있어요." : job.status?.gptConfigured === false ? "회사 GPT 연결이 설정되지 않았어요. 기획안을 저장하거나 내 AI 또는 직접 쓰기로 계속할 수 있어요." : "회사 GPT 설정을 확인할 수 없어요. 기획안 저장과 직접 쓰기를 사용할 수 있어요."}</p>}
      <div className="yp-row-btns">
        <button type="button" className="yp-btn yp-pri" disabled={!chosen.length || job.open} onClick={openPlan}>{!gptConfigured ? "기획안 확인" : cards.recommend?.formats.length === 2 && chosen.length === 2 && chosen.every(id => cards.recommend?.formats.includes(id)) ? "추천 2개로 초안 뽑기" : `AI로 초안 뽑기 (${chosen.length}개)`}</button>
        {gptConfigured && <><CostTag kind="paid" amount={tokenEstimate(GPT_TIERS.precise.model, 60_000, 32_000)} /><small>정밀 1회 예상 · 3~6분 · 점검 실패 시 1회 재시도</small></>}
        <button type="button" className="yp-btn" disabled={!chosen.length || busy} onClick={() => void addBlank()}>직접 쓰기</button>
      {sampleProject && !planning && <button type="button" className="yp-btn" onClick={() => { setChosen(["steps"]); setBrief("월요일마다 무거운 직장인 · 일요일 밤의 걱정을 월요일 첫 행동으로 옮긴다.\n" + planningOutline(["steps"])); setPlanning(true); }}>같은 주제로 개선 예시 비교</button>}</div>
      {planSaved && !planning && <p className="yp-hint" role="status">기획안과 선택한 포맷을 저장했어요.</p>}
      {planning && <section className="yp-card-b" aria-label="생성 전 기획안">
        <h3>생성 전 기획안 확인</h3><p>{planningOutline(chosen)}</p>
        {chosen.includes("list") && <button type="button" className="yp-btn" disabled={brief.includes("캐릭터 해설형")} onClick={() => setBrief(value => (value + "\n캐릭터 해설형으로 기획해요. 표지에 주제와 어울리는 마이인 캐릭터를 고르고, 본문에는 행동 비교와 기록 양식을 넣어요.").trim())}>마이인 캐릭터 해설형 적용</button>}
        <label>독자 · 핵심 메시지 · 장별 전개<textarea value={brief} maxLength={1800} rows={5} onChange={event => setBrief(event.target.value)} /></label>
        <div className="yp-row-btns"><button className="yp-btn" onClick={() => setPlanning(false)}>취소</button>
        <button className="yp-btn" disabled={!brief.trim() || !chosen.length || busy || dirty} onClick={async () => {
          if (await savePlan()) { setPlanning(false); setPlanSaved(true); }
        }}>기획안 저장</button>
        <button className="yp-btn yp-pri" disabled={!brief.trim() || !chosen.length || busy || dirty || job.open || (!job.status && !(sampleProject && chosen.length === 1 && chosen[0] === "steps"))} onClick={async () => {
          if (!(await savePlan())) return;
          if (sampleProject && chosen.length === 1 && chosen[0] === "steps") {
            if (!(await save({ mondaySample: true }))) return;
            setSlide(0); setCompareAll(true);
          } else setSend(true);
          setPlanning(false);
        }}>{sampleProject && chosen.length === 1 && chosen[0] === "steps" ? "기획 확인 · 로컬 예시 열기" : gptConfigured ? "기획 확인 · AI 생성 방식 선택" : "기획 확인 · 내 AI로 보내기"}</button></div>
      </section>}
      <JobLine job={job} onRetry={openPlan} />
      <SendDialog page={page} task="card" open={send} onClose={() => setSend(false)} job={job} extra={{ formats: chosen }} />
    </YpSection> : null}

    {cards.drafts.length ? <YpSection n={editable ? 2 : 1} title="초안 비교" gq={`${cards.drafts.length}개 · 같은 주제`}>
      <button type="button" className="yp-btn yp-sm" aria-pressed={compareAll} onClick={() => setCompareAll(!compareAll)}>{compareAll ? "앞 4장만 보기" : "전체 장 비교"}</button>
      {!picked && <p role="status">아직 고르지 않았어요. 초안을 비교한 뒤 선택해 주세요.</p>}
      <div className="yp-card-rows">{cards.drafts.map(row => { const check = cardProblems(row); const mine = row.id === cards.picked;
        return <div key={row.id} className={`yp-card-row${mine ? " yp-on" : ""}`}>
          <div className="yp-card-row-h"><b>{CARD_FORMATS[row.format].name}</b><span className="yp-tag">{draftLabel(row)}</span><span className="yp-muted">{row.slides.length}장</span>
            <span className={check.blocking.length ? "yp-tag yp-bad" : "yp-tag yp-ok"}>{check.blocking.length ? `고칠 곳 ${check.blocking.length}` : "필수 점검 통과"}</span><span className="yp-sp" />
            {mine ? <span className="yp-tag yp-acc">고른 초안</span> : editable ? <button type="button" className="yp-btn yp-sm" disabled={busy || dirty} onClick={() => void save({ pick: row.id })}>이 초안으로 다듬기</button> : null}
            {editable && !mine ? <button type="button" className="yp-btn yp-sm" aria-label="초안 지우기" disabled={busy} onClick={() => { if (window.confirm("이 초안을 지울까요?")) void save({ remove: row.id }); }}><Trash2 size={13} /></button> : null}</div>
          <div className="yp-chips">{row.ai?.canon && <span className="yp-tag">생성 정본 {row.ai.canon}</span>}{cards.recommend?.formats.includes(row.format) && <span className="yp-tag">추천</span>}{check.warnings.length > 0 && <span className="yp-tag">참고 {check.warnings.length}건</span>}</div>
          <ol className="yp-card-lines">{row.slides.map((item, i) => <li key={i}>{firstCardLine(row.format, item)}</li>)}</ol>
          <div className="yp-card-strip">{row.slides.slice(0, compareAll ? undefined : 4).map((_, index) => <CardPreview key={index} draft={row} index={index} width={index === 0 ? 210 : 150} />)}</div>
        </div>; })}</div>
    </YpSection> : null}

    {draft ? <YpSection n={editable ? 3 : 2} title={editable ? "고른 초안 다듬기" : "확정한 카드"} gq={`${CARD_FORMATS[draft.format].name} · ${draft.slides.length}장`}>
      <div ref={editorRef} className="yp-card-issues">
        {([["필수 수정", [...problems.blocking, ...overList]], ["참고", problems.warnings]] as const).map(([name, issues]) => issues.length > 0 &&
          <section key={name}><strong>{name} {issues.length}건</strong><ul>{issues.map((message, i) => {
            const number = message.match(/^(\d+)장/);
            const index = number ? Number(number[1]) - 1 : -1;
            const row = draft.slides[index];
            const field = row && slideSpec(draft.format, row.type)?.fields.find(item => message.includes(item.label));
            const label = field?.label ?? (message.startsWith("캡션") ? "공통 캡션" : message.startsWith("해시태그") ? "공통 해시태그" : null);
            return <li key={i}>{editable && (row || label) ? <button className="yp-btn yp-sm" type="button" onClick={() => {
              if (row) setSlide(index);
              requestAnimationFrame(() => {
                const scope = editorRef.current?.parentElement;
                const target = label ? scope?.querySelector<HTMLElement>(`[aria-label="${label}"]`) : scope?.querySelector<HTMLElement>(`[aria-label="${index + 1}장 보기"]`);
                target?.focus(); target?.scrollIntoView({ block: "center" });
              });
            }}>{message}</button> : message}</li>;
          })}</ul></section>)}
      </div>
      <div className="yp-card-tools" aria-label="카드 장 관리">
        {editable && (!page.demo || (sampleProject && draft.format === "steps" && draft.slides.length === 6)) && <button type="button" className="yp-btn yp-sm" disabled={rewriting || dirty || busy || (!page.demo && !gptConfigured)} onClick={() => void rewrite()}>{rewriting ? "다시 만드는 중…" : `${current + 1}장만 다시 만들기`}</button>}
        {editable && draft.format === "list" && draft.slides[current].type === "item" && !draft.slides[current].fields.before && <button type="button" className="yp-btn yp-sm" onClick={() => structure({ ...draft, slides: draft.slides.map((row, i) => i === current ? { ...row, layout: row.layout === "spotlight" ? undefined : "spotlight" } : row) }, current)}>배치만 바꾸기</button>}
        <b>카드 {draft.slides.length} / {cardMaxSlides(draft.format)}장{toonUploads(draft).length > 1 ? ` · ${toonUploads(draft).length}화` : ""}</b>
        {editable && CARD_FORMATS[draft.format].slides.filter(item => item.max > item.min).map(item => <button key={item.type} type="button" className="yp-btn yp-sm" disabled={addCardSlide(draft, item.type) === draft} onClick={() => structure(addCardSlide(draft, item.type), current)}><Plus size={13} />{item.type === "toon" ? "다음 화 나누기" : `${item.label} 카드 추가`}</button>)}
        {editable && <button type="button" className="yp-btn yp-sm" disabled={!undo} onClick={() => { if (undo) { edit(undo); setOver({}); setSlide(Math.min(current, undo.slides.length - 1)); setUndo(null); } }}>장 편집 되돌리기</button>}
        <span role="status" className="yp-hint">{busy ? "저장 중…" : dirty ? "변경 내용 저장 대기" : "저장됨"}</span>
      </div>
      {editable && draft.format === "webtoon" ? <CardDrawBatch key={`draw-${draft.id}`} page={page} projectId={project.id} draft={draft} onPlace={(index, photo) => placePhoto(photo, index)} onFile={(index, file) => putPhoto(file, index)} /> : null}
      <div className="yp-card-edit">
        <div className="yp-card-list" aria-label="카드 순서">{draft.slides.map((row, index) => <div key={index} className="yp-card-item" draggable={editable && (slideSpec(draft.format, row.type)?.max ?? 0) > 1}
          onDragStart={event => event.dataTransfer.setData("application/x-card-slide", JSON.stringify({ id: draft.id, index }))}
          onDragOver={event => { if (editable && event.dataTransfer.types.includes("application/x-card-slide")) event.preventDefault(); }}
          onDrop={event => { if (!editable) return; event.preventDefault(); try { const from = JSON.parse(event.dataTransfer.getData("application/x-card-slide")); if (from.id === draft.id) { const next = moveCardSlide(draft, from.index, index); structure(next, next === draft ? current : index); } } catch { /* External or malformed drops do not change the draft. */ } }}>
          <button type="button" className={index === current ? "yp-on" : ""} onClick={() => setSlide(index)} aria-label={`${index + 1}장 보기`} aria-pressed={index === current}>
            <CardPreview draft={draft} index={index} width={84} onOver={onOver} /><span>{index + 1} · {row.type === "toon" && row.fields.episode?.trim() ? `${row.fields.episode.trim()} 표지` : slideSpec(draft.format, row.type)?.label}{over[index]?.length ? " · 넘침" : ""}</span></button>
          {editable && <div className="yp-card-item-actions">
            <button type="button" aria-label={`${index + 1}장 위로`} title="위로 이동" disabled={moveCardSlide(draft, index, index - 1) === draft} onClick={() => structure(moveCardSlide(draft, index, index - 1), index - 1)}><ArrowUp size={13} /></button>
            <button type="button" aria-label={`${index + 1}장 아래로`} title="아래로 이동" disabled={moveCardSlide(draft, index, index + 1) === draft} onClick={() => structure(moveCardSlide(draft, index, index + 1), index + 1)}><ArrowDown size={13} /></button>
            <button type="button" aria-label={`${index + 1}장 삭제`} title="이 장 삭제 (최소 장수는 유지)" disabled={removeCardSlide(draft, index) === draft} onClick={() => { if (!Object.values(row.fields).some(Boolean) || window.confirm("이 카드의 내용을 뺄까요? 장 편집 되돌리기로 복원할 수 있어요.")) structure(removeCardSlide(draft, index), Math.max(0, index - 1)); }}><Trash2 size={13} /></button>
          </div>}
        </div>)}</div>
        <CardEditorPreview draft={draft} index={current} onAim={editable && aim?.index === current ? (x, y) => {
          edit({ ...draft, slides: draft.slides.map((row, index) => index === current ? { ...row, fields: { ...row.fields, [`${aim.key}At`]: `${x},${y}` } } : row) }); setAim(null);
        } : undefined} />
        <div className="yp-card-fields">
          <h3>{current + 1}장 · {spec?.label}</h3>
          {editable ? <p className="yp-hint">가장 먼저 읽힐 구절 하나를 *별표*로 감싸면 파란색으로 보여요 (표지 · 마무리는 노란색).</p> : null}
          {editable && draft.format === "list" && ["cover", "item", "end"].includes(draft.slides[current].type) && <fieldset className="yp-field"><legend>장면 디자인</legend>
            <label>캐릭터 <select value={scene?.kind === "character" ? scene.character : ""} onChange={event => setScene(event.target.value ? { side: "right", size: "large", ...scene, kind: "character", character: event.target.value as MyinCharacter } : undefined)}>
              <option value="">기본 레이아웃</option>{Object.entries(MYIN_CAST).map(([name, group]) => <option key={name} value={name}>{group} · {name}</option>)}</select></label>
            {scene?.kind === "character" && <><label>위치 <select value={scene.side} onChange={event => setScene({ ...scene, side: event.target.value as CharacterScene["side"] })}><option value="left">왼쪽</option><option value="right">오른쪽</option></select></label>
            <label>크기 <select value={scene.size} onChange={event => setScene({ ...scene, size: event.target.value as CharacterScene["size"] })}><option value="large">크게</option><option value="small">작게</option></select></label>
            <label><input type="checkbox" checked={scene.dark !== false} onChange={event => setScene({ ...scene, dark: event.target.checked })} /> 어두운 배경</label>{scene.reason && <small>{scene.reason}</small>}</>}
          </fieldset>}
          {spec?.fields.map(field => { const value = draft.slides[current].fields[field.key] ?? ""; const n = cardLetters(value);
            const set = (text: string) => edit({ ...draft, slides: draft.slides.map((row, index) => index === current ? { ...row, fields: { ...row.fields, [field.key]: text } } : row) });
            const tail = draft.format === "webtoon" && editable && draft.slides[current].photo && value.trim() && field.key in TOON_AIM && (field.key !== "sfx" || toonBattery(value) !== null) ? field.key as keyof typeof TOON_AIM : null;
            const aiming = aim?.index === current && aim.key === tail, aimed = tail ? draft.slides[current].fields[`${tail}At`] : "";
            const aimRow = tail ? <div className="yp-card-aim-row"><button type="button" className="yp-btn yp-sm" aria-pressed={aiming} onClick={() => setAim(aiming ? null : { index: current, key: tail })}>
              {tail === "sfx" ? (aiming ? "미리보기에서 배터리 캐릭터를 눌러요" : "배터리 표시 붙이기") : aiming ? "미리보기에서 말하는 사람을 눌러요" : "말풍선 꼬리 맞추기"}</button>
              {aimed ? <button type="button" className="yp-btn yp-sm" onClick={() => edit({ ...draft, slides: draft.slides.map((row, index) => index === current ? { ...row, fields: { ...row.fields, [`${tail}At`]: "" } } : row) })}>{tail === "sfx" ? "표시 처음대로" : "꼬리 처음대로"}</button> : null}</div> : null;
            return <Fragment key={field.key}><label className="yp-field"><span className="yp-fld-h"><b>{field.label}</b>{field.optional ? <span className="yp-opt">선택</span> : null}
              <span className={n > field.max ? "yp-card-n yp-bad" : "yp-card-n"}>{n}/{field.max}</span>{over[current]?.includes(field.key) ? <span className="yp-tag yp-bad">넘침</span> : null}</span>
              <textarea className="yp-in" rows={field.max > 30 ? 3 : 2} value={value} aria-label={field.label} disabled={!editable} onCompositionStart={() => setComposing(true)} onCompositionEnd={() => setComposing(false)} onChange={event => set(event.target.value)} /></label>{aimRow}</Fragment>; })}
          {(spec?.photo || scene?.action) && editable ? <div className="yp-field"><span className="yp-fld-h"><b>사진</b><span className="yp-opt">선택</span></span>
            <p className="yp-hint">실제 사진 · 자료를 넣거나 AI로 그려요. AI 그림은 설명용이라 실제 기록처럼 쓰지 않아요 (디자인 정본 §8).</p>
            <CardDrawPanel key={draft.id + ":" + current} page={page} projectId={project.id} photo={draft.slides[current].photo} onPhoto={photo => placePhoto(photo, current)}
              onFile={file => putPhoto(file, current)} label={`${current + 1}장`}
              defaultStyle={draft.format === "webtoon" ? "webtoon" : "simple"}
              brief={draft.format === "webtoon" ? { scene: draft.slides[current].fields.scene ?? "", cast: draft.slides[current].fields.cast ?? "" } : scene?.action ? { scene: scene.action, cast: "", guideCharacter: GUIDE_CAST.find(name => name === scene.character) } : undefined}>
              <label className="yp-btn yp-sm"><ImagePlus size={13} aria-hidden="true" />{photoBusy ? "올리는 중…" : draft.slides[current].photo ? "사진 바꾸기" : "사진 넣기"}
                <input type="file" accept="image/jpeg,image/png,image/webp" aria-label="사진 파일" hidden disabled={photoBusy} onChange={event => { const at = current; void putPhoto(event.target.files?.[0], at); event.target.value = ""; }} /></label>
              {draft.slides[current].photo ? <button type="button" className="yp-btn yp-sm" disabled={photoBusy} onClick={() => dropPhoto(current)}>사진 빼기</button> : null}
            </CardDrawPanel></div> : null}
        </div>
      </div>
      <CardPostFields key={draft.id} draft={draft} editable={editable} onEdit={edit} onComposing={setComposing} />

    </YpSection> : editable && !cards.drafts.length ? <p className="yp-pempty">포맷을 고르고 초안을 뽑으면 여기서 카드를 다듬어요.</p> : null}
  </YpFrame></CardPhotos.Provider>;
}

function CardEditorPreview({ draft, index, onAim }: { draft: CardDraft; index: number; onAim?: (x: number, y: number) => void }) {
  const box = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(320);
  useLayoutEffect(() => {
    const element = box.current;
    if (!element) return;
    const measure = () => { if (element.clientWidth > 0) setWidth(Math.min(400, element.clientWidth)); };
    measure(); const observer = new ResizeObserver(measure); observer.observe(element);
    return () => observer.disconnect();
  }, []);
  // 꼬리 맞추기: a tap on the picture says where the speaker is, in % of the card.
  const pick = (event: MouseEvent<HTMLDivElement>) => {
    const card = event.currentTarget.firstElementChild?.getBoundingClientRect();
    if (!onAim || !card?.width) return;
    const at = (value: number) => Math.round(Math.min(100, Math.max(0, value * 100)));
    onAim(at((event.clientX - card.left) / card.width), at((event.clientY - card.top) / card.height));
  };
  return <div className={onAim ? "yp-card-big yp-card-aim" : "yp-card-big"} ref={box} onClick={onAim ? pick : undefined}><CardPreview draft={draft} index={index} width={width} /></div>;
}

function CardPostFields({ draft, editable, onEdit, onComposing }: { draft: CardDraft; editable: boolean; onEdit: (draft: CardDraft) => void; onComposing: (value: boolean) => void }) {
  const [tags, setTags] = useState(() => draft.hashtags.map(tag => `#${tag}`).join(" "));
  const focused = useRef(false);
  useEffect(() => { if (!focused.current) setTags(draft.hashtags.map(tag => `#${tag}`).join(" ")); }, [draft.hashtags]);
  return <section className="yp-card-post" aria-label="카드뉴스 공통 게시글">
    <h3>공통 게시글 · 모든 카드에 함께 사용</h3><p className="yp-hint">카드를 바꿔도 이 영역은 유지됩니다. 최종 검토와 내보내기에서도 확인할 수 있어요.</p>
    <label className="yp-field"><span className="yp-fld-h"><b>캡션</b><span className="yp-card-n">{[...draft.caption].length}자</span></span><textarea className="yp-in" rows={5} aria-label="공통 캡션" value={draft.caption} disabled={!editable} onCompositionStart={() => onComposing(true)} onCompositionEnd={() => onComposing(false)} onChange={event => onEdit({ ...draft, caption: event.target.value })} /></label>
    <label className="yp-field"><span className="yp-fld-h"><b>해시태그</b><span className="yp-opt">3~5개 · 띄어 써요</span></span><input className="yp-in" aria-label="공통 해시태그" value={tags} disabled={!editable} onFocus={() => { focused.current = true; }} onBlur={() => { focused.current = false; }} onCompositionStart={() => onComposing(true)} onCompositionEnd={() => onComposing(false)}
      onChange={event => { setTags(event.target.value); onEdit({ ...draft, hashtags: parseCardHashtags(event.target.value) }); }} /></label>
  </section>;
}

const confirmedDraft = (page: YpPage) => { const cards = page.bundle?.stages.cards.data; return cards?.drafts.find(row => row.id === (cards.confirmed?.draftId ?? cards.picked)) ?? null; };

/** 최종 검토: every card at once, the caption and what the checks point out, then the PD's 최종 검토 컨펌. */
export function CardReviewScreen({ page, header }: { page: YpPage; header: ReactNode }) {
  const control = useGate(page, "review");
  const project = page.bundle?.project;
  const draft = confirmedDraft(page);
  const [over, setOver] = useState<Record<number, string[]>>({});
  const onOver = useCallback((index: number, fields: string[]) => setOver(current => JSON.stringify(current[index] ?? []) === JSON.stringify(fields) ? current : { ...current, [index]: fields }), []);
  const photos = useCardPhotoUrls(page, [draft]);
  if (!page.bundle || !project) return <YpFrame page={page} view={4} action={null} header={header} title="최종 검토" sub="" />;
  const check = draft ? cardProblems(draft) : { blocking: ["확정한 카드가 없어요"], warnings: [] };
  const overCount = Object.values(over).filter(fields => fields.length).length;
  const action = gateAction(page, "review", 4, control, check.blocking[0] ?? (overCount ? `넘치는 카드가 ${overCount}장 있어요` : ""));
  return <YpFrame page={page} view={4} action={action} header={header} title="최종 검토" sub={gateSub(project, "review", "카드를 한 장씩 보고 컨펌해요. 고칠 곳이 있으면 대표 노트를 보고 카드 만들기로 돌아가요.", "최종 검토를 마쳤어요. 내보내기에서 이미지를 내려받아요.")}>
    {["topic", "draft"].includes(project.yp.stage) ? <LockedStep page={page} name="최종 검토" /> : <>
      <GateBanner page={page} gate="review" />
      <Subject page={page} />
    <CardCanonContext source={page.bundle.stages.cards.data.source} focus={page.bundle.stages.cards.data.focus} />
    <CanonRail refs={draft?.ai?.trace} legacy={draft?.ai?.canon} check={draft ? (check.blocking.length ? `필수 수정 ${check.blocking.length}건` : (check.warnings.length ? `확인 권장 ${check.warnings.length}건` : "자동 검사 통과")) : undefined} pending={!draft} />
      {draft ? <>
        <YpSection n={1} title="카드" gq={`${CARD_FORMATS[draft.format].name} · ${draft.slides.length}장`}>
          <CardPhotos.Provider value={photos}><div className="yp-card-grid">{draft.slides.map((_, index) => <CardPreview key={index} draft={draft} index={index} width={260} onOver={onOver} />)}</div></CardPhotos.Provider>
        </YpSection>
        <YpSection n={2} title="캡션 · 해시태그"><p className="yp-card-caption">{draft.caption || "캡션이 없어요"}</p><p className="yp-muted">{draft.hashtags.map(tag => `#${tag}`).join(" ")}</p></YpSection>
        {check.blocking.length || check.warnings.length || overCount ? <ul className="yp-card-checks">{check.blocking.map(text => <li key={text} className="yp-bad">{text}</li>)}
          {overCount ? <li className="yp-bad">넘치는 카드가 {overCount}장 있어요</li> : null}{check.warnings.map(text => <li key={text} className="yp-warn">{text}</li>)}</ul> : null}
        <CardScreenCheck page={page} />
      </> : <p className="yp-pempty">확정한 카드가 없어요.</p>}
    </>}
  </YpFrame>;
}

/** 최종 검토 › 화면 자동 검사 (설계서 §4-3): GPT's look at the confirmed cards as drawn, started by 카드 확정; [다시 검사] asks again. */
function CardScreenCheck({ page }: { page: YpPage }) {
  const [busy, setBusy] = useState(false);
  const [choice, setTier] = useState<GptTier | null>(null);
  const [error, setError] = useState("");
  const cost = useCostConfirm();
  const confirmed = page.bundle?.stages.cards.data.confirmed, check: YpScreenCheck | undefined = page.bundle?.stages.screenCheck.data;
  const current = confirmed && check?.runId === confirmed.draftId && check.sheetsAt === confirmed.sig ? check : null;
  const tier = choice ?? (check?.model === GPT_TIERS.saving.model ? "saving" : "precise");
  // 카드 확정 starts the check on the server; until it lands this waits for it (one to three minutes).
  const waiting = busy || current?.state === "running" || Boolean(!current && confirmed?.at && Date.parse(confirmed.at) > Date.now() - 5 * 60_000);
  const { reload } = page;
  useEffect(() => {
    if (!waiting || busy) return;
    const timer = window.setInterval(() => void reload(), 20_000);
    return () => window.clearInterval(timer);
  }, [waiting, busy, reload]);
  if (!confirmed) return null;
  const again = async () => {
    if (page.demo) { setError("연습 화면에서는 GPT를 부르지 않아요."); return; }
    const model = GPT_TIERS[tier].model;
    // Ten cards are about 8,000 image tokens with the prompt; the answer and its thinking at most 6,000.
    if (!await cost.confirm({ model, amount: tokenEstimate(model, 10_000, 8_000), upTo: true, detail: "카드 그림을 GPT가 봐요", note: "GPT 크레딧(매달 500달러)에서 나가요.", ok: "검사하기" })) return;
    setBusy(true); setError("");
    try {
      await apiRequest<{ check: YpScreenCheck }>(`/api/v1/content/youtube/projects/${page.bundle!.project.id}/cards`, { token: page.accessToken, method: "POST", body: JSON.stringify({ action: "check", tier }) });
      await reload();
    } catch (reason) { setError(errorMessage(reason)); } finally { setBusy(false); }
  };
  const scenes = current?.state === "done" ? current.scenes : [];
  const groups = groupScreenIssues(scenes), count = new Set(scenes.map(item => item.scene)).size;
  const show = (card: number) => document.querySelectorAll(".yp-card-grid > *")[card - 1]?.scrollIntoView({ behavior: "smooth", block: "center" });
  const pill = waiting ? <span className="yp-tag">GPT가 보는 중 · 1~3분</span>
    : current?.state === "done" ? <span className={count ? "yp-tag yp-bad" : "yp-tag yp-ok"}>{count ? `확인할 카드 ${count}장` : "✓ 문제 없음"}</span>
    : current?.state === "failed" ? <span className="yp-tag yp-bad">⚠ 끝내지 못했어요</span>
    : <span className="yp-tag">{check?.runId === confirmed.draftId ? "카드가 바뀌었어요 · 다시 검사해요" : "아직 검사하지 않았어요"}</span>;
  return <YpSection n={3} title="화면 자동 검사" gq="GPT가 카드 그림에서 넘침 · 겹침 · 잘림 · 빈칸을 찾아요 · 참고용이라 컨펌은 막지 않아요">
    <div className="yp-chips">{pill}{current?.state === "done" ? <small className="yp-muted">{modelName(current.model)}</small> : null}</div>
    {current?.state === "failed" && !waiting ? <p className="yp-hint">{current.error}</p> : null}
    {groups.length ? <ul className="yp-card-checks">{groups.map((group, index) => <li key={index} className="yp-warn">
      <b>{group.kind}</b> · {group.issue}{group.fix ? ` → ${group.fix}` : ""}
      <span className="yp-chips">{group.scenes.map(card => <button key={card} type="button" className="yp-btn" onClick={() => show(card)}>{card}번 카드</button>)}</span></li>)}</ul> : null}
    {current?.state === "done" && current.note ? <p className="yp-hint">{current.note}</p> : null}
    <div className="yp-row-btns">
      <select aria-label="검사 모델" value={tier} disabled={waiting} onChange={event => setTier(event.target.value as GptTier)}>
        {(Object.keys(GPT_TIERS) as GptTier[]).map(key => <option key={key} value={key}>{GPT_TIERS[key].label} · {modelName(GPT_TIERS[key].model)}</option>)}</select>
      <button type="button" className="yp-btn" disabled={waiting} onClick={() => void again()}>{current ? "다시 검사" : "검사하기"}</button><CostTag kind="paid" />
    </div>
    {error ? <p className="yp-hint yp-bad" role="alert">{error}</p> : null}
    {cost.element}
  </YpSection>;
}

const saveBlob = (blob: Blob, name: string) => { const url = URL.createObjectURL(blob); const link = document.createElement("a"); link.href = url; link.download = name; link.click(); window.setTimeout(() => URL.revokeObjectURL(url), 10_000); };

/** 내보내기: the images and caption to post by hand (자동 발행 comes later, with its own approval), the address it went up at, then 끝내기. */
export function CardExportScreen({ page, header }: { page: YpPage; header: ReactNode }) {
  const project = page.bundle?.project;
  const cards = page.bundle?.stages.cards;
  const draft = confirmedDraft(page);
  const [episode, setEpisode] = useState(1);
  const [url, setUrl] = useState("");
  const [why, setWhy] = useState("");
  const [busy, setBusy] = useState("");

  const publication = project?.yp.stage === "done" ? project.yp.cardPublication : undefined;
  const progress = cards ? cardPublicationProgress(cards.data) : null;
  const savedUrl = (publication?.posts ?? progress?.posts)?.find(post => post.episode === episode)?.url ?? "";
  useEffect(() => { setEpisode(1); }, [project?.id]);
  useEffect(() => { setUrl(savedUrl); }, [savedUrl, episode, project?.id]);
  useEffect(() => { setWhy(progress?.reason ?? ""); }, [progress?.reason, project?.id]);
  const photos = useCardPhotoUrls(page, [draft]);
  if (!page.bundle || !project || !cards || !progress) return <YpFrame page={page} view={5} action={null} header={header} title="내보내기" sub="" />;
  const run = async (what: string, work: () => Promise<unknown>) => { setBusy(what); try { await work(); } catch (reason) { page.fail(reason); } finally { setBusy(""); } };
  const caption = draft ? [draft.caption.trim(), draft.hashtags.map(tag => `#${tag}`).join(" ")].filter(Boolean).join("\n\n") : "";
  const finish = () => run("finish", async () => { const next = await page.client!.move(project.id, "done", project.version); page.setBundle(current => current ? { ...current, project: next } : current); });
  const dirty = url.trim() !== savedUrl || why.trim() !== progress.reason;
  const ready = (!progress.missing || [...progress.reason].length >= 4) && !dirty;
  const persistEvidence = async (evidence: { url?: string; episode?: number; withheldReason?: string; downloaded?: true; copied?: true; posted?: true }) => {
    const result = await page.client!.saveStage(project.id, "cards", cards.version, { exported: evidence });
    page.setBundle(current => current ? { ...current, project: result.project, stages: { ...current.stages, cards: result.stage } } : current);
  };
  const save = (evidence: Parameters<typeof persistEvidence>[0]) => run("evidence", () => persistEvidence(evidence));
  const action = stepAction(page, 5, publication ? { kind: "status", status: publication.status === "published" ? "끝난 카드뉴스 · 게시 확인" : "끝난 카드뉴스 · 게시 안 함" }
    : { kind: "button", label: progress.missing && progress.reason ? "게시 안 함으로 마치기" : "다 올렸으면 끝내기", reason: ready ? "" : dirty ? "입력한 내용을 먼저 저장해 주세요." : "게시 주소 또는 게시 안 함 이유를 남겨 주세요.", busy: Boolean(busy), onClick: () => void finish() });
  const remainingZip = Array.from({ length: progress.episodes }, (_, i) => i + 1).find(i => !cards.data.exported?.downloadedEpisodes?.includes(i));
  const evidence = cards.data.exported;
  const todo = [{ label: "이미지 내려받기", done: !remainingZip }, { label: "캡션 복사", done: Boolean(evidence?.copiedAt) },
    { label: "게시 확인", done: Boolean(evidence?.postedAt) }, { label: "게시 주소", done: !progress.missing }];
  const nextTask = remainingZip ? { label: progress.episodes > 1 ? `${remainingZip}화 내려받기` : "이미지 내려받기", selector: `[data-card-zip="${remainingZip}"]` }
    : !evidence?.copiedAt ? { label: "캡션 복사", selector: "[data-card-copy]" }
    : !evidence.postedAt ? { label: "인스타그램에 올렸어요", selector: "[data-card-posted]" }
    : { label: "게시 주소 입력", selector: "[data-card-url]" };
  return <YpFrame page={page} view={5} action={action} todo={todo}
    mobileAction={project.yp.stage === "upload" && !ready && !(page.demo && remainingZip) ? { kind: "button", label: nextTask.label, busy: Boolean(busy), onClick: () => {
      const target = document.querySelector<HTMLElement>(nextTask.selector);
      if (target instanceof HTMLInputElement) { target.focus(); target.scrollIntoView({ block: "center" }); } else target?.click();
    } } : undefined} header={header} title="내보내기" sub="이미지를 내려받아 인스타그램에 올리고, 올린 주소를 남긴 뒤 끝내요.">
    {!["upload", "done"].includes(project.yp.stage) ? <LockedStep page={page} name="내보내기" /> : <>
      <GateBanner page={page} gate="review" />
      <Subject page={page} />
      <CardCanonContext source={cards.data.source} focus={cards.data.focus} />
      <CanonRail refs={draft?.ai?.trace} legacy={draft?.ai?.canon} />
      {project.yp.stage === "done" && !publication && <button type="button" className="yp-btn yp-pri" disabled={!ready || Boolean(busy)} onClick={() => void finish()}>게시 기록 확정</button>}
      {!publication && <p className="yp-hint" role="status">{cards.data.exported?.downloadedEpisodes?.length ? `내보냄 · ${cards.data.exported.downloadedEpisodes.length}/${progress.episodes}화` : "승인 · 내보내기 준비"}</p>}
      <YpSection n={1} title="이미지 · 캡션" gq={draft ? `${draft.slides.length}장 · 1080 × 1350` : ""}>
        {page.demo && <p className="yp-hint">연습 화면에서는 카드 미리보기만 제공합니다. PNG 다운로드는 로그인한 작업 공간에서 이용할 수 있어요.</p>}
        {draft ? <CardPhotos.Provider value={photos}><div className="yp-card-strip">{draft.slides.map((_, index) => <CardPreview key={index} draft={draft} index={index} width={120} />)}</div></CardPhotos.Provider> : null}
        <div className="yp-row-btns" style={{ marginTop: 10 }}>
          {(draft && toonUploads(draft).length > 1 ? toonUploads(draft) : [null]).map((post, at) => {
            // 웹툰형 goes up one 화 per post, so each 화 is its own ZIP (대표 2026-11-04).
            const name = post && draft ? draft.slides[post.from].fields.episode?.trim() || `${at + 1}화` : "", key = post ? `zip${at + 1}` : "zip";
            return <button key={key} data-card-zip={at + 1} type="button" className={at ? "yp-btn" : "yp-btn yp-pri"} disabled={page.demo || !draft || Boolean(busy)} onClick={() => void run(key, async () => {
              saveBlob(await page.client!.cardsFile(project.id, post ? { zip: true, upload: at + 1 } : { zip: true }), `카드뉴스-${projectName(project).slice(0, 30)}${post ? `-${name}` : ""}.zip`);
              if (!publication && !cards.data.exported?.downloadedEpisodes?.includes(at + 1)) await persistEvidence({ downloaded: true, episode: at + 1 });
            })}>
              <Download size={14} aria-hidden="true" /> {busy === key ? "만드는 중…" : post ? `${name} 내려받기 (${post.to - post.from}장)` : "이미지 묶음 내려받기"}</button>;
          })}
          <button type="button" className="yp-btn" data-card-copy disabled={!caption || Boolean(busy)} onClick={() => void run("copy", async () => {
            await navigator.clipboard.writeText(caption);
            if (!publication && !cards.data.exported?.copiedAt) await persistEvidence({ copied: true });

          })}><Copy size={14} aria-hidden="true" /> {cards.data.exported?.copiedAt ? "캡션 다시 복사" : "캡션 복사"}</button></div>
      </YpSection>
      {!publication && <button className="yp-btn" type="button" data-card-posted disabled={Boolean(busy) || Boolean(cards.data.exported?.postedAt)} onClick={() => void save({ posted: true })}>{cards.data.exported?.postedAt ? "✓ 게시 확인했어요" : "인스타그램에 올렸어요"}</button>}
      <YpSection n={2} title="올린 주소" gq="인스타그램 게시물 주소">
        {progress.episodes > 1 && <label>게시할 화 <select className="yp-in yp-w-auto" value={episode} onChange={e => setEpisode(Number(e.target.value))}>
          {Array.from({ length: progress.episodes }, (_, i) => <option key={i} value={i + 1}>{i + 1}화 · {progress.posts.some(post => post.episode === i + 1) ? "주소 있음" : "주소 없음"}</option>)}</select></label>}
        <div className="yp-row-btns"><input className="yp-in" style={{ flex: 1 }} value={url} readOnly={Boolean(publication)} onChange={event => setUrl(event.target.value)} data-card-url placeholder="https://www.instagram.com/p/…" aria-label="올린 주소" />
          {!publication && <button type="button" className="yp-btn" disabled={!instagramPostId(url.trim()) || Boolean(busy) || url.trim() === savedUrl}
            onClick={() => void save({ url: url.trim(), episode })}>주소 남기기</button>}</div>
        <details><summary>자주 쓰는 주소</summary><CardUrlBookmarks ownerId={page.profile?.id} url={url} onLoad={publication ? undefined : setUrl} /></details>
        {cards.data.exported ? <p className="yp-hint">남김 · {cards.data.exported.by} · 게시 주소 {progress.urls.length}/{progress.episodes}</p> : null}
        {publication?.reason && <p>게시 안 함 · {publication.reason}</p>}
        {!publication && progress.missing > 0 && <details><summary>남은 화 게시 안 함</summary>
          <label>게시 안 함 이유 (4자 이상)<input className="yp-in" value={why} maxLength={500} onChange={e => setWhy(e.target.value)} /></label>
          <button type="button" className="yp-btn" disabled={Boolean(busy) || (Boolean(why.trim()) && [...why.trim()].length < 4) || why.trim() === progress.reason} onClick={() => void save({ withheldReason: why.trim() })}>이유 저장</button></details>}
      </YpSection>
    </>}
  </YpFrame>;
}
