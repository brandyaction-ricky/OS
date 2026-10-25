"use client";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { ArrowLeft, Check } from "lucide-react";
import { GATE_FIELDS, GATE_NAME } from "@/lib/youtube-process/confirm";
import { projectName, stepHref, YP_KIND_LABEL, type YpGate, type YpProject } from "@/lib/youtube-process/project";
import { SLOTS } from "@/lib/youtube-process/stages";
import { useSession } from "./session-provider";
import { errorMessage, youtubeProcessClient, type YpBundle, type YpClient, type YpMember } from "./youtube-process-data";
import { YtCard } from "./youtube-process-media";
import { ShortConfirmDetail } from "./youtube-process-short";
import { clipConfirmed, clipParts, clipSeconds, formatParts } from "@/lib/youtube-process/short";
import type { OsRecord } from "@/lib/record-types";

const TABS = [["wait", "컨펌 대기"], ["done", "내가 처리한 것"], ["hold", "보류함"]] as const;
type Tab = (typeof TABS)[number][0];
const when = (iso?: string) => { if (!iso) return ""; const date = new Date(iso); return `${date.getMonth() + 1}/${date.getDate()} ${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`; };
const days = (iso?: string) => iso ? Math.max(0, Math.floor((Date.now() - Date.parse(iso)) / 86_400_000)) : 0;
const RESULT: Record<string, string> = { ok: "OK", changes: "수정 요청", hold: "보류", wait: "대기" };

/** OK · 수정 요청 · 보류 for a waiting gate (S10 아래 막대, S10-1, S10-2). Shared by the confirm menu and the project screen. */
export function ConfirmActions({ project, gate, client, onDone }: { project: YpProject; gate: YpGate; client: YpClient; onDone: (next: YpProject) => void }) {
  const [mode, setMode] = useState<"changes" | "hold" | null>(null);
  const [fields, setFields] = useState<string[]>([]);
  const [memo, setMemo] = useState("");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const run = async (action: "ok" | "changes" | "hold") => {
    setBusy(true); setError("");
    try {
      onDone(await client.confirm(project.id, gate, action, project.version, action === "changes" ? { fields, memo } : action === "hold" ? { reason } : {}));
      setMode(null); setFields([]); setMemo(""); setReason("");
    } catch (reason) { setError(errorMessage(reason)); } finally { setBusy(false); }
  };
  return <>
    <div className="yp-abar">
      <span className="yp-abar-msg">{gate === "review" ? `대표 OK가 나야 ${project.yp.topic.type === "short" ? "내보내기" : "업로드"}로 넘어가요` : "OK를 누르면 다음 단계가 바로 열려요"}</span>
      <button type="button" className="yp-btn" disabled={busy} aria-expanded={mode === "hold"} onClick={() => setMode(mode === "hold" ? null : "hold")}>보류</button>
      <button type="button" className="yp-btn" disabled={busy} aria-expanded={mode === "changes"} onClick={() => setMode(mode === "changes" ? null : "changes")}>수정 요청</button>
      <button type="button" className="yp-btn yp-pri yp-lg" disabled={busy} onClick={() => void run("ok")}><Check size={16} aria-hidden="true" />OK</button>
    </div>
    {mode === "changes" ? <form className="yp-card yp-confirm-form" onSubmit={event => { event.preventDefault(); void run("changes"); }}>
      <b>고칠 칸 (하나 이상)</b>
      <div className="yp-confirm-fields">{Object.entries(GATE_FIELDS[gate]).map(([key, label]) => <label key={key} className="yp-chk2">
        <input type="checkbox" checked={fields.includes(key)} onChange={event => setFields(list => event.target.checked ? [...list, key] : list.filter(item => item !== key))} />{label}</label>)}</div>
      <label>메모 (필수)<textarea className="yp-in" id="yp-confirm-memo" rows={2} value={memo} onChange={event => setMemo(event.target.value)} placeholder="무엇을 어떻게 고치면 좋을지 써 주세요" /></label>
      <div><button type="submit" className="yp-btn yp-pri" disabled={busy || !fields.length || !memo.trim()}>수정 요청 보내기</button></div>
    </form> : null}
    {mode === "hold" ? <form className="yp-card yp-confirm-form" onSubmit={event => { event.preventDefault(); void run("hold"); }}>
      <label>보류 사유 (필수, 한 줄)<input className="yp-in" id="yp-confirm-reason" value={reason} onChange={event => setReason(event.target.value)} placeholder="예) 다음 달 기획과 겹쳐요" /></label>
      <div><button type="submit" className="yp-btn yp-pri" disabled={busy || !reason.trim()}>보류하기</button></div>
    </form> : null}
    {error ? <div className="yp-note yp-warn" role="alert"><div>{error}</div></div> : null}
  </>;
}

