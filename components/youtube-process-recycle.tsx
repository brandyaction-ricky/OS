"use client";
import { useCallback, useState } from "react";
import Link from "next/link";
import { Sparkles } from "lucide-react";
import { stepHref } from "@/lib/youtube-process/project";
import { RECYCLE } from "@/lib/youtube-process/recycle";
import type { YpRecycleItem } from "@/lib/youtube-process/stages";
import { JobLine, SendDialog, useStaffJob, type SendTab } from "./youtube-process-ai";
import { YpSection, type YpPage } from "./youtube-process-frame";

const clock = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;
const letters = (s: string) => s.replace(/\s/g, "").length;

/**
 * 쇼츠 · 칼럼 › 롱폼에서 뽑기 (「롱폼 재활용 숏폼 정본」 §1~§2): the staff AI picks stand-alone stretches of this longform; the PD checks
 * each stretch and its first-screen title once, and [숏폼 만들기] makes a 숏폼 at 제작 that uses the longform's own voice, cut (0원).
 */
export function RecyclePanel({ page }: { page: YpPage }) {
  const [send, setSend] = useState<false | SendTab>(false);
  const [making, setMaking] = useState("");
  const [titles, setTitles] = useState<Record<string, string[]>>({});
  const reload = page.reload;
  const job = useStaffJob(page, "short-recycle", useCallback(() => void reload(), [reload]));
  const project = page.bundle?.project;
  const recycle = page.bundle?.stages.shortTopics.data.recycle;
  if (!project) return null;
  const titleOf = (item: YpRecycleItem) => titles[item.id] ?? item.title;
  const make = async (item: YpRecycleItem) => {
    if (!page.client) return;
    setMaking(item.id); page.setError("");
    try {
      const { topics } = await page.client.makeRecycleShort(project.id, item.id, titleOf(item).map((line) => line.trim()).filter(Boolean));
      page.setBundle((current) => current ? { ...current, stages: { ...current.stages, shortTopics: topics } } : current);
    } catch (reason) { page.fail(reason); } finally { setMaking(""); }
  };
  const items = recycle?.items ?? [];
  return <>
    <YpSection n={1} title="롱폼에서 숏폼 뽑기" gq="혼자서 이해되는 구간을 롱폼 음성 그대로" extra={items.length && !job.open ? <button type="button" className="yp-btn yp-sm" onClick={() => setSend("queue")}><Sparkles size={14} /> 다시 뽑기</button> : null}>
      {job.open || job.status?.job?.status === "blocked" ? <JobLine job={job} onRetry={() => setSend("queue")} /> : null}
      {items.length ? <>
        <p className="yp-hint">구간과 첫 화면 제목을 확인하고 [숏폼 만들기]를 누르면, 주제 · 대본이 확정된 숏폼이 제작 단계로 만들어져요. 그 숏폼에서 [음성 만들기]를 누르면 새 음성 대신 롱폼 음성을 잘라 1.25배로 써요(음성 비용 0원).</p>
        <ul className="yp-hist">{items.map((item, k) => {
          const title = titleOf(item), long = title.some((line) => letters(line) > RECYCLE.titleLine);
          return <li key={item.id}>
            <div className="yp-recycle">
              <b>{k + 1}. {item.made ? item.title.join(" ") : "첫 화면 제목"}</b> <span className="yp-muted">· {item.seconds}초 · 롱폼 {clock(item.parts[0]?.start ?? 0)}~{clock(item.parts.at(-1)?.end ?? 0)}{item.parts.length > 1 ? ` · ${item.parts.length}조각` : ""}</span>
              {item.made ? null : <div className="yp-recycle-title">{[0, 1].map((i) => <input key={i} className="yp-in" value={title[i] ?? ""} maxLength={30} placeholder={i ? "2줄 (선택)" : "1줄"} aria-label={`${k + 1}번 제목 ${i + 1}줄`}
                onChange={(event) => setTitles((all) => { const next = [...titleOf(item)]; next[i] = event.target.value; return { ...all, [item.id]: next }; })} />)}
                {long ? <span className="yp-warn">한 줄 {RECYCLE.titleLine}자 이하로</span> : null}</div>}
              <p className="yp-muted">{item.parts.map((p) => p.text).join(" … ")}</p>
              {item.why ? <p className="yp-muted">· {item.why}</p> : null}
            </div>
            {item.made ? <Link className="yp-btn yp-sm" href={stepHref(3, item.made.projectId)}>숏폼 열기 →</Link>
              : <button type="button" className="yp-btn yp-sm yp-pri" disabled={Boolean(making) || long || !title[0]?.trim()} onClick={() => void make(item)}>{making === item.id ? "만드는 중…" : "숏폼 만들기"}</button>}
          </li>;
        })}</ul></>
        : job.open ? null : <div className="yp-ways"><button type="button" className="yp-way yp-rec" onClick={() => setSend("queue")}><b><Sparkles size={14} aria-hidden="true" /> 내 AI에게 구간 {RECYCLE.count}개 맡기기</b>
          <span>롱폼 원고와 받아쓰기로 혼자서 이해되는 구간(1.25배 {RECYCLE.minSeconds}~{RECYCLE.maxSeconds}초)과 제목을 골라요 · 음성 비용 0원</span></button></div>}
    </YpSection>
    <SendDialog page={page} task="short-recycle" open={Boolean(send)} initialTab={send || undefined} onClose={() => setSend(false)} job={job} />
  </>;
}
