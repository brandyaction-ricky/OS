"use client";
// 카드뉴스 (설계서 2026-10-30): 주제 → 카드 만들기 → 최종 검토 → 내보내기. Cards are written and seen in one place: the preview is the
// same drawing the PNG uses (lib/cardnews/card-slide), so what the PD sees is what gets downloaded.
import "./youtube-process-card.css";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { ArrowDown, ArrowRight, ArrowUp, Copy, Download, GalleryHorizontal, Plus, Trash2 } from "lucide-react";
import { CardSlideView } from "@/lib/cardnews/card-slide";
import { cardsMissing } from "@/lib/cardnews/cards";
import { addCardSlide, CARD_FORMAT_IDS, CARD_FORMATS, CARD_MAX_SLIDES, CARD_SIZE, cardProblems, moveCardSlide, parseCardHashtags, removeCardSlide, slideSpec, type CardDraft, type CardFormatId } from "@/lib/cardnews/formats";
import type { CardSourceChoice } from "@/lib/cardnews/sources";
import { draftTag } from "@/lib/youtube-process/gpt-draft";
import { projectName, stepHref, type YpProject } from "@/lib/youtube-process/project";
import { CostTag } from "./cost-notice";
import { useSession } from "./session-provider";
import { JobLine, SendDialog, useStaffJob } from "./youtube-process-ai";
import { errorMessage, youtubeProcessClient, type YpClient } from "./youtube-process-data";
import { CardSourcePicker } from "./card-source-picker";
import { CardUrlBookmarks } from "./card-url-bookmarks";
import { GateBanner, gateAction, gateSub, LockedStep, stepAction, Subject, useGate, useLeaveGuard, YpFrame, YpSection, type YpPage } from "./youtube-process-frame";

const letters = (value: string) => [...value].length;
const SOURCE_NAME = { longform: "롱폼", short: "숏폼", threads: "스레드", none: "" } as const;

/** One card at `width` px, drawn at 1080 × 1350 and scaled; reports the fields whose text runs past their lines. */
export function CardPreview({ draft, index, width, onOver }: { draft: CardDraft; index: number; width: number; onOver?: (index: number, fields: string[]) => void }) {
  const box = useRef<HTMLDivElement>(null);
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
    <div style={{ transform: `scale(${scale})`, transformOrigin: "0 0", width: CARD_SIZE.width, height: CARD_SIZE.height }}><CardSlideView draft={draft} index={index} /></div>
  </div>;
}

