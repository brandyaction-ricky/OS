"use client";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { ArrowRight, AtSign, Megaphone, Smartphone, Youtube } from "lucide-react";
import { isTopicPlatform, projectPlatform, TOPIC_PLATFORM_ORDER, TOPIC_PLATFORMS, type TopicPlatform } from "@/lib/content-platforms";
import { projectName, stageLabel, stepHref, type YpProject } from "@/lib/youtube-process/project";
import { refHostOk } from "@/lib/youtube-process/short-script";
import { ContentAutomationV07 } from "./content-automation-v07";
import { useSession } from "./session-provider";
import { errorMessage, youtubeProcessClient } from "./youtube-process-data";
import { YoutubeDiscoverScreen } from "./youtube-process-discover";

const ICON = { longform: Youtube, short: Smartphone, ad: Megaphone, threads: AtSign } as const;

/**
 * 주제 찾기 (owner 2026-10-28: one place for every platform's topics, so nobody mixes them up): pick what is being made first; each
 * platform then shows its own 참고 자료 and its own 반응도 기준 in the same place, in its own colour.
 * - 롱폼: the 기획실 (채널 모으기 · 터진 영상 · 틈새).
 * - 숏폼 · 릴스 and 광고: start from a 초안 키워드 (and a link if there is one); the new 숏폼's 주제 step finds the 참고 영상, pulls the
 *   formulas and three 주제 후보, and the PD fixes the topic there.
 * - 스레드: the 참고 자료 inbox of 콘텐츠 자동화, the same screen as 콘텐츠 자동화 › 참고 자료.
 */
export function TopicHub() {
  const params = useSearchParams();
  const router = useRouter();
  const asked = params.get("platform");
  const platform: TopicPlatform = isTopicPlatform(asked) ? asked : "longform";
  const info = TOPIC_PLATFORMS[platform];
  return <>
    <div className="yp-mv-head"><h1 className="page-title" data-ui="page-title">주제 찾기</h1><span style={{ flex: 1 }} /><Link className="yp-btn" href="/content/projects">← 내 영상</Link></div>
    <div className="yp-pf-tabs" role="tablist" aria-label="무엇을 만드나요">
      {TOPIC_PLATFORM_ORDER.map(key => { const Icon = ICON[key]; const item = TOPIC_PLATFORMS[key];
        return <button key={key} type="button" role="tab" aria-selected={platform === key} className={`yp-pf yp-pf-${key}${platform === key ? " yp-on" : ""}`}
          onClick={() => router.replace(`/content/projects?view=discover&platform=${key}`, { scroll: false })}>
          <Icon size={18} aria-hidden="true" /><span><b>{item.label}</b><small>{item.makes}</small></span></button>; })}
    </div>
    {/* The same line in every platform: where the references come from and the bar they must pass. */}
    <p className={`yp-pf-bar yp-pf-${platform}`}><b>{info.refs}</b><span>반응도 기준 · {info.bar}</span></p>
    {platform === "longform" ? <YoutubeDiscoverScreen bare />
      : platform === "threads" ? <ContentAutomationV07 page="references" embedded />
      : <ShortStart key={platform} platform={platform} />}
  </>;
}