/** S10 대표 메뉴 › 컨펌: waiting oldest first, what I decided (with 결정 되돌리기), and holds. */
export function YoutubeConfirmScreen() {
  const router = useRouter();
  const params = useSearchParams();
  const tab = (TABS.some(([key]) => key === params.get("tab")) ? params.get("tab") : "wait") as Tab;
  const selectedKey = params.get("item");
  const { accessToken, demo } = useSession();
  const client = useMemo(() => youtubeProcessClient(accessToken, demo), [accessToken, demo]);
  const [items, setItems] = useState<{ project: YpProject; gate: YpGate }[] | null>(null);
  const [counts, setCounts] = useState<Record<Tab, number>>({ wait: 0, done: 0, hold: 0 });
  const [members, setMembers] = useState<YpMember[]>([]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const load = useCallback(async () => {
    if (!client) return;
    setError("");
    try {
      const [wait, done, hold, people] = await Promise.all([client.confirmList("wait"), client.confirmList("done"), client.confirmList("hold"), client.members().catch(() => [])]);
      setCounts({ wait: wait.length, done: done.length, hold: hold.length });
      setItems({ wait, done, hold }[tab]); setMembers(people);
    } catch (reason) { setError(errorMessage(reason)); }
  }, [client, tab]);
  useEffect(() => { void load(); }, [load]);
  const go = (next: Record<string, string | null>) => {
    const query = new URLSearchParams(params.toString());
    for (const [key, value] of Object.entries(next)) if (value === null) query.delete(key); else query.set(key, value);
    router.replace(`/content/confirm?${query}`);
  };
  const selected = items?.find(item => item.project.id === selectedKey) ?? null;
  const pd = (id: string | null) => members.find(member => member.id === id)?.name ?? "—";
  async function revert(item: { project: YpProject; gate: YpGate }) {
    if (!client) return;
    setBusy(true); setError("");
    try { await client.confirm(item.project.id, item.gate, "revert", item.project.version); await load(); }
    catch (reason) { setError(errorMessage(reason)); } finally { setBusy(false); }
  }

  return <>
    <div className="yp-tabs" role="tablist" aria-label="컨펌 목록">{TABS.map(([key, label]) => <button key={key} type="button" role="tab" aria-selected={tab === key} className={`yp-tab${tab === key ? " yp-on" : ""}`} onClick={() => go({ tab: key, item: null })}>{label}<em>{counts[key]}</em></button>)}</div>
    {error ? <div className="yp-note yp-warn" role="alert"><div>{error} <button type="button" className="yp-lnk" onClick={() => void load()}>다시 불러오기</button></div></div> : null}
    <div className={`yp-cf${selected ? " yp-detail" : ""}`}>
      <div className="yp-cf-list">
        {items === null && !error ? <p className="yp-hint" role="status">불러오는 중이에요…</p>
          : items?.length ? items.map(({ project, gate }) => { const info = project.yp.gates[gate]; return <button key={`${project.id}-${gate}`} type="button" className={`yp-ci${selected?.project.id === project.id ? " yp-on" : ""}`} onClick={() => go({ item: project.id })}>
            <div className="yp-ci-top"><span className="yp-tag yp-acc">{GATE_NAME[gate].replace(" 컨펌", "")}</span><span className="yp-sp" />
              {tab === "wait" ? <span className={days(info.requestedAt) >= 1 ? "yp-late" : ""}>{days(info.requestedAt) ? `${days(info.requestedAt)}일째` : "오늘"} · 6시간마다 알림</span>
                : tab === "hold" ? <span className="yp-tag yp-bad">보류</span> : <span className="yp-tag yp-ok">{RESULT[info.state]}</span>}</div>
            <div className="yp-ci-t">{projectName(project)}</div>
            <div className="yp-ci-m"><span>{pd(project.assigneeId)}</span>{info.requestedAt ? <span>{when(info.requestedAt)} 올라옴</span> : null}{"revertedFrom" in info && info.revertedFrom ? <span className="yp-tag yp-warn">되돌린 건</span> : null}{info.reason ? <span>사유: {info.reason}</span> : null}</div>
          </button>; })
          : <div className="yp-locked"><Check size={18} className="yp-i" aria-hidden="true" /><div><b>비어 있어요</b><p>{tab === "wait" ? "새 건이 오면 알림이 가요." : "아직 없어요."}</p></div></div>}
      </div>
      <div className="yp-cf-view">{selected ? (() => { const { project, gate } = selected; const info = project.yp.gates[gate] as typeof project.yp.gates[YpGate] & { pdReply?: string }; return <div className="yp-cv">
        <div className="yp-cv-h"><button type="button" className="yp-ib" aria-label="목록으로" onClick={() => go({ item: null })}><ArrowLeft size={18} /></button><span className="yp-tag yp-acc">{GATE_NAME[gate]}</span><span className="yp-hint">{pd(project.assigneeId)}{info.requestedAt ? ` · ${when(info.requestedAt)} 올라옴` : ""}</span></div>
        <div className="yp-cv-b">
          <h2>{projectName(project)}</h2>
          {gate !== "topic" && client ? <StepDetail project={project} gate={gate} client={client} /> : null}
          <dl className="yp-kv"><dt>유형</dt><dd>{project.yp.topic.type ? YP_KIND_LABEL[project.yp.topic.type] : "—"}</dd><dt>담당자</dt><dd>{pd(project.assigneeId)}</dd>
            <dt>정밀 타겟</dt><dd>{project.yp.topic.target || "—"}</dd>
            {project.yp.topic.refs.length ? <><dt>레퍼런스</dt><dd>{project.yp.topic.refs.map(ref => <div key={ref.url}><a href={ref.url} target="_blank" rel="noreferrer">{ref.title ?? ref.url}</a></div>)}</dd></> : null}
            <dt>전달 사항</dt><dd>{project.yp.topic.note || "없음"}</dd></dl>
          {info.pdReply ? <p className="yp-reply-note"><b>PD 답글</b> · 고친 칸 없이 다시 요청: “{info.pdReply}”</p> : null}
          <p><Link className="yp-lnk" href={stepHref(gate === "topic" ? 0 : gate === "draft" ? 1 : gate === "shorts" ? 6 : 4, project.id)}>{gate === "review" ? "최종 검수 화면에서 보기 →" : gate === "shorts" ? "쇼츠 화면에서 구간 재생해 보기 →" : "프로젝트 화면에서 보기 →"}</Link></p>
        </div>
        {tab === "wait" && client ? <ConfirmActions project={project} gate={gate} client={client} onDone={() => { go({ item: null }); void load(); }} />
          : tab === "hold" ? <div className="yp-abar"><span className="yp-abar-msg">보류한 건이에요. 담당 PD가 손보고 다시 요청하면 대기로 와요.</span></div>
            : <div className="yp-abar"><span className="yp-abar-msg">결과: <b>{RESULT[info.state]}</b> · {when(info.decidedAt)}</span>
              {info.state === "ok" ? <button type="button" className="yp-btn" disabled={busy} onClick={() => void revert(selected)}>결정 되돌리기</button> : null}</div>}
      </div>; })() : null}</div>
    </div>
  </>;
}

/** What the approver decides on for 기획안 (A · B · (C) as they look on YouTube, the 영상 흐름) and 최종 검수 (final, thumbnails, open feedback). */
function StepDetail({ project, gate, client }: { project: YpProject; gate: YpGate; client: YpClient }) {
  const [bundle, setBundle] = useState<YpBundle | null>(null);
  const [open, setOpen] = useState<number | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    let active = true;
    client.bundle(project.id).then(next => { if (active) setBundle(next); }, reason => { if (active) setError(errorMessage(reason)); });
    if (gate === "review") client.feedback(project.id).then(items => { if (active) setOpen(items.filter(item => item.status === "open" && !item.reaction).length); }, () => undefined);
    return () => { active = false; };
  }, [client, project.id, gate]);
  if (error) return <div className="yp-note yp-warn"><div>{error}</div></div>;
  if (!bundle) return <p className="yp-hint">불러오는 중이에요…</p>;
  const media = { client, bundle };
  if (gate === "shorts") return <ShortsScriptsDetail project={project} client={client} />;
  if (project.yp.topic.type === "short") return <ShortConfirmDetail client={client} bundle={bundle} open={open} />;
  const plan = bundle.stages.plan.data;
  const make = bundle.stages.make.data;
  const pairs = gate === "draft" ? plan.titles.slice(0, 3).map((title, index) => ({ slot: SLOTS[index], title: title.text, thumb: plan.thumbs[index] ?? null, path: null as string | null }))
      .filter(pair => pair.title || pair.thumb)
    : SLOTS.filter(slot => plan.confirmed?.[slot]).map(slot => ({ slot, title: slot === "A" && make.aTitle ? make.aTitle : plan.confirmed?.[slot]?.title ?? "", thumb: plan.confirmed?.[slot]?.thumb ?? null, path: make.thumbs[slot]?.path ?? null }));
  const final = bundle.finals.at(-1);
  return <div style={{ marginBottom: 12 }}>
    <div className="yp-fld-h"><b>제목 · 썸네일 A · B · (C)</b><span className="yp-gq">{gate === "draft" ? "유튜브에서 이렇게 보여요 · 바꾸고 싶으면 [수정 요청]에 메모" : "최종 썸네일 · 기획안 컨펌본과 다르면 표시돼요"}</span></div>
    <div className="yp-g3">{pairs.map(pair => <div key={pair.slot} className="yp-abc"><div className="yp-abc-h"><span className={`yp-ltag${pair.slot === "C" ? " yp-c" : ""}`}>{pair.slot}</span>
      {gate === "review" ? pair.slot === "A" && make.aTitle ? <span className="yp-tag yp-warn">컨펌본과 다름</span> : <span className="yp-tag yp-ok">컨펌본 그대로</span> : null}</div>
      <YtCard page={media} thumb={pair.thumb} path={pair.path} title={pair.title} /></div>)}</div>
    {gate === "draft" ? <div className="yp-field"><div className="yp-fld-h"><b>영상 흐름</b></div><ul className="yp-fl2"><li><b>오프닝 (첫 30초)</b>{plan.opening || "—"}</li><li><b>본론</b><div style={{ whiteSpace: "pre-wrap" }}>{plan.body || "—"}</div></li><li><b>클로징 · 다음 행동</b>{plan.closing || "—"}</li></ul>
      {plan.note ? <><div className="yp-fld-h" style={{ marginTop: 8 }}><b>전달 사항</b></div><p style={{ margin: 0 }}>{plan.note}</p></> : null}</div>
      : <dl className="yp-kv" style={{ gridTemplateColumns: "110px minmax(0,1fr)", marginTop: 12 }}><dt>최종본</dt><dd>{final ? `v${final.v} · ${final.source === "myin" ? "OS 자동 제작" : final.name}${final.durationSeconds ? ` · ${Math.floor(final.durationSeconds / 60)}분 ${Math.round(final.durationSeconds % 60)}초` : ""}` : "—"}</dd>
        <dt>해결 안 된 피드백</dt><dd>{open === null ? "—" : `${open}개`}</dd></dl>}
  </div>;
}

