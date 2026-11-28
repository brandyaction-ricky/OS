"use client";
import { useCallback, useState } from "react";
import Link from "next/link";
import { Sparkles } from "lucide-react";
import { apiRequest } from "@/lib/api-client";
import { GPT_TIERS } from "@/lib/youtube-process/gpt-draft";
import { stepHref } from "@/lib/youtube-process/project";
import { RECYCLE } from "@/lib/youtube-process/recycle";
import type { YpRecycleItem } from "@/lib/youtube-process/stages";
import { CostTag, tokenEstimate } from "./cost-notice";
import { JobLine, SendDialog, useStaffJob, type SendTab } from "./youtube-process-ai";
import { YpSection, type YpPage } from "./youtube-process-frame";

const clock = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;
const letters = (s: string) => s.replace(/\s/g, "").length;
/** One GPT card's top cost as the GPT dialog shows it (정밀). */
export const gptCard = () => tokenEstimate(GPT_TIERS.precise.model, 60_000, 20_000) ?? 0;

/**
 * 쇼츠 · 칼럼 › 롱폼에서 뽑기 (「롱폼 재활용 숏폼 정본」 §1~§2): GPT or the staff AI picks stand-alone stretches of this longform; the PD checks
 * each stretch and its first-screen title once. [숏폼 만들기] / [5편 모두 만들기] make 숏폼 at 제작 that run by themselves to their preview
 * (voice cut from the longform 0원, GPT 기획표, no person's 기획표 확인 — 대표 11-21); the previews are looked at on 「한눈에 확인」.
 */
export function RecyclePanel({ page, onOverview }: { page: YpPage; onOverview: () => void }) {
  const [send, setSend] = useState<false | SendTab>(false);
  const [making, setMaking] = useState("");
  const [titles, setTitles] = useState<Record<string, string[]>>({});
  const [starting, setStarting] = useState(false);
  const reload = page.reload;
  const job = useStaffJob(page, "short-recycle", useCallback(() => void reload(), [reload]));
  const project = page.bundle?.project;
  const recycle = page.bundle?.stages.shortTopics.data.recycle;
  const hasColumn = Boolean(page.bundle?.stages.column.data.items.length);
  if (!project) return null;
  const titleOf = (item: YpRecycleItem) => titles[item.id] ?? item.title;
  const items = recycle?.items ?? [];
  const waiting = items.filter((item) => !item.made);
  const tooLong = (item: YpRecycleItem) => titleOf(item).some((line) => letters(line) > RECYCLE.titleLine) || !titleOf(item)[0]?.trim();
  const makeOne = async (item: YpRecycleItem) => {
    const { topics } = await page.client!.makeRecycleShort(project.id, item.id, titleOf(item).map((line) => line.trim()).filter(Boolean), true);
    page.setBundle((current) => current ? { ...current, stages: { ...current.stages, shortTopics: topics } } : current);
  };
  const make = async (item: YpRecycleItem) => {
    if (!page.client) return;
    setMaking(item.id); page.setError("");
    try { await makeOne(item); } catch (reason) { page.fail(reason); } finally { setMaking(""); }
  };
  const makeAll = async () => {
    if (!page.client) return;
    setMaking("all"); page.setError("");
    try { for (const item of waiting) await makeOne(item); onOverview(); } catch (reason) { page.fail(reason); } finally { setMaking(""); }
  };
  // 「숏폼 5편 + 칼럼 한 번에」: the stretches and (when there is none yet) the 칼럼, both on GPT at once.
  const startBoth = async () => {
    if (!page.accessToken) return;
    setStarting(true); page.setError("");
    try {
      const post = (body: object) => apiRequest("/api/v1/content/youtube-automation/ai-jobs", { method: "POST", token: page.accessToken, body: JSON.stringify({ ...body, sourceId: project.id, gpt: "precise" }) });
      await post({ task: "short-recycle" });
      if (!hasColumn) await post({ task: "column", count: 1 });
      await job.load();
    } catch (reason) { page.fail(reason); } finally { setStarting(false); }
  };
  return <>
    <YpSection n={1} title="롱폼에서 숏폼 뽑기" gq="혼자서 이해되는 구간을 롱폼 음성 그대로" extra={items.length && !job.open ? <button type="button" className="yp-btn yp-sm" onClick={() => setSend("gpt")}><Sparkles size={14} /> 다시 뽑기</button> : null}>
      {job.open || job.status?.job?.status === "blocked" ? <JobLine job={job} onRetry={() => setSend(job.status?.job?.executor === "gpt" ? "gpt" : "queue")} /> : null}
      {items.length ? <>
        <p className="yp-hint">구간과 첫 화면 제목을 확인하고 만들기를 누르면, 숏폼마다 음성(롱폼 음성을 잘라 1.25배 · 0원) → 기획표(GPT) → 미리보기까지 저절로 가요. 미리보기는 「한눈에 확인」에서 한꺼번에 봐요.</p>
        {waiting.length ? <div className="yp-savebar yp-rv-top">
          <button type="button" className="yp-btn yp-pri" disabled={Boolean(making) || waiting.some(tooLong)} onClick={() => void makeAll()}>{making === "all" ? "만드는 중…" : `${waiting.length}편 모두 만들기`}</button>
          <CostTag kind="paid" upTo amount={gptCard() * waiting.length} what="기획표 GPT" />
          {waiting.some(tooLong) ? <span className="yp-warn">제목 줄을 {RECYCLE.titleLine}자 이하로 고쳐 주세요</span> : null}
        </div> : <div className="yp-savebar yp-rv-top"><button type="button" className="yp-btn yp-sm" onClick={onOverview}>한눈에 확인 →</button></div>}
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
              : <button type="button" className="yp-btn yp-sm" disabled={Boolean(making) || tooLong(item)} onClick={() => void make(item)}>{making === item.id ? "만드는 중…" : "이것만 만들기"}</button>}
          </li>;
        })}</ul></>
        : job.open ? null : <div className="yp-ways">
          <button type="button" className="yp-way yp-rec" disabled={starting} onClick={() => void startBoth()}><b><Sparkles size={14} aria-hidden="true" /> {starting ? "보내는 중…" : `숏폼 ${RECYCLE.count}편${hasColumn ? "" : " + 칼럼"} 한 번에 만들기`}</b>
            <span>GPT가 혼자서 이해되는 구간 {RECYCLE.count}개{hasColumn ? "" : "와 SEO 칼럼 초안"}을 함께 써요 · 3~6분 · <CostTag kind="paid" upTo amount={gptCard() * (hasColumn ? 1 : 2)} /></span></button>
          <button type="button" className="yp-way" onClick={() => setSend("gpt")}><b>구간만 GPT로 뽑기</b><span>모델(정밀 · 절약)을 골라 구간만 뽑아요</span></button>
          <button type="button" className="yp-way" onClick={() => setSend("queue")}><b>내 AI에게 맡기기</b><span>내 AI 구독으로 구간을 뽑아요</span></button></div>}
    </YpSection>
    <SendDialog page={page} task="short-recycle" open={Boolean(send)} initialTab={send || undefined} onClose={() => setSend(false)} job={job} />
  </>;
}