/** 숏폼 · 릴스 and 광고: a 초안 키워드 (+ a link) becomes a new 숏폼 at 주제, where its references, formulas and 주제 후보 are found. */
function ShortStart({ platform }: { platform: "short" | "ad" }) {
  const { accessToken, demo, profile } = useSession();
  const client = useMemo(() => youtubeProcessClient(accessToken, demo), [accessToken, demo]);
  const router = useRouter();
  const [keyword, setKeyword] = useState("");
  const [link, setLink] = useState("");
  const [target, setTarget] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [projects, setProjects] = useState<YpProject[] | null>(null);
  useEffect(() => { if (client) client.list().then(setProjects, reason => setError(errorMessage(reason))); }, [client]);
  const ad = platform === "ad";
  const start = async () => {
    if (!client) return;
    if (link.trim() && !refHostOk(link.trim())) { setError("유튜브 · 인스타그램 · 틱톡 · 메타 광고 라이브러리 주소를 넣어 주세요."); return; }
    setBusy(true); setError("");
    try {
      const made = await client.create({ title: keyword.trim(), kind: "short", target: target.trim(), note: "", refs: [], purpose: ad ? "ad" : null, assigneeId: profile?.id ?? null });
      // The keyword stays the search words and the link the first 참고 자료, so the 주제 step opens ready to [찾기].
      await client.saveStage(made.id, "shortScript", 0, { query: keyword.trim().slice(0, 60), ...(link.trim() ? { refs: [{ url: link.trim(), title: "", script: "" }] } : {}) });
      router.push(stepHref(0, made.id));
    } catch (reason) { setError(errorMessage(reason)); setBusy(false); }
  };
  const open = (projects ?? []).filter(project => projectPlatform(project.yp.topic) === platform && ["topic", "draft"].includes(project.yp.stage));
  return <>
    <form className={`yp-card yp-pf-start yp-pf-${platform}`} onSubmit={event => { event.preventDefault(); if (keyword.trim().length >= 2) void start(); }}>
      <div className="yp-card-h">{ad ? "광고 주제 찾기" : "숏폼 · 릴스 주제 찾기"}</div>
      <div className="yp-card-b" style={{ display: "grid", gap: 10 }}>
        <p className="yp-hint" style={{ margin: 0 }}>주제를 먼저 정하지 않아요. 초안 키워드로 시작해서 {ad ? "오래 켜진 광고" : "반응 좋은 영상"}을 보고, 공식을 뽑은 뒤 주제를 확정해요.</p>
        <label className="yp-field" style={{ margin: 0 }}><span className="yp-fld-h"><b>초안 키워드</b><span className="yp-need">필수</span></span>
          <input className="yp-in" value={keyword} maxLength={60} onChange={event => setKeyword(event.target.value)} placeholder={ad ? "예) 강점 진단, 일이 안 맞을 때" : "예) 일이 안 맞는 신호"} aria-label="초안 키워드" /></label>
        <label className="yp-field" style={{ margin: 0 }}><span className="yp-fld-h"><b>관련 링크</b><span className="yp-opt">선택</span></span>
          <input className="yp-in" value={link} onChange={event => setLink(event.target.value)} placeholder={ad ? "메타 광고 라이브러리 주소" : "쇼츠 · 릴스 · 틱톡 주소"} aria-label="관련 링크" /></label>
        <label className="yp-field" style={{ margin: 0 }}><span className="yp-fld-h"><b>정밀 타겟</b><span className="yp-opt">선택</span></span>
          <input className="yp-in" value={target} maxLength={300} onChange={event => setTarget(event.target.value)} placeholder="예) 일이 안 맞는 것 같은데 이유를 모르는 3~7년 차 직장인" aria-label="정밀 타겟" /></label>
        {error ? <p className="yp-errline" role="alert">{error}</p> : null}
        <div className="yp-row-btns"><button type="submit" className="yp-btn yp-pri" disabled={busy || keyword.trim().length < 2}>{busy ? "만드는 중…" : "참고 자료 찾으러 가기"} <ArrowRight size={14} aria-hidden="true" /></button></div>
      </div>
    </form>
    <section className="yp-card" style={{ marginTop: 14 }}><div className="yp-card-h">주제를 찾는 중인 {ad ? "광고" : "숏폼"} {projects ? open.length : ""}</div>
      <div className="yp-card-b">{projects === null ? <p className="yp-hint" role="status">불러오는 중이에요…</p>
        : open.length ? <ul className="yp-hist">{open.map(project => <li key={project.id} style={{ alignItems: "center", gap: 10 }}>
          <span style={{ flex: 1, minWidth: 0 }}><b>{projectName(project)}</b><br /><span className="yp-muted" style={{ fontSize: 13 }}>{stageLabel(project)} 단계</span></span>
          <Link className="yp-btn yp-sm" href={stepHref(project.yp.stage === "topic" ? 0 : 1, project.id)}>이어서 하기</Link></li>)}</ul>
        : <p className="yp-pempty">아직 없어요. 위에서 초안 키워드로 시작해요.</p>}</div></section>
  </>;
}