/** 쇼츠 컨펌 (owner request 2026-10-25): every picked script — copy, first 3 seconds, the longform parts in play order, description. */
function ShortsScriptsDetail({ project, client }: { project: YpProject; client: YpClient }) {
  const [clips, setClips] = useState<OsRecord[] | null>(null);
  useEffect(() => {
    let active = true;
    client.clips(project.id).then(rows => { if (active) setClips(rows.filter(row => row.metadata?.selected !== false)); }, () => { if (active) setClips([]); });
    return () => { active = false; };
  }, [client, project.id]);
  if (!clips) return <p className="yp-hint">불러오는 중이에요…</p>;
  const ok = project.yp.gates.shorts.state === "ok" || Boolean(project.yp.shortsConfirmed);
  return <div style={{ marginBottom: 12 }}>
    <div className="yp-fld-h"><b>쇼츠 대본 {clips.length}편</b><span className="yp-gq">OK가 난 대본만 세로 영상으로 만들고 올려요 · 바꾸고 싶으면 [수정 요청]에 메모</span></div>
    <ol className="yp-fl2">{clips.map(clip => { const parts = clipParts(clip.metadata); return <li key={clip.id}>
      <b>{clip.title}</b>{clip.metadata?.kind ? <span className="yp-tag" style={{ marginLeft: 6 }}>{String(clip.metadata.kind)}</span> : null}
      {ok && project.yp.shortsConfirmed?.clips[clip.id] ? clipConfirmed(project.yp.shortsConfirmed, true, clip) ? <span className="yp-tag yp-ok" style={{ marginLeft: 6 }}>지난번 OK 그대로</span> : <span className="yp-tag yp-warn" style={{ marginLeft: 6 }}>OK 뒤 바뀜</span> : <span className="yp-tag" style={{ marginLeft: 6 }}>새 대본</span>}
      <div className="yp-muted" style={{ fontSize: 13 }}>구간 {formatParts(parts)} · {Math.round(clipSeconds(parts))}초</div>
      {clip.metadata?.hook ? <div style={{ fontSize: 13 }}>첫 3초: “{String(clip.metadata.hook)}”</div> : null}
      {clip.metadata?.desc ? <div className="yp-muted" style={{ fontSize: 13, whiteSpace: "pre-line" }}>설명: {String(clip.metadata.desc)}</div> : null}
      {clip.metadata?.reason ? <div className="yp-muted" style={{ fontSize: 12 }}>왜: {String(clip.metadata.reason)}</div> : null}
    </li>; })}</ol>
  </div>;
}

