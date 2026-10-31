"use client";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowRight, Copy, Plus, Radar, RotateCcw, Search, Trash2, X } from "lucide-react";
import { mayTrash, projectName, searchProjects, stepHref, TRASH_KEEP_DAYS, trashDaysLeft, YP_KIND_SHORT, type YpProject, type YpTrashed } from "@/lib/youtube-process/project";
import { nextAction } from "@/lib/youtube-process/next";
import { TopicHub } from "./topic-hub";
import { isTopicPlatform, projectPlatform, TOPIC_PLATFORMS } from "@/lib/content-platforms";
import { useSession } from "./session-provider";
import { useYoutubeCanConfirm } from "./use-youtube-confirm";
import { errorMessage, youtubeProcessClient, type YpLegacyTopic, type YpMember } from "./youtube-process-data";
import { md } from "./youtube-process-frame";

type Filter = "open" | "mine" | "done" | "trash";

/** 내 영상 (S1, redesigned 2026-10-21 so it reads without a guide): new video in one line, then each video with what it needs next. */
export function YoutubeProjectsScreen() {
  const router = useRouter();
  const search = useSearchParams();
  const discover = search.get("view") === "discover";
  // 내 롱폼 · 숏폼 · 광고 영상 (side menu, owner 2026-10-29): the same list for one platform; no ?platform= shows every video.
  const asked = search.get("platform");
  const platform = isTopicPlatform(asked) && asked !== "threads" ? asked : null;
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
  const [trashed, setTrashed] = useState<(YpTrashed & { canManage: boolean })[]>([]);
  const [trashing, setTrashing] = useState<YpProject | null>(null);
  const [copying, setCopying] = useState<YpProject | null>(null);
  const [purging, setPurging] = useState<YpTrashed | null>(null);
  const [reason, setReason] = useState("");
  const [sure, setSure] = useState(false);
  const trashDialog = useRef<HTMLDialogElement>(null);
  const copyDialog = useRef<HTMLDialogElement>(null);
  const purgeDialog = useRef<HTMLDialogElement>(null);
  const admin = profile?.role === "admin";

  useEffect(() => {
    if (!client) return;
    let active = true;
    Promise.all([client.list(), client.members().catch(() => [] as YpMember[]), client.legacy().catch(() => [] as YpLegacyTopic[]), client.trashList().catch(() => [])])
      .then(([list, people, old, bin]) => { if (active) { setProjects(list); setMembers(people); setLegacy(old); setTrashed(bin); setError(""); } })
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

  // 휴지통으로 · 복구 · 영구 삭제 reload both lists, so a video is never shown in two places.
  const act = async (run: () => Promise<void>, dialog?: HTMLDialogElement | null) => {
    setBusy(true); setError("");
    try { await run(); dialog?.close(); setAttempt(value => value + 1); }
    catch (reason) { setError(errorMessage(reason)); dialog?.close(); }
    finally { setBusy(false); }
  };
  const openTrash = (project: YpProject) => { setTrashing(project); setReason(""); trashDialog.current?.showModal(); };
  const openCopy = (project: YpProject) => { setCopying(project); copyDialog.current?.showModal(); };
  const openPurge = (item: YpTrashed) => { setPurging(item); setReason(""); setSure(false); purgeDialog.current?.showModal(); };

  const all = (projects ?? []).filter(project => !platform || projectPlatform(project.yp.topic) === platform);
  const sorted = [...all].sort((a, b) => {
    // What needs someone first (수정 요청, then work to do), waiting ones after, finished last; newest edit first within.
    const rank = (project: YpProject) => ({ fix: 0, todo: 1, hold: 2, wait: 3, done: 4 })[nextAction(project).tone];
    return rank(a) - rank(b) || b.yp.contentUpdatedAt.localeCompare(a.yp.contentUpdatedAt);
  });
  const trashedHere = trashed.filter(item => !platform || projectPlatform(item.project.yp.topic) === platform);
  const counts = { open: all.filter(row => row.yp.stage !== "done").length, mine: all.filter(row => row.yp.stage !== "done" && row.assigneeId === profile?.id).length, done: all.filter(row => row.yp.stage === "done").length, trash: trashedHere.length };
  const shown = searchProjects(sorted, query).filter(row => filter === "done" ? row.yp.stage === "done" : row.yp.stage !== "done" && (filter === "open" || row.assigneeId === profile?.id));
  const legacyShown = filter === "done" || filter === "trash" || (platform && platform !== "longform") ? [] : legacy.filter(topic => !query.trim() || topic.title.toLocaleLowerCase("ko-KR").includes(query.trim().toLocaleLowerCase("ko-KR")));
  const waitingMine = canConfirm ? all.filter(row => nextAction(row).tone === "wait").length : 0;
  const pdName = (id: string | null) => members.find(member => member.id === id)?.name ?? "";

  if (discover) return <TopicHub />;

  return <>
    <div className="yp-mv-head"><h1 className="page-title" data-ui="page-title">{platform === "card" ? "내 카드뉴스" : platform ? `내 ${TOPIC_PLATFORMS[platform].label} 영상` : "내 영상"}</h1><span style={{ flex: 1 }} />
      <Link className="yp-btn yp-lg" href={platform ? `/content/projects?view=discover&platform=${platform}` : "/content/projects?view=discover&tab=discovery"}><Radar size={16} aria-hidden="true" /> 주제 찾기</Link>
      {/* A 숏폼 or 광고 starts from 주제 찾기 (its draft keywords make the project); a 롱폼 can start from one line here. */}
      {platform && platform !== "longform" ? null : <button type="button" className="yp-btn yp-pri yp-lg" onClick={() => setCreating(true)}><Plus size={16} aria-hidden="true" /> 새 영상 만들기</button>}</div>
    {creating ? <form className="yp-mv-new" onSubmit={event => { event.preventDefault(); void create(); }}>
      <input className="yp-in" autoFocus maxLength={200} placeholder="어떤 영상을 만들까요? 예) 하루 일이 두 개뿐인데 저녁마다 지치는 이유" aria-label="새 영상 주제" value={title} onChange={event => setTitle(event.target.value)} />
      <button type="submit" className="yp-btn yp-pri" disabled={busy || !title.trim()}>{busy ? "만드는 중…" : "시작하기"} <ArrowRight size={14} aria-hidden="true" /></button>
      <button type="button" className="yp-ib" aria-label="닫기" onClick={() => { setCreating(false); setTitle(""); }}><X size={14} /></button></form> : null}
    {waitingMine ? <div className="yp-note yp-warn" role="status"><div>컨펌을 기다리는 영상이 <b>{waitingMine}개</b> 있어요. <Link className="yp-lnk" href="/content/confirm">컨펌하러 가기 →</Link></div></div> : null}
    {error ? <div className="yp-note yp-warn" role="alert"><div>{error} <button type="button" className="yp-lnk" onClick={() => setAttempt(value => value + 1)}>다시 불러오기</button></div></div> : null}
    {projects === null && !error ? <p className="yp-hint" role="status">불러오는 중이에요…</p>
      : <>
        <div className="yp-mv-filters">
          <div className="yp-seg2" role="tablist" aria-label="보기">{([["open", "진행 중"], ["mine", "내가 담당"], ["done", "끝난 영상"], ["trash", "휴지통"]] as const).map(([key, label]) =>
            <button key={key} type="button" role="tab" aria-selected={filter === key} className={filter === key ? "yp-on" : ""} onClick={() => setFilter(key)}>{label} {counts[key] + (key === "open" && (!platform || platform === "longform") ? legacy.length : 0)}</button>)}</div>
          <label className="yp-platform-filter"><span>플랫폼</span><select className="yp-in" aria-label="영상 플랫폼" value={platform ?? "all"} onChange={event => {
            const params = new URLSearchParams(search.toString());
            if (event.target.value === "all") params.delete("platform"); else params.set("platform", event.target.value);
            router.replace(`/content/projects${params.size ? `?${params}` : ""}`, { scroll: false });
          }}><option value="all">전체 플랫폼</option>{(["card", "ad", "short", "longform"] as const).map(key => <option key={key} value={key}>{TOPIC_PLATFORMS[key].label}</option>)}</select></label>
          <span className="yp-sp" />
          <div className="yp-psearch"><Search size={15} className="yp-i" aria-hidden="true" /><input className="yp-in" placeholder="영상 이름으로 찾기" aria-label="영상 검색" value={query} onChange={event => setQuery(event.target.value)} /></div>
        </div>
        {!projects?.length && !legacy.length && !trashed.length && !platform ? <div className="yp-mv-empty"><b>첫 영상을 만들어 보세요</b><span className="yp-muted">주제 한 줄만 쓰면 시작돼요. 나머지는 화면이 차례로 알려 줘요.</span>
          <button type="button" className="yp-btn yp-pri yp-lg" onClick={() => setCreating(true)}><Plus size={16} aria-hidden="true" /> 새 영상 만들기</button></div>
          : filter === "trash" ? <div className="yp-mv-list">
          <p className="yp-hint" style={{ margin: "0 0 4px" }}>지운 영상은 {TRASH_KEEP_DAYS}일 동안 여기 있어요. [복구]하면 하던 단계 그대로 돌아와요. {TRASH_KEEP_DAYS}일이 지나면 관리자가 영구 삭제할 수 있어요.</p>
          {trashedHere.filter(item => !query.trim() || projectName(item.project).toLocaleLowerCase("ko-KR").includes(query.trim().toLocaleLowerCase("ko-KR"))).map(item => { const left = trashDaysLeft(item.trash.at);
            return <div key={item.project.id} className="yp-mv">
              <div className="yp-mv-m"><div className="yp-mv-th"><span className="yp-mv-t" title={projectName(item.project)}>{projectName(item.project)}</span></div>
                <div className="yp-mv-s yp-wait">{item.trash.name}님이 {md(item.trash.at)}에 지웠어요{item.trash.reason ? ` · ${item.trash.reason}` : ""}</div></div>
              <div className="yp-mv-bar"><span>{left > 0 ? `보관 ${left}일 남음` : "영구 삭제할 수 있어요"}</span><span className="yp-mv-track"><i className="yp-wait" style={{ width: `${Math.round(left / TRASH_KEEP_DAYS * 100)}%` }} /></span></div>
              <div className="yp-mv-pd">{nextAction(item.project).stepName} 단계에서 멈춤</div>
              <div className="yp-mv-act">{item.canManage ? <button type="button" className="yp-btn" disabled={busy} onClick={() => void act(() => client!.restore(item.project.id))}><RotateCcw size={14} aria-hidden="true" /> 복구</button> : null}
                {admin && left === 0 ? <button type="button" className="yp-btn yp-danger" disabled={busy} onClick={() => openPurge(item)}>영구 삭제</button> : null}</div>
            </div>; })}
          {!trashed.length ? <p className="yp-pempty">휴지통이 비었어요</p> : null}
        </div> : <div className="yp-mv-list">
          {shown.map(project => { const next = nextAction(project); const pd = pdName(project.assigneeId);
            // One grid per row (owner request 2026-10-25): title and next step · progress · PD · button line up down the list.
            // The platform as 주제 찾기 names it, in its colour: 롱폼 · 숏폼 · 릴스 · 광고.
            const platform = project.yp.topic.type ? projectPlatform(project.yp.topic) : null;
            const kind = platform ? TOPIC_PLATFORMS[platform].label : null;
            const done = Math.min(next.step + (next.tone === "done" ? 0 : 0.5), next.total) / next.total;
            return <div key={project.id} className="yp-mv">
              {/* 로건 QA 10/30: 실사 or 애니메이션 and the last change tell same-titled rows and copies apart without opening them. */}
              <div className="yp-mv-m"><div className="yp-mv-th">{kind ? <span className={`yp-tag yp-pf-tag yp-pf-${platform}`}>{kind}</span> : null}
                {project.yp.topic.type === "live" || project.yp.topic.type === "anim" ? <span className="yp-tag">{YP_KIND_SHORT[project.yp.topic.type]}</span> : null}
                <Link href={next.href} className="yp-mv-t" title={projectName(project)}>{projectName(project)}</Link></div>
                <div className={`yp-mv-s yp-${next.tone}`}>{next.text}<span className="yp-muted"> · 고친 날 {md(project.yp.contentUpdatedAt)}</span></div></div>
              <div className="yp-mv-bar"><span>{Math.min(next.step + 1, next.total)}/{next.total} · {next.stepName}</span><span className="yp-mv-track"><i className={`yp-${next.tone}`} style={{ width: `${Math.round(done * 100)}%` }} /></span></div>
              <div className="yp-mv-pd">{pd ? <><span className="yp-mv-av" aria-hidden="true">{pd.slice(0, 1)}</span>{pd}</> : <span className="yp-muted">담당 없음</span>}</div>
              <div className="yp-mv-act"><Link className={`yp-btn${next.tone === "todo" || next.tone === "fix" ? " yp-pri" : ""}`} href={next.href}>{next.button}{next.tone === "todo" || next.tone === "fix" ? <ArrowRight size={14} aria-hidden="true" /> : null}</Link>
                <button type="button" className="yp-ib" aria-label={`${projectName(project)} 복제`} title="복제" onClick={() => openCopy(project)}><Copy size={15} /></button>
                {mayTrash(project, profile?.id, admin) ? <button type="button" className="yp-ib" aria-label={`${projectName(project)} 삭제`} title="휴지통으로" onClick={() => openTrash(project)}><Trash2 size={15} /></button> : null}</div>
            </div>; })}
          {legacyShown.map(topic => <div key={topic.id} className="yp-mv">
            <div className="yp-mv-m"><div className="yp-mv-t" title={topic.title}>{topic.title}</div><div className="yp-mv-s">이전 화면에서 하던 영상이에요. 옮기면 여기서 이어서 해요.</div></div>
            <button type="button" className="yp-btn yp-pri" onClick={() => { setMoving(topic); moveDialog.current?.showModal(); }}>옮겨서 이어 하기 <ArrowRight size={14} aria-hidden="true" /></button></div>)}
          {!shown.length && !legacyShown.length ? <p className="yp-pempty">{query.trim() ? "찾는 영상이 없어요" : filter === "done" ? "아직 끝난 영상이 없어요" : filter === "mine" ? "내가 담당한 영상이 없어요" : "진행 중인 영상이 없어요"}</p> : null}
        </div>}
      </>}

    <dialog ref={copyDialog} className="yp-modal" aria-labelledby="yp-copy-title" onClose={() => setCopying(null)}>
      <div className="yp-modal-h"><span id="yp-copy-title">이 영상을 복제할까요?</span><span className="yp-sp" /><button type="button" className="yp-ib" aria-label="닫기" onClick={() => copyDialog.current?.close()}><X size={14} /></button></div>
      <div className="yp-modal-b"><p style={{ marginTop: 0 }}><b>{copying ? projectName(copying) : ""}</b></p>
        <ul className="yp-nowsteps"><li>주제 · 기획안 · 구성안 원고와 주제 · 기획안 컨펌을 그대로 가져와 같은 단계에서 이어 가요. 이름 끝에 「(복사본)」이 붙어요.</li>
          <li>음성 · 영상은 새로 만들어요. 최종 검토나 업로드까지 간 영상은 제작 단계에서 시작해요.</li></ul></div>
      <div className="yp-modal-f"><button type="button" className="yp-btn" onClick={() => copyDialog.current?.close()}>취소</button>
        <button type="button" className="yp-btn yp-pri" disabled={busy || !copying} onClick={() => copying && void act(async () => { await client!.copy(copying.id); }, copyDialog.current)}><Copy size={14} aria-hidden="true" /> {busy ? "복제하는 중…" : "복제하기"}</button></div>
    </dialog>

    <dialog ref={trashDialog} className="yp-modal" aria-labelledby="yp-trash-title" onClose={() => setTrashing(null)}>
      <div className="yp-modal-h"><span id="yp-trash-title">이 영상을 휴지통으로 옮길까요?</span><span className="yp-sp" /><button type="button" className="yp-ib" aria-label="닫기" onClick={() => trashDialog.current?.close()}><X size={14} /></button></div>
      <div className="yp-modal-b"><p style={{ marginTop: 0 }}><b>{trashing ? projectName(trashing) : ""}</b></p>
        <ul className="yp-nowsteps"><li>휴지통에서 {TRASH_KEEP_DAYS}일 동안 [복구]할 수 있어요. 복구하면 하던 단계 그대로 돌아와요.</li>
          <li>{TRASH_KEEP_DAYS}일이 지나면 관리자가 영구 삭제할 수 있어요.</li>
          {trashing && ["upload", "shorts", "done"].includes(trashing.yp.stage) ? <li>이미 유튜브에 올린 영상은 OS에서 지워도 유튜브에는 그대로 있어요.</li> : null}</ul>
        <label className="yp-lbl">지우는 이유 (선택)<input className="yp-in" value={reason} maxLength={300} onChange={event => setReason(event.target.value)} placeholder="예) 주제가 겹쳐서 중단" /></label></div>
      <div className="yp-modal-f"><button type="button" className="yp-btn" onClick={() => trashDialog.current?.close()}>취소</button>
        <button type="button" className="yp-btn yp-danger" disabled={busy || !trashing} onClick={() => trashing && void act(() => client!.trash(trashing.id, trashing.version, reason.trim()), trashDialog.current)}><Trash2 size={14} aria-hidden="true" /> {busy ? "옮기는 중…" : "휴지통으로"}</button></div>
    </dialog>

    <dialog ref={purgeDialog} className="yp-modal" aria-labelledby="yp-purge-title" onClose={() => setPurging(null)}>
      <div className="yp-modal-h"><span id="yp-purge-title">영구 삭제</span><span className="yp-sp" /><button type="button" className="yp-ib" aria-label="닫기" onClick={() => purgeDialog.current?.close()}><X size={14} /></button></div>
      <form className="yp-modal-b" onSubmit={event => { event.preventDefault(); if (purging) void act(() => client!.purge(purging.project.id, reason.trim()), purgeDialog.current); }}>
        <p style={{ marginTop: 0 }}><b>{purging ? projectName(purging.project) : ""}</b></p>
        <ul className="yp-nowsteps"><li>최종본 · 썸네일 · 음성 · 자막 같은 이 영상의 파일을 지우고, 휴지통에서도 사라져요.</li><li>복구할 수 없어요. 누가 언제 왜 지웠는지만 기록으로 남아요.</li></ul>
        <label className="yp-lbl">삭제 사유 (필수)<input className="yp-in" required value={reason} maxLength={300} onChange={event => setReason(event.target.value)} /></label>
        <label className="yp-cbx" style={{ marginTop: 8 }}><input type="checkbox" checked={sure} onChange={event => setSure(event.target.checked)} /> 복구할 수 없다는 걸 확인했어요</label>
        <div className="yp-modal-f" style={{ padding: "12px 0 0" }}><button type="button" className="yp-btn" onClick={() => purgeDialog.current?.close()}>취소</button>
          <button type="submit" className="yp-btn yp-danger" disabled={busy || !reason.trim() || !sure}>{busy ? "지우는 중…" : "영구 삭제"}</button></div>
      </form>
    </dialog>

    <dialog ref={moveDialog} className="yp-modal" aria-labelledby="yp-move-title" onClose={() => setMoving(null)}>
      <div className="yp-modal-h"><span id="yp-move-title">이 영상을 옮겨서 이어 할까요?</span><span className="yp-sp" /><button type="button" className="yp-ib" aria-label="닫기" onClick={() => moveDialog.current?.close()}><X size={14} /></button></div>
      <div className="yp-modal-b"><p style={{ marginTop: 0 }}><b>{moving?.title}</b></p>
        <ul className="yp-nowsteps"><li>지금까지 만든 기획 · 제목과 썸네일 문구 · 원고 · 최종본 · 설명란이 그대로 들어가요.</li>
          <li>이전 화면에서 컨펌된 단계는 끝난 것으로 이어지고, 남은 단계부터 하면 돼요.</li><li>원래 기록은 지우지 않아요.</li></ul></div>
      <div className="yp-modal-f"><button type="button" className="yp-btn" onClick={() => moveDialog.current?.close()}>취소</button><button type="button" className="yp-btn yp-pri" disabled={busy} onClick={() => void adopt()}>{busy ? "옮기는 중…" : "옮기고 열기"}</button></div>
    </dialog>
  </>;
}
