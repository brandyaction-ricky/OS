"use client";
import { useCallback, useMemo, useState } from "react";
import { Search, Sparkles } from "lucide-react";
import { apiRequest } from "@/lib/api-client";
import { BREAKOUT, compactCount, isBreakout, ratioLabel, type DiscoverVideo } from "@/lib/youtube-process/discover";
import { projectName, topicEditable, topicKeywords, type YpProject, type YpRef } from "@/lib/youtube-process/project";
import type { YpShortTopicPick, YpTopicFormula } from "@/lib/youtube-process/stages";
import { CostTag } from "./cost-notice";
import { useSession } from "./session-provider";
import { errorMessage } from "./youtube-process-data";
import { DEMO_VIDEOS } from "./youtube-process-discover";
import { useYpBundle, YpSection, type YpPage } from "./youtube-process-frame";
import { JobLine, SendDialog, useStaffJob } from "./youtube-process-ai";

// 롱폼 주제 (owner 2026-10-30: 「롱폼 주제 단계에도 숏폼처럼」): a keyword finds 참고 영상 with 주제 찾기's search (each video against its
// own channel's normal), the PD puts the ones that fit into 참고 영상, and the staff AI draws title formulas and three 주제 후보.

/** The keyword search of 주제 찾기 › 롱폼, here on 주제: 터진 영상 first, each with [넣기]. */
export function TopicRefSearch({ initial, refs, can, onAdd }: { initial: string; refs: YpRef[]; can: boolean; onAdd: (ref: YpRef) => void }) {
  const { accessToken, demo } = useSession();
  const [query, setQuery] = useState("");
  const [found, setFound] = useState<DiscoverVideo[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const words = (query || initial).trim();
  const search = async () => {
    if (words.length < 2) { setError("검색어를 두 글자 이상 써 주세요."); return; }
    setBusy(true); setError("");
    try {
      // The demo videos share one address; each gets its own here so [넣기] adds one at a time.
      const videos = demo ? DEMO_VIDEOS.map(video => ({ ...video, url: `https://www.youtube.com/watch?v=${video.id.padEnd(11, "0")}` })) : (await apiRequest<{ videos: DiscoverVideo[] }>(`/api/v1/content/youtube/discover?q=${encodeURIComponent(words)}`, { token: accessToken })).videos;
      setFound([...videos].sort((a, b) => Number(isBreakout(b)) - Number(isBreakout(a)) || (b.ratio ?? 0) - (a.ratio ?? 0)).slice(0, 12));
    } catch (reason) { setError(errorMessage(reason)); } finally { setBusy(false); }
  };
  const added = new Set(refs.map(ref => ref.url));
  if (!can) return null;
  return <div style={{ marginTop: 10 }}>
    <form className="yp-savebar" onSubmit={event => { event.preventDefault(); void search(); }}>
      <input className="yp-in" aria-label="참고 영상 검색어" placeholder={initial ? `키워드로 찾기 · 비우면 「${initial.slice(0, 20)}」` : "키워드로 찾기 · 예) 직장인 강점 찾기"} value={query} maxLength={120} onChange={event => setQuery(event.target.value)} />
      <button type="submit" className="yp-btn" disabled={busy}><Search size={14} aria-hidden="true" /> {busy ? "찾는 중…" : "참고 영상 찾기"}</button>
    </form>
    <p className="yp-hint">주제 찾기와 같은 검색이에요. 채널 평소 조회수의 {BREAKOUT.ratio}배를 넘은 영상이 먼저 나와요. {!demo ? <CostTag kind="youtube" /> : null}</p>
    {error ? <div className="yp-errline" role="alert">{error}</div> : null}
    {busy ? <p className="yp-pempty" role="status">유튜브에서 찾고 채널마다 평소 조회수를 재는 중이에요…</p>
      : found ? found.length ? <><p className="yp-hint" style={{ marginBottom: 4 }}><b>찾은 영상</b> · 맞는 것만 [넣기]를 눌러요</p><ul className="yp-open-list">{found.map(video => <li key={video.id}>
        <span style={{ flex: 1, minWidth: 0 }}><a href={video.url} target="_blank" rel="noreferrer">{video.title}</a><br />
          <span className="yp-muted" style={{ fontSize: 12 }}>{video.channelTitle} · 조회 {compactCount(video.viewCount)}</span>{" "}
          {video.ratio !== null ? <span className={`yp-tag${isBreakout(video) ? " yp-ok" : ""}`}>평소의 {ratioLabel(video.ratio)}</span> : null}</span>
        {added.has(video.url) ? <span className="yp-tag yp-ok">넣었어요</span>
          : <button type="button" className="yp-btn yp-sm" onClick={() => onAdd({ url: video.url, videoId: video.id, title: `${video.title} · ${video.channelTitle}`.slice(0, 200) })}>넣기</button>}
      </li>)}</ul></> : <p className="yp-pempty">찾은 영상이 없어요. 다른 말로 찾아 보세요.</p> : null}
  </div>;
}

/** 5 공식 · 주제 후보: the staff AI's job and its result; [이 주제로] puts the 주제 and its formula on the topic. */
export function TopicFormulas({ project, onPick }: { project: YpProject; onPick: (topic: YpShortTopicPick, formula?: YpTopicFormula) => void }) {
  const loaded = useYpBundle();
  const page: YpPage = useMemo(() => ({ ...loaded, bundle: loaded.bundle && { ...loaded.bundle, project } }), [loaded, project]);
  const reload = loaded.reload;
  const job = useStaffJob(page, "topic-formula", useCallback(() => void reload(), [reload]));
  const [send, setSend] = useState(false);
  const research = loaded.bundle?.stages.topicResearch?.data.research;
  const canPick = project.yp.stage === "topic" && topicEditable(project);
  const ready = Boolean(project.title.trim() || project.yp.topic.refs.length);
  return <YpSection n={5} title="공식 · 주제 후보" gq="먹힌 제목 공식으로 어떤 주제를 할까요?" need={false}
    extra={canPick && research && !job.open ? <button type="button" className="yp-btn yp-sm" onClick={() => setSend(true)}><Sparkles size={14} /> 내 AI로 다시 뽑기</button> : null}>
    <div className="yp-max720">
      {canPick && (job.open || job.status?.job?.status === "blocked") ? <JobLine job={job} onRetry={() => setSend(true)} />
        : canPick && !research ? <div className="yp-ways" style={{ marginBottom: 0 }}>
          <button type="button" className="yp-way yp-rec" disabled={!ready} onClick={() => setSend(true)}><b><Sparkles size={14} aria-hidden="true" /> 내 AI에게 맡기기</b>
            <span>{ready ? "참고 영상과 시장 영상에서 제목 공식을 뽑고, 그 공식으로 주제 후보 3개를 내 줘요" : "먼저 1에 초안 주제를 쓰거나 4에 참고 영상을 넣어요"}</span></button></div> : null}
      {research ? <ul className="yp-hist">{research.topics.map(topic => {
        const formula = research.formulas.find(item => item.formula === topic.formula);
        return <li key={topic.title} style={{ alignItems: "center", flexWrap: "wrap", gap: 10 }}>
          <span style={{ flex: "1 1 260px", minWidth: 0 }}><b>{topic.title}</b><br /><span style={{ fontSize: 13 }}>{topic.insight}</span><br />
            <span className="yp-muted" style={{ fontSize: 12 }}>공식: {topic.formula}{formula ? ` · 채널 ${formula.channels}곳` : ""}{topic.why ? ` · ${topic.why}` : ""}</span></span>
          {topic.title === projectName(project) ? <span className="yp-tag yp-ok">고른 주제</span> : canPick && !job.open ? <button type="button" className="yp-btn yp-sm yp-pri" onClick={() => onPick(topic, formula)}>이 주제로</button> : null}
        </li>;
      })}</ul> : null}
      {research?.formulas.length ? <details className="yp-more-fields"><summary>뽑은 제목 공식 {research.formulas.length}개</summary>
        <ol style={{ margin: "8px 0", paddingLeft: 18, fontSize: 13, lineHeight: 1.6 }}>{research.formulas.map(item => <li key={item.formula} style={{ marginBottom: 6 }}>
          <b>{item.formula}</b> <span className={`yp-tag${item.channels >= 3 ? " yp-ok" : ""}`}>채널 {item.channels}곳</span><br />{item.desire}<br />
          <span className="yp-muted">{item.refs.slice(0, 4).map(ref => ref.title).join(" · ")}</span></li>)}</ol></details> : null}
      {research?.notes ? <details className="yp-more-fields"><summary>내 AI가 남긴 메모</summary><p style={{ whiteSpace: "pre-line", fontSize: 13 }}>{research.notes}</p></details> : null}
    </div>
    <SendDialog page={page} task="topic-formula" open={send} onClose={() => setSend(false)} job={job} queryDefault={topicKeywords(projectName(project), project.yp.topic.target)} />
  </YpSection>;
}
