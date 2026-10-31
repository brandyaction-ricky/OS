"use client";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { AlertTriangle, ArrowUp, Bot, CheckCircle2, ChevronLeft, ChevronRight, CircleAlert, PauseCircle, UserRound } from "lucide-react";
import { apiRequest } from "@/lib/api-client";
import { TOPIC_PLATFORMS, type TopicPlatform } from "@/lib/content-platforms";
import { decisionsToday, OV_STATES, overviewRows, type OvJob, type OvRow, type OvState, type OvThread } from "@/lib/youtube-process/overview";
import { nextAction } from "@/lib/youtube-process/next";
import type { YpProject } from "@/lib/youtube-process/project";
import { useSession } from "./session-provider";
import { YP_CONFIRM_EVENT } from "./use-youtube-confirm";
import { ConfirmActions } from "./youtube-process-confirm";
import { errorMessage, youtubeProcessClient, type YpMember } from "./youtube-process-data";

const hhmm = (iso?: string | null) => { if (!iso) return ""; const d = new Date(iso); return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`; };
const NEW_WORK: TopicPlatform[] = ["longform", "short", "ad", "card", "threads"];
/** Where 새 일 시작하기 starts each kind of content: a new longform's 주제, or 주제 찾기 for the platform with the words typed in. */
const startHref = (platform: TopicPlatform, text: string) => platform === "longform"
  ? `/content/plan?project=new&view=topic${text ? `&title=${encodeURIComponent(text)}` : ""}`
  : `/content/projects?view=discover&platform=${platform}${text ? `&q=${encodeURIComponent(text)}` : ""}`;
// The state cards use 주제 찾기's platform cards (owner 2026-10-31: the same button style as the other pages), coloured by state.
const CARD_ICON = { decide: CircleAlert, ai: Bot, blocked: AlertTriangle, human: UserRound, wait: PauseCircle } as const;

function Dot({ state }: { state: OvState | "done" }) { return <span className="yp-ov-dot" data-s={state} aria-hidden="true" />; }

/** 한눈에 보기: every open piece of content work in one list (or board), what needs my decision on the right, and new work at the bottom. */
export function YoutubeOverviewScreen() {
  const router = useRouter();
  const params = useSearchParams();
  const view = params.get("view") === "board" ? "board" : "list";
  const { accessToken, demo, profile } = useSession();
  const client = useMemo(() => youtubeProcessClient(accessToken, demo), [accessToken, demo]);
  const [data, setData] = useState<{ projects: YpProject[]; jobs: OvJob[]; canConfirm: boolean } | null>(null);
  const [threads, setThreads] = useState<OvThread[]>([]);
  const [members, setMembers] = useState<YpMember[]>([]);
  const [error, setError] = useState("");
  const [selected, setSelected] = useState<string | null>(null);
  const [only, setOnly] = useState<OvState | null>(null);
  const [text, setText] = useState("");
  const [to, setTo] = useState<TopicPlatform>("longform");
  const [clock, setClock] = useState(() => Date.now());
  const load = useCallback(async () => {
    if (!client) return;
    try {
      const [next, people] = await Promise.all([client.overview(), client.members().catch(() => [] as YpMember[])]);
      setData(next); setMembers(people); setClock(Date.now()); setError("");
    } catch (reason) { setError(errorMessage(reason)); }
    // Threads posts are personal records of 콘텐츠 자동화; a person without that menu simply has none here.
    if (!demo && accessToken) apiRequest<{ items: { id: string; title: string; status: string; updated_at: string }[] }>("/api/v1/content/automation/items?channel=threads&limit=200", { token: accessToken })
      .then(result => setThreads(result.items.map(item => ({ id: item.id, title: item.title, status: item.status, updatedAt: item.updated_at }))), () => setThreads([]));
  }, [client, demo, accessToken]);
  // A minute is enough for "N분째"; a focus brings it up to date at once. Nothing here signs media URLs.
  useEffect(() => {
    void load();
    const tick = () => { if (document.visibilityState === "visible") void load(); };
    const timer = window.setInterval(tick, 60_000);
    window.addEventListener("focus", tick);
    window.addEventListener(YP_CONFIRM_EVENT, tick);
    return () => { window.clearInterval(timer); window.removeEventListener("focus", tick); window.removeEventListener(YP_CONFIRM_EVENT, tick); };
  }, [load]);

  const me = demo ? "demo-ricky" : profile?.id ?? "";
  const { rows, done } = useMemo(() => data ? overviewRows(data.projects, data.jobs, { id: me, canConfirm: data.canConfirm }, clock, threads) : { rows: [] as OvRow[], done: 0 }, [data, me, clock, threads]);
  const decided = useMemo(() => data ? decisionsToday(data.projects, clock) : [], [data, clock]);
  const count = (state: OvState) => rows.filter(row => row.state === state).length;
  const who = (id: string | null) => id ? members.find(member => member.id === id)?.name ?? "담당 미정" : "—";
  const projectOf = (id: string) => data?.projects.find(project => project.id === id);
  const pick = selected ? rows.find(row => row.id === selected) ?? null : null;
  const groups = OV_STATES.filter(group => only ? group.state === only : view === "board" ? group.state === "decide" || count(group.state) : group.state !== "blocked" || count("blocked"));
  const setView = (next: "list" | "board") => { const query = new URLSearchParams(params.toString()); if (next === "list") query.delete("view"); else query.set("view", next); router.replace(`/content/overview${query.size ? `?${query}` : ""}`, { scroll: false }); };

  const rowButton = (row: OvRow, card = false) => <button key={row.id} type="button" className={`${card ? "yp-ov-card" : "yp-ov-row"}${selected === row.id ? " yp-on" : ""}`} data-s={row.state} onClick={() => setSelected(row.id)}>
    <span className="yp-ov-ch">{TOPIC_PLATFORMS[row.channel].label}</span>
    <span className="yp-ov-main"><b className="yp-ov-t">{row.title}</b><span className="yp-ov-stg">{row.stage}{card && row.assigneeId ? ` · ${who(row.assigneeId)}` : ""}</span></span>
    <span className="yp-ov-now"><Dot state={row.state} />{row.now}</span>
    {card ? null : <><span className="yp-ov-who">{who(row.assigneeId)}</span><ChevronRight size={14} className="yp-ov-go" aria-hidden="true" /></>}
  </button>;

  if (!client) return <p className="yp-hint" role="status">로그인을 확인하는 중이에요…</p>;
  return <div className="yp-ov">
    <div className="yp-pf-tabs yp-ov-tabs" role="group" aria-label="지금 상태">
      {OV_STATES.map(group => { const Icon = CARD_ICON[group.state];
        return <button key={group.state} type="button" className={`yp-pf yp-ov-s-${group.state}${only === group.state ? " yp-on" : ""}`} aria-pressed={only === group.state} disabled={!data}
          onClick={() => { setOnly(only === group.state ? null : group.state); if (group.state === "decide") setSelected(null); }}>
          <Icon size={18} aria-hidden="true" /><span><b>{group.label} {count(group.state)}</b><small>{group.sub}</small></span></button>; })}
      <Link className="yp-pf yp-ov-s-done" href="/content/projects?filter=done"><CheckCircle2 size={18} aria-hidden="true" /><span><b>끝 {done}</b><small>내 영상 › 끝난 영상</small></span></Link>
    </div>
    {error ? <div className="yp-note yp-warn" role="alert"><div>{error} <button type="button" className="yp-lnk" onClick={() => void load()}>다시 불러오기</button></div></div> : null}
    <div className="yp-ov-grid">
      <div className="yp-ov-body">
        <div className="yp-ov-tools">{only ? <button type="button" className="yp-btn yp-sm" onClick={() => setOnly(null)}>전체 보기</button> : <span />}
          <div className="yp-seg2" role="group" aria-label="보기">
            <button type="button" className={view === "list" ? "yp-on" : ""} aria-pressed={view === "list"} onClick={() => setView("list")}>목록</button>
            <button type="button" className={view === "board" ? "yp-on" : ""} aria-pressed={view === "board"} onClick={() => setView("board")}>보드</button>
          </div></div>
        {!data && !error ? <p className="yp-hint" role="status">불러오는 중이에요…</p>
          : view === "list" ? <div className="yp-ov-list">{groups.map(group => { const list = rows.filter(row => row.state === group.state);
              return <section key={group.state} aria-label={group.label}><h2 className="yp-ov-gh"><Dot state={group.state} />{group.label} <span>{list.length}</span><small>{group.sub}</small></h2>
                {list.length ? <div className="yp-ov-rows">{list.map(row => rowButton(row))}</div> : <p className="yp-ov-empty">없어요</p>}</section>; })}</div>
          // The board keeps 결정 always and drops empty columns so the rest fit beside the panel.
          : <div className="yp-ov-board">{groups.map(group => { const list = rows.filter(row => row.state === group.state);
              return <section key={group.state} className="yp-ov-col" aria-label={group.label}><h2 className="yp-ov-gh"><Dot state={group.state} />{group.label} <span>{list.length}</span></h2>{list.map(row => rowButton(row, true))}</section>; })}</div>}
        <form className="yp-ov-cmd" onSubmit={event => { event.preventDefault(); router.push(startHref(to, text.trim())); }}>
          <input className="yp-in" value={text} maxLength={200} onChange={event => setText(event.target.value)} aria-label="새로 만들 것" placeholder={`${TOPIC_PLATFORMS[to].label}에 새 일 시작하기 — 주제나 키워드`} />
          <select className="yp-in" value={to} onChange={event => setTo(event.target.value as TopicPlatform)} aria-label="어디에">{NEW_WORK.map(key => <option key={key} value={key}>{TOPIC_PLATFORMS[key].label}</option>)}</select>
          <button type="submit" className="yp-btn yp-pri" aria-label="시작하기"><ArrowUp size={16} aria-hidden="true" />시작</button>
        </form>
      </div>
      <aside className="yp-ov-pane" aria-label={pick && pick.state !== "decide" ? "고른 일" : "확인 필요"}>
        {pick && pick.state !== "decide" ? <div className="yp-ov-detail">
          <div className="yp-ov-ph"><button type="button" className="yp-btn yp-sm yp-ghost" onClick={() => setSelected(null)} aria-label="확인 필요로 돌아가기"><ChevronLeft size={16} aria-hidden="true" /></button><div><h3>{pick.title}</h3><small>{TOPIC_PLATFORMS[pick.channel].label} · {pick.stage}</small></div></div>
          <div className="yp-ov-nowbox" data-s={pick.state}><span className="yp-ov-k">{OV_STATES.find(group => group.state === pick.state)?.label}</span><b>{pick.now}</b>
            {pick.job ? <ul className="yp-ov-log"><li>{hhmm(pick.job.requestedAt)} 맡김</li>{pick.job.claimedAt ? <li>{hhmm(pick.job.claimedAt)} AI가 가져감</li> : null}{pick.job.failReason ? <li>{pick.job.failReason}</li> : null}</ul> : null}</div>
          {pick.assigneeId ? <p className="yp-ov-meta">담당 {who(pick.assigneeId)}</p> : null}
          <div><Link className="yp-btn yp-pri" href={pick.href}>{pick.state === "blocked" ? "화면에서 다시 맡기기 →" : "화면 열기 →"}</Link></div>
        </div> : <>
          <div className="yp-ov-ph"><div><h3>확인 필요 {count("decide")}</h3><small>고르면 그 일이 이어져요 · 컨펌 · 수정 요청 · 보류</small></div></div>
          {rows.filter(row => row.state === "decide").map(row => { const project = row.gate ? projectOf(row.id) : undefined;
            // 리키 관제실 시안 v0.1: what it is and since when, the title, a one-line hint, then numbered choices.
            return <article key={row.id} className={`yp-ov-dc${selected === row.id ? " yp-on" : ""}`}>
              <span className="yp-ov-kd">{row.now.split(" · ")[0]}{row.now.includes(" · ") ? <span> · {row.now.split(" · ").slice(1).join(" · ")}</span> : null}</span><b className="yp-ov-dt">{row.title}</b><span className="yp-ov-meta">{TOPIC_PLATFORMS[row.channel].label} · {row.stage}{row.assigneeId ? ` · ${who(row.assigneeId)}` : ""}</span>
              <p className="yp-ov-hint">{project ? nextAction(project).text : "다섯 가지를 직접 확인하고 발행해요"}</p>
              {project && row.gate && data?.canConfirm && client ? <ConfirmActions list project={project} gate={row.gate} client={client} onDone={() => void load()} />
                : <div className="yp-cf-opts"><Link className="yp-cf-opt" href={row.href}><span aria-hidden="true">1</span>{row.channel === "threads" ? "최종 확인 열기" : "컨펌하러 가기"}</Link></div>}
              {project && data?.canConfirm ? <Link className="yp-lnk yp-ov-open" href={row.href}>열어서 보기</Link> : null}
            </article>; })}
          {data && !count("decide") ? <p className="yp-ov-empty">지금 고를 것이 없어요</p> : null}
          <div className="yp-ov-today"><span className="yp-ov-k">오늘 내린 결정</span>
            {decided.length ? <ul>{decided.map(item => <li key={`${item.href}-${item.at}`}><span className="yp-ov-ok">✓</span><span><Link className="yp-lnk" href={item.href}>{item.title}</Link><small>{hhmm(item.at)} · {item.what}</small></span></li>)}</ul> : <p className="yp-ov-empty">아직 없어요</p>}</div>
        </>}
      </aside>
    </div>
  </div>;
}