/** 주제 찾기 › 카드뉴스: a topic of its own (the other three ways in are buttons on a finished video or an approved Threads post). */
export function CardStart({ initial = "" }: { initial?: string }) {
  const { accessToken, demo } = useSession();
  const client = useMemo(() => youtubeProcessClient(accessToken, demo), [accessToken, demo]);
  const router = useRouter();
  const [form, setForm] = useState({ title: initial, target: "", note: "" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [projects, setProjects] = useState<YpProject[] | null>(null);
  const [tab, setTab] = useState<"open" | "done">("open");
  useEffect(() => { let active = true; if (client) client.list().then(rows => { if (active) setProjects(rows); }, reason => { if (active) setError(errorMessage(reason)); }); return () => { active = false; }; }, [client]);
  const bring = async (source: CardSourceChoice) => {
    if (!client || busy) return;
    setBusy(true); setError("");
    try { const made = await client.createCard(source.from === "project" ? { from: "project", projectId: source.id } : { from: "threads", itemId: source.id }); router.push(stepHref(1, made.id)); }
    catch (reason) { setError(errorMessage(reason)); } finally { setBusy(false); }
  };
  const start = async () => {
    if (!client) return;
    setBusy(true); setError("");
    try { const made = await client.createCard({ from: "none", title: form.title.trim(), target: form.target.trim(), note: form.note.trim() }); router.push(stepHref(1, made.id)); }
    catch (reason) { setError(errorMessage(reason)); setBusy(false); }
  };
  const open = (projects ?? []).filter(project => project.yp.topic.type === "card" && project.yp.stage !== "done");
  const done = (projects ?? []).filter(project => project.yp.topic.type === "card" && project.yp.stage === "done");
  const ready = form.title.trim().length >= 2 && form.target.trim().length > 0;
  return <>
    <CardSourcePicker client={client} busy={busy} onPick={bring} />
    <form className="yp-card yp-pf-start yp-pf-card" onSubmit={event => { event.preventDefault(); if (ready) void start(); }}>
      <div className="yp-card-h">카드뉴스 시작하기</div>
      <div className="yp-card-b" style={{ display: "grid", gap: 10 }}>
        <p className="yp-hint" style={{ margin: 0 }}>새 주제를 직접 쓰거나 위에서 완료한 롱폼·숏폼·스레드 주제를 가져와 시작해요.</p>
        <label className="yp-field" style={{ margin: 0 }}><span className="yp-fld-h"><b>한 줄 주제</b><span className="yp-need">필수</span></span>
          <input className="yp-in" value={form.title} maxLength={200} onChange={event => setForm({ ...form, title: event.target.value })} placeholder="예) 월요일마다 무거운 사람의 공통점" aria-label="한 줄 주제" /></label>
        <label className="yp-field" style={{ margin: 0 }}><span className="yp-fld-h"><b>누구에게</b><span className="yp-need">필수</span></span>
          <input className="yp-in" value={form.target} maxLength={300} onChange={event => setForm({ ...form, target: event.target.value })} placeholder="예) 일이 안 맞는 것 같은데 이유를 모르는 3~7년 차 직장인" aria-label="누구에게" /></label>
        <label className="yp-field" style={{ margin: 0 }}><span className="yp-fld-h"><b>메모 · 근거</b><span className="yp-opt">선택</span></span>
          <textarea className="yp-in" rows={3} value={form.note} maxLength={2000} onChange={event => setForm({ ...form, note: event.target.value })} placeholder="담을 내용, 근거 자료, 참고 카드뉴스 주소" aria-label="메모 · 근거" /></label>
        {error ? <p className="yp-errline" role="alert">{error}</p> : null}
        <div className="yp-row-btns"><button type="submit" className="yp-btn yp-pri" disabled={busy || !ready}>{busy ? "만드는 중…" : "카드 만들러 가기"} <ArrowRight size={14} aria-hidden="true" /></button></div>
      </div>
    </form>
    <div className="yp-card-tabs" role="tablist" aria-label="카드뉴스 상태" onKeyDown={event => {
      if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
      event.preventDefault();
      const tabs = [...event.currentTarget.querySelectorAll<HTMLButtonElement>("[role=tab]")];
      const index = event.key === "Home" ? 0 : event.key === "End" ? 1 : (tabs.indexOf(event.target as HTMLButtonElement) + (event.key === "ArrowRight" ? 1 : -1) + 2) % 2;
      tabs[index]?.focus(); setTab(index ? "done" : "open");
    }}>
      {([{ key: "open", label: "만드는 중인 카드뉴스", count: open.length }, { key: "done", label: "완료된 카드뉴스", count: done.length }] as const).map(item =>
        <button key={item.key} id={`yp-card-tab-${item.key}`} type="button" role="tab" aria-selected={tab === item.key} aria-controls="yp-card-status-panel" tabIndex={tab === item.key ? 0 : -1} className={tab === item.key ? "yp-on" : ""} onClick={() => setTab(item.key)}>{item.label}<span className="yp-card-tab-count">{item.count}</span></button>)}
    </div>
    <CardList key={tab} tab={tab} title={tab === "done" ? "완료된 카드뉴스" : "만드는 중인 카드뉴스"} client={client} projects={projects === null ? null : tab === "done" ? done : open} />
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
  const [chosen, setChosen] = useState<CardFormatId[]>([]);
  const [send, setSend] = useState(false);
  const [draft, setDraft] = useState<CardDraft | null>(null);
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [slide, setSlide] = useState(0);
  const [undo, setUndo] = useState<CardDraft | null>(null);
  const [composing, setComposing] = useState(false);
  const [over, setOver] = useState<Record<number, string[]>>({});
  const picked = cards?.drafts.find(row => row.id === cards.picked) ?? null;
  useEffect(() => { if (!dirty) setDraft(picked); }, [picked, dirty]);
  useEffect(() => { if (cards?.recommend?.formats.length && !chosen.length) setChosen(cards.recommend.formats.slice(0, 3)); }, [cards?.recommend, chosen.length]);
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
  if (!page.bundle || !project || !cards) return <YpFrame page={page} view={1} action={null} header={header} title="카드 만들기" sub="" />;

  const overList = Object.entries(over).filter(([index, fields]) => fields.length && Number(index) < (draft?.slides.length ?? 0))
    .map(([index, fields]) => `${Number(index) + 1}장 ${fields.map(key => slideSpec(draft!.format, draft!.slides[Number(index)].type)?.fields.find(field => field.key === key)?.label ?? key).join(" · ")} 칸이 넘쳐요`);
  const problems = draft ? cardProblems(draft) : { blocking: [], warnings: [] };
  const missing = cardsMissing(draft ? { ...cards, drafts: cards.drafts.map(row => row.id === draft.id ? draft : row) } : cards) || overList[0] || "";
  const action = gateAction(page, "draft", 1, control, missing);
  const current = draft?.slides[slide] ? slide : 0;
  const spec = draft ? slideSpec(draft.format, draft.slides[current].type) : null;
  const addBlank = async () => { for (const format of chosen) if (!(await save({ add: format }))) return; };

  return <YpFrame page={page} view={1} action={action} header={header} title="카드 만들기"
    sub={gateSub(project, "draft", "포맷을 골라 초안을 뽑고, 하나를 골라 다듬은 뒤 카드를 확정해요.", "카드를 확정했어요. 최종 검토에서 한 장씩 봐요.")}
    todo={editable ? [{ label: "초안", done: cards.drafts.length > 0 }, { label: "고른 초안", done: Boolean(picked) }, { label: "글자 수 · 넘침", done: Boolean(draft) && !problems.blocking.length && !overList.length }] : undefined}>
    <GateBanner page={page} gate="draft" />
    <Subject page={page} />
    {cards.source.kind !== "none" ? <details className="yp-card yp-card-src"><summary>원본 · {SOURCE_NAME[cards.source.kind]} 「{cards.source.title}」{cards.focus ? ` · 이 부분 위주로: ${cards.focus}` : ""}</summary>
      <pre>{cards.source.text}</pre></details> : null}

    {editable ? <YpSection n={1} title="포맷 고르기" gq="최대 3개를 한 번에 뽑아 나란히 비교해요">
      <div className="yp-card-formats">{CARD_FORMAT_IDS.map(id => { const format = CARD_FORMATS[id]; const on = chosen.includes(id);
        return <label key={id} className={`yp-card-format${on ? " yp-on" : ""}`}>
          <input type="checkbox" aria-label={format.name} checked={on} disabled={!on && chosen.length >= 3} onChange={() => setChosen(on ? chosen.filter(row => row !== id) : [...chosen, id])} />
          <span><b>{format.name}</b>{cards.recommend?.formats.includes(id) ? <span className="yp-tag yp-acc">추천</span> : null}<small>{format.when}</small>
            <small>{format.slides.map(row => row.min === row.max ? `${row.label} ${row.min}` : `${row.label} ${row.min}~${row.max}`).join(" · ")}장</small></span></label>; })}</div>
      {cards.recommend?.why ? <p className="yp-hint">추천 이유: {cards.recommend.why}</p> : null}
      <div className="yp-row-btns">
        <button type="button" className="yp-btn yp-pri" disabled={!chosen.length || job.open} onClick={() => setSend(true)}>AI로 초안 뽑기 ({chosen.length}개)</button><CostTag kind="paid" />
        <button type="button" className="yp-btn" disabled={!chosen.length || busy} onClick={() => void addBlank()}>직접 쓰기</button></div>
      <JobLine job={job} onRetry={() => setSend(true)} />
      <SendDialog page={page} task="card" open={send} onClose={() => setSend(false)} job={job} extra={{ formats: chosen }} />
    </YpSection> : null}

    {cards.drafts.length ? <YpSection n={editable ? 2 : 1} title="초안 비교" gq={`${cards.drafts.length}개 · 표지와 앞 3장`}>
      <div className="yp-card-rows">{cards.drafts.map(row => { const check = cardProblems(row); const mine = row.id === cards.picked;
        return <div key={row.id} className={`yp-card-row${mine ? " yp-on" : ""}`}>
          <div className="yp-card-row-h"><b>{CARD_FORMATS[row.format].name}</b><span className="yp-tag">{draftLabel(row)}</span><span className="yp-muted">{row.slides.length}장</span>
            <span className={check.blocking.length ? "yp-tag yp-bad" : "yp-tag yp-ok"}>{check.blocking.length ? `고칠 곳 ${check.blocking.length}` : "글자 수 통과"}</span><span className="yp-sp" />
            {mine ? <span className="yp-tag yp-acc">고른 초안</span> : editable ? <button type="button" className="yp-btn yp-sm" disabled={busy || dirty} onClick={() => void save({ pick: row.id })}>이걸로 하기</button> : null}
            {editable && !mine ? <button type="button" className="yp-btn yp-sm" aria-label="초안 지우기" disabled={busy} onClick={() => { if (window.confirm("이 초안을 지울까요?")) void save({ remove: row.id }); }}><Trash2 size={13} /></button> : null}</div>
          <div className="yp-card-strip">{row.slides.slice(0, 4).map((_, index) => <CardPreview key={index} draft={row} index={index} width={150} />)}</div>
        </div>; })}</div>
    </YpSection> : null}

    {draft ? <YpSection n={editable ? 3 : 2} title={editable ? "고른 초안 다듬기" : "확정한 카드"} gq={`${CARD_FORMATS[draft.format].name} · ${draft.slides.length}장`}>
      <div className="yp-card-tools" aria-label="카드 장 관리">
        <b>카드 {draft.slides.length} / {CARD_MAX_SLIDES}장</b>
        {editable && CARD_FORMATS[draft.format].slides.filter(item => item.max > item.min).map(item => <button key={item.type} type="button" className="yp-btn yp-sm" disabled={addCardSlide(draft, item.type) === draft} onClick={() => structure(addCardSlide(draft, item.type), current)}><Plus size={13} />{item.label} 카드 추가</button>)}
        {editable && <button type="button" className="yp-btn yp-sm" disabled={!undo} onClick={() => { if (undo) { edit(undo); setOver({}); setSlide(Math.min(current, undo.slides.length - 1)); setUndo(null); } }}>장 편집 되돌리기</button>}
        <span role="status" className="yp-hint">{busy ? "저장 중…" : dirty ? "변경 내용 저장 대기" : "저장됨"}</span>
      </div>
      <div className="yp-card-edit">
        <div className="yp-card-list" aria-label="카드 순서">{draft.slides.map((row, index) => <div key={index} className="yp-card-item" draggable={editable && (slideSpec(draft.format, row.type)?.max ?? 0) > 1}
          onDragStart={event => event.dataTransfer.setData("application/x-card-slide", JSON.stringify({ id: draft.id, index }))}
          onDragOver={event => { if (editable && event.dataTransfer.types.includes("application/x-card-slide")) event.preventDefault(); }}
          onDrop={event => { if (!editable) return; event.preventDefault(); try { const from = JSON.parse(event.dataTransfer.getData("application/x-card-slide")); if (from.id === draft.id) { const next = moveCardSlide(draft, from.index, index); structure(next, next === draft ? current : index); } } catch { /* External or malformed drops do not change the draft. */ } }}>
          <button type="button" className={index === current ? "yp-on" : ""} onClick={() => setSlide(index)} aria-label={`${index + 1}장 보기`} aria-pressed={index === current}>
            <CardPreview draft={draft} index={index} width={84} onOver={onOver} /><span>{index + 1} · {slideSpec(draft.format, row.type)?.label}{over[index]?.length ? " · 넘침" : ""}</span></button>
          {editable && <div className="yp-card-item-actions">
            <button type="button" aria-label={`${index + 1}장 위로`} title="위로 이동" disabled={moveCardSlide(draft, index, index - 1) === draft} onClick={() => structure(moveCardSlide(draft, index, index - 1), index - 1)}><ArrowUp size={13} /></button>
            <button type="button" aria-label={`${index + 1}장 아래로`} title="아래로 이동" disabled={moveCardSlide(draft, index, index + 1) === draft} onClick={() => structure(moveCardSlide(draft, index, index + 1), index + 1)}><ArrowDown size={13} /></button>
            <button type="button" aria-label={`${index + 1}장 삭제`} title="이 장 삭제 (최소 장수는 유지)" disabled={removeCardSlide(draft, index) === draft} onClick={() => { if (!Object.values(row.fields).some(Boolean) || window.confirm("이 카드의 내용을 뺄까요? 장 편집 되돌리기로 복원할 수 있어요.")) structure(removeCardSlide(draft, index), Math.max(0, index - 1)); }}><Trash2 size={13} /></button>
          </div>}
        </div>)}</div>
        <CardEditorPreview draft={draft} index={current} />
        <div className="yp-card-fields">
          <h3>{current + 1}장 · {spec?.label}</h3>
          {spec?.fields.map(field => { const value = draft.slides[current].fields[field.key] ?? ""; const n = letters(value);
            const set = (text: string) => edit({ ...draft, slides: draft.slides.map((row, index) => index === current ? { ...row, fields: { ...row.fields, [field.key]: text } } : row) });
            return <label key={field.key} className="yp-field"><span className="yp-fld-h"><b>{field.label}</b>{field.optional ? <span className="yp-opt">선택</span> : null}
              <span className={n > field.max ? "yp-card-n yp-bad" : "yp-card-n"}>{n}/{field.max}</span>{over[current]?.includes(field.key) ? <span className="yp-tag yp-bad">넘침</span> : null}</span>
              <textarea className="yp-in" rows={field.max > 30 ? 3 : 2} value={value} aria-label={field.label} disabled={!editable} onCompositionStart={() => setComposing(true)} onCompositionEnd={() => setComposing(false)} onChange={event => set(event.target.value)} /></label>; })}
        </div>
      </div>
      <CardPostFields key={draft.id} draft={draft} editable={editable} onEdit={edit} onComposing={setComposing} />
      {problems.blocking.length || overList.length || problems.warnings.length ? <ul className="yp-card-checks">
        {[...problems.blocking, ...overList].map(text => <li key={text} className="yp-bad">{text}</li>)}
        {problems.warnings.map(text => <li key={text} className="yp-warn">{text}</li>)}</ul> : null}
    </YpSection> : editable && !cards.drafts.length ? <p className="yp-pempty">포맷을 고르고 초안을 뽑으면 여기서 카드를 다듬어요.</p> : null}
  </YpFrame>;
}

function CardEditorPreview({ draft, index }: { draft: CardDraft; index: number }) {
  const box = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(320);
  useLayoutEffect(() => {
    const element = box.current;
    if (!element) return;
    const measure = () => { if (element.clientWidth > 0) setWidth(Math.min(400, element.clientWidth)); };
    measure(); const observer = new ResizeObserver(measure); observer.observe(element);
    return () => observer.disconnect();
  }, []);
  return <div className="yp-card-big" ref={box}><CardPreview draft={draft} index={index} width={width} /></div>;
}

function CardPostFields({ draft, editable, onEdit, onComposing }: { draft: CardDraft; editable: boolean; onEdit: (draft: CardDraft) => void; onComposing: (value: boolean) => void }) {
  const [tags, setTags] = useState(() => draft.hashtags.map(tag => `#${tag}`).join(" "));
  const focused = useRef(false);
  useEffect(() => { if (!focused.current) setTags(draft.hashtags.map(tag => `#${tag}`).join(" ")); }, [draft.hashtags]);
  return <section className="yp-card-post" aria-label="카드뉴스 공통 게시글">
    <h3>공통 게시글 · 모든 카드에 함께 사용</h3><p className="yp-hint">카드를 바꿔도 이 영역은 유지됩니다. 최종 검토와 내보내기에서도 확인할 수 있어요.</p>
    <label className="yp-field"><span className="yp-fld-h"><b>캡션</b><span className="yp-card-n">{letters(draft.caption)}자</span></span><textarea className="yp-in" rows={5} aria-label="공통 캡션" value={draft.caption} disabled={!editable} onCompositionStart={() => onComposing(true)} onCompositionEnd={() => onComposing(false)} onChange={event => onEdit({ ...draft, caption: event.target.value })} /></label>
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
  if (!page.bundle || !project) return <YpFrame page={page} view={4} action={null} header={header} title="최종 검토" sub="" />;
  const check = draft ? cardProblems(draft) : { blocking: ["확정한 카드가 없어요"], warnings: [] };
  const overCount = Object.values(over).filter(fields => fields.length).length;
  const action = gateAction(page, "review", 4, control, check.blocking[0] ?? (overCount ? `넘치는 카드가 ${overCount}장 있어요` : ""));
  return <YpFrame page={page} view={4} action={action} header={header} title="최종 검토" sub={gateSub(project, "review", "카드를 한 장씩 보고 컨펌해요. 고칠 곳이 있으면 대표 노트를 보고 카드 만들기로 돌아가요.", "최종 검토를 마쳤어요. 내보내기에서 이미지를 내려받아요.")}>
    {["topic", "draft"].includes(project.yp.stage) ? <LockedStep page={page} name="최종 검토" /> : <>
      <GateBanner page={page} gate="review" />
      <Subject page={page} />
      {draft ? <>
        <YpSection n={1} title="카드" gq={`${CARD_FORMATS[draft.format].name} · ${draft.slides.length}장`}>
          <div className="yp-card-grid">{draft.slides.map((_, index) => <CardPreview key={index} draft={draft} index={index} width={260} onOver={onOver} />)}</div>
        </YpSection>
        <YpSection n={2} title="캡션 · 해시태그"><p className="yp-card-caption">{draft.caption || "캡션이 없어요"}</p><p className="yp-muted">{draft.hashtags.map(tag => `#${tag}`).join(" ")}</p></YpSection>
        {check.blocking.length || check.warnings.length || overCount ? <ul className="yp-card-checks">{check.blocking.map(text => <li key={text} className="yp-bad">{text}</li>)}
          {overCount ? <li className="yp-bad">넘치는 카드가 {overCount}장 있어요</li> : null}{check.warnings.map(text => <li key={text} className="yp-warn">{text}</li>)}</ul> : null}
      </> : <p className="yp-pempty">확정한 카드가 없어요.</p>}
    </>}
  </YpFrame>;
}

const saveBlob = (blob: Blob, name: string) => { const url = URL.createObjectURL(blob); const link = document.createElement("a"); link.href = url; link.download = name; link.click(); window.setTimeout(() => URL.revokeObjectURL(url), 10_000); };

/** 내보내기: the images and caption to post by hand (자동 발행 comes later, with its own approval), the address it went up at, then 끝내기. */
export function CardExportScreen({ page, header }: { page: YpPage; header: ReactNode }) {
  const project = page.bundle?.project;
  const cards = page.bundle?.stages.cards;
  const draft = confirmedDraft(page);
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState("");
  const [copied, setCopied] = useState(false);
  useEffect(() => { if (cards?.data.exported?.url) setUrl(cards.data.exported.url); }, [cards?.data.exported?.url]);
  if (!page.bundle || !project || !cards) return <YpFrame page={page} view={5} action={null} header={header} title="내보내기" sub="" />;
  const run = async (what: string, work: () => Promise<unknown>) => { setBusy(what); try { await work(); } catch (reason) { page.fail(reason); } finally { setBusy(""); } };
  const caption = draft ? [draft.caption.trim(), draft.hashtags.map(tag => `#${tag}`).join(" ")].filter(Boolean).join("\n\n") : "";
  const finish = () => run("finish", async () => { const next = await page.client!.move(project.id, "done", project.version); page.setBundle(current => current ? { ...current, project: next } : current); });
  const action = stepAction(page, 5, project.yp.stage === "done" ? { kind: "status", status: "끝난 카드뉴스예요" }
    : { kind: "button", label: "다 올렸으면 끝내기", reason: "", busy: busy === "finish", onClick: () => void finish() });
  return <YpFrame page={page} view={5} action={action} header={header} title="내보내기" sub="이미지를 내려받아 인스타그램에 올리고, 올린 주소를 남긴 뒤 끝내요."
    todo={project.yp.stage === "upload" ? [{ label: "이미지 내려받기", done: Boolean(cards.data.exported) || busy === "zip" }, { label: "올린 주소", done: Boolean(cards.data.exported) }] : undefined}>
    {!["upload", "done"].includes(project.yp.stage) ? <LockedStep page={page} name="내보내기" /> : <>
      <GateBanner page={page} gate="review" />
      <Subject page={page} />
      <YpSection n={1} title="이미지 · 캡션" gq={draft ? `${draft.slides.length}장 · 1080 × 1350` : ""}>
        {draft ? <div className="yp-card-strip">{draft.slides.map((_, index) => <CardPreview key={index} draft={draft} index={index} width={120} />)}</div> : null}
        <div className="yp-row-btns" style={{ marginTop: 10 }}>
          <button type="button" className="yp-btn yp-pri" disabled={!draft || Boolean(busy)} onClick={() => void run("zip", async () => saveBlob(await page.client!.cardsFile(project.id, { zip: true }), `카드뉴스-${projectName(project).slice(0, 30)}.zip`))}>
            <Download size={14} aria-hidden="true" /> {busy === "zip" ? "만드는 중…" : "이미지 묶음 내려받기"}</button>
          <button type="button" className="yp-btn" disabled={!caption} onClick={() => void navigator.clipboard.writeText(caption).then(() => setCopied(true))}><Copy size={14} aria-hidden="true" /> {copied ? "복사했어요" : "캡션 복사"}</button></div>
      </YpSection>
      <YpSection n={2} title="올린 주소" gq="인스타그램 게시물 주소">
        <div className="yp-row-btns"><input className="yp-in" style={{ flex: 1 }} value={url} onChange={event => setUrl(event.target.value)} placeholder="https://www.instagram.com/p/…" aria-label="올린 주소" />
          <button type="button" className="yp-btn" disabled={!/^https:\/\/\S+$/.test(url.trim()) || Boolean(busy) || url.trim() === cards.data.exported?.url}
            onClick={() => void run("url", async () => { const result = await page.client!.saveStage(project.id, "cards", cards.version, { exported: { url: url.trim() } }); page.setBundle(current => current ? { ...current, project: result.project, stages: { ...current.stages, cards: result.stage } } : current); })}>
            {busy === "url" ? "남기는 중…" : "주소 남기기"}</button></div>
        <CardUrlBookmarks ownerId={page.profile?.id} url={url} onLoad={setUrl} />
        {cards.data.exported ? <p className="yp-hint">남김 · {cards.data.exported.by}</p> : null}
      </YpSection>
    </>}
  </YpFrame>;
}
