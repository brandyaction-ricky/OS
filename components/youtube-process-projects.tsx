"use client";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowRight, Plus, Radar, Search, X } from "lucide-react";
import { projectName, searchProjects, stepHref, type YpProject } from "@/lib/youtube-process/project";
import { nextAction } from "@/lib/youtube-process/next";
import { ContentRadarWorkspace } from "./content-radar-workspace";
import { useSession } from "./session-provider";
import { useYoutubeCanConfirm } from "./use-youtube-confirm";
import { errorMessage, youtubeProcessClient, type YpLegacyTopic, type YpMember } from "./youtube-process-data";

type Filter = "open" | "mine" | "done";

/** 내 영상 (S1, redesigned 2026-10-21 so it reads without a guide): new video in one line, then each video with what it needs next. */
export function YoutubeProjectsScreen() {
  const router = useRouter();
  const discover = useSearchParams().get("view") === "discover";
  const { accessToken, demo, profile } = useSession();
  const client = useMemo(() => youtubeProcessClient(accessToken, demo), [accessToken, demo]);
  const canConfirm = useYoutubeCanConfirm(true, accessToken, demo, profile?.role === "admin");
  const [projects, setProjects] = useState<YpProject[] | null>(null);
  const [legacy, setLegacy] = useState<YpLegacyTopic[]>([]);
  const [members, setMembers] = useState<YpMember[]>([]);
  const [error, setError] = useState("");
  const [filter, setFilter] = useState<Filter>("open");
  const [query, setQuery] = useState("");
  const [creating, setCreating] = useState(false);
  const [title, setTitle] = useState("");
  const [busy, setBusy] = useState(false);
  const [moving, setMoving] = useState<YpLegacyTopic | null>(null);
  const moveDialog = useRef<HTMLDialogElement>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (!client) return;
    let active = true;
    Promise.all([client.list(), client.members().catch(() => [] as YpMember[]), client.legacy().catch(() => [] as YpLegacyTopic[])])
      .then(([list, people, old]) => { if (active) { setProjects(list); setMembers(people); setLegacy(old); setError(""); } })
      .catch(reason => { if (active) setError(errorMessage(reason)); });
    return () => { active = false; };
  }, [client, attempt]);

  const create = async () => {
    if (!client || !title.trim()) return;
    setBusy(true); setError("");
    try { const project = await client.create({ title: title.trim(), assigneeId: profile?.id ?? null }); router.push(stepHref(0, project.id)); }
    catch (reason) { setError(errorMessage(reason)); setBusy(false); }
  };
  const adopt = async () => {
    if (!client || !moving) return;
    setBusy(true); setError("");
    try { const project = await client.adopt(moving.id); moveDialog.current?.close(); router.push(nextAction(project).href); }
    catch (reason) { setError(errorMessage(reason)); moveDialog.current?.close(); setBusy(false); }
  };

  const all = projects ?? [];
  const sorted = [...all].sort((a, b) => {
    // What needs someone first (수정 요청, then work to do), waiting ones after, finished last; newest edit first within.
    const rank = (project: YpProject) => ({ fix: 0, todo: 1, hold: 2, wait: 3, done: 4 })[nextAction(project).tone];
    return rank(a) - rank(b) || b.yp.contentUpdatedAt.localeCompare(a.yp.contentUpdatedAt);
  });
  const counts = { open: all.filter(row => row.yp.stage !== "done").length, mine: all.filter(row => row.yp.stage !== "done" && row.assigneeId === profile?.id).length, done: all.filter(row => row.yp.stage === "done").length };
  const shown = searchProjects(sorted, query).filter(row => filter === "done" ? row.yp.stage === "done" : row.yp.stage !== "done" && (filter === "open" || row.assigneeId === profile?.id));
  const legacyShown = filter === "done" ? [] : legacy.filter(topic => !query.trim() || topic.title.toLocaleLowerCase("ko-KR").includes(query.trim().toLocaleLowerCase("ko-KR")));
  const waitingMine = canConfirm ? all.filter(row => nextAction(row).tone === "wait").length : 0;
  const pdName = (id: string | null) => members.find(member => member.id === id)?.name ?? "";

  if (discover) return <>
    <div className="yp-mv-head"><h1>주제 찾기</h1><span className="yp-sp" style={{ flex: 1 }} /><Link className="yp-btn" href="/content/projects">← 내 영상</Link></div>
    {/* The radar keeps its own screen styles (components/fullscreen-content.css, scoped to .screen-topics). */}
    <div className="ui-v2 screen-topics"><ContentRadarWorkspace startProjectHref={video => `/content/plan?project=new&view=topic&ref=${encodeURIComponent(video.url)}&refTitle=${encodeURIComponent(`${video.title} · ${video.channel}`)}`} /></div>
  </>;

  return <>
    <div className="yp-mv-head"><h1 className="page-title" data-ui="page-title">내 영상</h1><span style={{ flex: 1 }} />
      <Link className="yp-btn yp-lg" href="/content/projects?view=discover&tab=discovery"><Radar size={16} aria-hidden="true" /> 주제 찾기</Link>
      <button type="button" className="yp-btn yp-pri yp-lg" onClick={() => setCreating(true)}><Plus size={16} aria-hidden="true" /> 새 영상 만들기</button></div>
    {creating ? <form className="yp-mv-new" onSubmit={event => { event.preventDefault(); void create(); }}>
      <input className="yp-in" autoFocus maxLength={200} placeholder="어떤 영상을 만들까요? 예) 하루 일이 두 개뿐인데 저녁마다 지치는 이유" aria-label="새 영상 주제" value={title} onChange={event => setTitle(event.target.value)} />
      <button type="submit" className="yp-btn yp-pri" disabled={busy || !title.trim()}>{busy ? "만드는 중…" : "시작하기"} <ArrowRight size={14} aria-hidden="true" /></button>
      <button type="button" className="yp-ib" aria-label="닫기" onClick={() => { setCreating(false); setTitle(""); }}><X size={14} /></button></form> : null}
    {waitingMine ? <div className="yp-note yp-warn" role="status"><div>대표님 컨펌을 기다리는 영상이 <b>{waitingMine}개</b> 있어요. <Link className="yp-lnk" href="/content/confirm">컨펌하러 가기 →</Link></div></div> : null}
    {error ? <div className="yp-note yp-warn" role="alert"><div>{error} <button type="button" className="yp-lnk" onClick={() => setAttempt(value => value + 1)}>다시 불러오기</button></div></div> : null}
    {projects === null && !error ? <p className="yp-hint" role="status">불러오는 중이에요…</p>
      : !all.length && !legacy.length ? <div className="yp-mv-empty"><b>첫 영상을 만들어 보세요</b><span className="yp-muted">주제 한 줄만 쓰면 시작돼요. 나머지는 화면이 차례로 알려 줘요.</span>
        <button type="button" className="yp-btn yp-pri yp-lg" onClick={() => setCreating(true)}><Plus size={16} aria-hidden="true" /> 새 영상 만들기</button></div>
      : <>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", marginBottom: 10 }}>
          <div className="yp-seg2" role="tablist" aria-label="보기">{([["open", "진행 중"], ["mine", "내가 담당"], ["done", "끝난 영상"]] as const).map(([key, label]) =>
            <button key={key} type="button" role="tab" aria-selected={filter === key} className={filter === key ? "yp-on" : ""} onClick={() => setFilter(key)}>{label} {counts[key] + (key === "open" ? legacy.length : 0)}</button>)}</div>
          <span style={{ flex: 1 }} />
          <div className="yp-psearch"><Search size={15} className="yp-i" aria-hidden="true" /><input className="yp-in" placeholder="영상 이름으로 찾기" aria-label="영상 검색" value={query} onChange={event => setQuery(event.target.value)} /></div>
        </div>
        <div className="yp-mv-list">
          {shown.map(project => { const next = nextAction(project); const pd = pdName(project.assigneeId);
            return <div key={project.id} className="yp-mv">
              <div className="yp-mv-m"><Link href={next.href} className="yp-mv-t" title={projectName(project)}>{projectName(project)}</Link>
                <div className={`yp-mv-s yp-${next.tone}`}>{next.text}</div>
                <div className="yp-mv-bar"><span>{Math.min(next.step + 1, next.total)}/{next.total} {next.stepName}</span><span className="yp-mv-track"><i className={`yp-${next.tone}`} style={{ width: `${Math.round(Math.min(next.step + (next.tone === "done" ? 0 : 0.5), next.total) / next.total * 100)}%` }} /></span>{pd ? <span>담당 {pd}</span> : null}</div></div>
              <Link className={`yp-btn${next.tone === "todo" || next.tone === "fix" ? " yp-pri" : ""}`} href={next.href}>{next.button}{next.tone === "todo" || next.tone === "fix" ? <ArrowRight size={14} aria-hidden="true" /> : null}</Link>
            </div>; })}
          {legacyShown.map(topic => <div key={topic.id} className="yp-mv">
            <div className="yp-mv-m"><div className="yp-mv-t" title={topic.title}>{topic.title}</div><div className="yp-mv-s">이전 화면에서 하던 영상이에요 · 옮기면 여기서 이어서 해요</div></div>
            <button type="button" className="yp-btn yp-pri" onClick={() => { setMoving(topic); moveDialog.current?.showModal(); }}>옮겨서 이어 하기 <ArrowRight size={14} aria-hidden="true" /></button></div>)}
          {!shown.length && !legacyShown.length ? <p className="yp-pempty">{query.trim() ? "찾는 영상이 없어요" : filter === "done" ? "아직 끝난 영상이 없어요" : filter === "mine" ? "내가 담당한 영상이 없어요" : "진행 중인 영상이 없어요"}</p> : null}
        </div>
      </>}

    <dialog ref={moveDialog} className="yp-modal" aria-labelledby="yp-move-title" onClose={() => setMoving(null)}>
      <div className="yp-modal-h"><span id="yp-move-title">이 영상을 옮겨서 이어 할까요?</span><span className="yp-sp" /><button type="button" className="yp-ib" aria-label="닫기" onClick={() => moveDialog.current?.close()}><X size={14} /></button></div>
      <div className="yp-modal-b"><p style={{ marginTop: 0 }}><b>{moving?.title}</b></p>
        <ul className="yp-nowsteps"><li>지금까지 만든 기획 · 제목과 썸네일 문구 · 원고 · 완성 영상 · 설명란이 그대로 들어가요.</li>
          <li>이전 화면에서 승인된 단계는 끝난 것으로 이어지고, 남은 단계부터 하면 돼요.</li><li>원래 기록은 지우지 않아요.</li></ul></div>
      <div className="yp-modal-f"><button type="button" className="yp-btn" onClick={() => moveDialog.current?.close()}>취소</button><button type="button" className="yp-btn yp-pri" disabled={busy} onClick={() => void adopt()}>{busy ? "옮기는 중…" : "옮기고 열기"}</button></div>
    </dialog>
  </>;
}
