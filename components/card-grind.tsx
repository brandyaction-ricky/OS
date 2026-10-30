"use client";
// 카드뉴스 정본 다듬기 (정본 §9): the same 시험 묶음 drawn again under each 정본 version, scored on the 평가표, runs side by side, and the
// 고칠 점 that point at the 정본. The 정본 itself is edited in its OS document; this screen only shows what to change and whether it worked.
import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { apiRequest } from "@/lib/api-client";
import { CARD_FORMAT_IDS, CARD_FORMATS, cardProblems, type CardFormatId } from "@/lib/cardnews/formats";
import { BENCH_MAX, CARD_CRITERIA, CARD_GRADES, fixList, graduatedTwice, GRADUATION, mergedGrades, resultKey, runSummary, type Bench, type BenchResult, type BenchRun, type CardCriterion, type CardGrade } from "@/lib/cardnews/grind";
import { tokenEstimate } from "@/lib/cost";
import { GPT_TIERS, type GptTier } from "@/lib/youtube-process/gpt-draft";
import { projectName, type YpProject } from "@/lib/youtube-process/project";
import { CostTag, useCostConfirm } from "./cost-notice";
import { useSession } from "./session-provider";
import { CardPreview } from "./youtube-process-card";
import { errorMessage, youtubeProcessClient } from "./youtube-process-data";
import { YpSection } from "./youtube-process-frame";

interface GrindView { bench: Bench; runs: BenchRun[]; canon: { id: string; version: string } | null; me: string }
const API = "/api/v1/content/youtube/card-grind";
const day = (iso: string) => { const date = new Date(iso); return `${date.getMonth() + 1}/${date.getDate()} ${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`; };
const SOURCE = { longform: "롱폼", short: "숏폼", threads: "스레드", none: "주제만" } as const;
/** 「상 3 · 중 2 · 하 1」: how many criteria got each grade. */
const tally = (grades: Partial<Record<CardCriterion, CardGrade>>) => CARD_GRADES.map(grade => [grade, CARD_CRITERIA.filter(c => grades[c.n] === grade).length] as const).filter(([, n]) => n).map(([grade, n]) => `${grade} ${n}`).join(" · ");
// ponytail: a GPT answer per 시험 원본 is about the 정본 + 원본 (≈28,000) in and 4,000 per format out; the same planning figure as 카드 만들기.
const ESTIMATE = { input: 28_000, outputPerFormat: 4_000 };

/** The demo has no GPT: one example run of the demo 카드뉴스 so the comparison and the 평가표 have something to show. */
function demoView(): GrindView {
  const at = new Date().toISOString();
  const draft: BenchResult["draft"] = { format: "list", caption: "[예시] 캡션", hashtags: ["직장인", "강점", "번아웃"], slides: [
    { type: "cover" as const, fields: { head: "월요일마다 무거운 사람의 공통점 3가지", sub: "쉬어도 안 풀리는 피로는 신호일 수 있어요" } },
    ...["실수가 먼저 떠올라요", "주말에도 일 생각이 나요", "내가 고른 일이 없어요"].map(title => ({ type: "item" as const, fields: { title, body: "[예시] 장면 하나와 그 뜻 한 줄" } })),
    { type: "summary" as const, fields: { line: "지친 건 양이 아니라 고를 수 없어서예요" } }, { type: "end" as const, fields: { line: "이번 주에 고를 일 하나를 적어 봐요", action: "저장해 두기" } }] };
  const item = { id: "demo-i1", title: "[예시] 월요일마다 무거운 사람의 공통점", target: "3~7년 차 직장인", note: "", focus: "", source: { kind: "longform" as const, title: "[예시] 롱폼", text: "[예시] 원고", at }, at, by: "리키" };
  return { bench: { items: [item] }, canon: { id: "demo-canon", version: "v0.1" }, me: "demo-ricky", runs: [{ id: "demo-run-1", canon: "v0.1", at, by: "demo-ricky", byName: "리키", model: GPT_TIERS.saving.model,
    formats: ["list"], state: "done", results: [{ key: resultKey(item.id, "list"), itemId: item.id, title: item.title, format: "list", draft }],
    scores: { [resultKey(item.id, "list")]: { "demo-logan": { name: "로건", grades: { 1: "상", 2: "상", 3: "중", 4: "하", 5: "상", 6: "중" }, notes: { 4: "[예시] ‘~입니다’가 많아 딱딱해요" }, at } } } }] };
}

export function CardGrindScreen() {
  const { accessToken, demo } = useSession();
  const client = useMemo(() => youtubeProcessClient(accessToken, demo), [accessToken, demo]);
  const [view, setView] = useState<GrindView | null>(null);
  const [cards, setCards] = useState<YpProject[]>([]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState("");
  const [pick, setPick] = useState("");
  const [topic, setTopic] = useState({ title: "", target: "" });
  const [formats, setFormats] = useState<CardFormatId[]>(["list"]);
  const [tier, setTier] = useState<GptTier>("saving");
  const [open, setOpen] = useState<{ runId: string; key: string } | null>(null);
  const { confirm, element: costDialog } = useCostConfirm();
  const load = useCallback(async () => {
    if (demo) { setView(current => current ?? demoView()); return; }
    if (!accessToken) return;
    try { setView(await apiRequest<GrindView>(API, { token: accessToken })); setError(""); } catch (reason) { setError(errorMessage(reason)); }
  }, [accessToken, demo]);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => { if (client) client.list().then(rows => setCards(rows.filter(row => row.yp.topic.type === "card")), () => undefined); }, [client]);
  // While a run is drawing, look again every 20 seconds.
  const running = view?.runs.some(run => run.state === "running");
  useEffect(() => { if (!running) return; const timer = window.setInterval(() => void load(), 20_000); return () => window.clearInterval(timer); }, [running, load]);

  const act = async (what: string, body: Record<string, unknown>) => {
    setBusy(what); setError("");
    try {
      if (demo) {
        if (body.action === "run") throw new Error("연습 화면에서는 GPT를 부르지 않아요.");
        if (body.action === "score" && view) {
          const { runId, key, grades, notes } = body as { runId: string; key: string; grades: Record<string, CardGrade>; notes: Record<string, string> };
          setView({ ...view, runs: view.runs.map(run => run.id !== runId ? run : { ...run, scores: { ...run.scores, [key]: { ...(run.scores[key] ?? {}), [view.me]: { name: "리키", grades, notes, at: new Date().toISOString() } } } }) });
        } else if (body.action === "remove" && view) setView({ ...view, bench: { items: view.bench.items.filter(item => item.id !== body.itemId) } });
        else throw new Error("연습 화면에서는 시험 묶음을 바꾸지 않아요.");
        return true;
      }
      setView(await apiRequest<GrindView>(API, { token: accessToken, method: "POST", body: JSON.stringify(body) }));
      return true;
    } catch (reason) { setError(errorMessage(reason)); return false; } finally { setBusy(""); }
  };
  const runDraw = async () => {
    if (!view) return;
    const model = GPT_TIERS[tier].model, items = view.bench.items.length;
    const each = tokenEstimate(model, ESTIMATE.input, ESTIMATE.outputPerFormat * formats.length);
    if (!(await confirm({ model, amount: each === null ? null : each * items * 2, upTo: true, detail: `시험 원본 ${items}개 × 포맷 ${formats.length}개 · 형식이 틀리면 한 번 더 물어요`, ok: "다시 뽑기" }))) return;
    await act("run", { action: "run", formats, tier });
  };

  if (!view) return <>{error ? <div className="yp-note yp-warn" role="alert"><div>{error}</div></div> : <p className="yp-hint" role="status">불러오는 중이에요…</p>}</>;
  const runs = [...view.runs].sort((a, b) => a.at.localeCompare(b.at)).slice(-3);
  const latest = [...view.runs].filter(run => run.state === "done").sort((a, b) => b.at.localeCompare(a.at))[0];
  const keys = [...new Set(runs.flatMap(run => run.results.map(result => result.key)))];
  const result = (run: BenchRun, key: string) => run.results.find(row => row.key === key);
  const openRun = open && view.runs.find(run => run.id === open.runId);
  const openResult = openRun && open ? result(openRun, open.key) : undefined;
  const inBench = new Set(view.bench.items.map(item => item.from?.projectId).filter(Boolean));

  return <>
    {costDialog}
    {error ? <div className="yp-note yp-warn" role="alert"><div>{error}</div></div> : null}
    <section className="yp-card yp-grind-canon"><div className="yp-card-b">
      <b>지금 정본: 카드뉴스 정본 {view.canon?.version ?? "없음"}</b>
      {view.canon && !demo ? <Link className="yp-lnk" href={`/knowledge?document=${view.canon.id}`}>정본 열기 →</Link> : null}
      <span className={graduatedTwice(view.runs) ? "yp-tag yp-ok" : "yp-tag"}>{graduatedTwice(view.runs) ? "졸업 기준 충족 · v1.0 승인 요청" : `졸업: 두 번 연속 초안 ${GRADUATION.passRate * 100}% 이상이 모든 기준 ‘중’ 이상 · ‘상’ ${GRADUATION.tops}개 이상 · 자동 검사 지적 0`}</span>
    </div></section>

    <YpSection n={1} title="시험 묶음" gq={`${view.bench.items.length}/${BENCH_MAX} · 정본이 바뀌어도 늘 같은 원본으로 뽑아요`}>
      {view.bench.items.length ? <ul className="yp-hist">{view.bench.items.map(item => <li key={item.id} style={{ alignItems: "center", gap: 10 }}>
        <span className="yp-tag">{SOURCE[item.source.kind]}</span><span style={{ flex: 1, minWidth: 0 }}><b>{item.title}</b>{item.focus ? <small className="yp-muted"> · {item.focus}</small> : null}</span>
        <button type="button" className="yp-btn yp-sm" disabled={Boolean(busy)} onClick={() => void act("remove", { action: "remove", itemId: item.id })}>빼기</button></li>)}</ul>
        : <p className="yp-pempty">아직 없어요. 롱폼 · 숏폼 · 스레드 · 주제만에서 하나씩, 3~5개를 넣어요.</p>}
      <div className="yp-row-btns" style={{ marginTop: 10, flexWrap: "wrap" }}>
        <select className="yp-in" value={pick} onChange={event => setPick(event.target.value)} aria-label="넣을 카드뉴스" style={{ flex: 1, minWidth: 220 }}>
          <option value="">만든 카드뉴스에서 고르기</option>
          {cards.filter(card => !inBench.has(card.id)).map(card => <option key={card.id} value={card.id}>{projectName(card)}</option>)}</select>
        <button type="button" className="yp-btn" disabled={!pick || Boolean(busy) || view.bench.items.length >= BENCH_MAX} onClick={() => void act("add", { action: "add", projectId: pick }).then(ok => { if (ok) setPick(""); })}>넣기</button></div>
      <div className="yp-row-btns" style={{ marginTop: 8, flexWrap: "wrap" }}>
        <input className="yp-in" style={{ flex: 2, minWidth: 200 }} value={topic.title} maxLength={200} onChange={event => setTopic({ ...topic, title: event.target.value })} placeholder="주제만 넣기 · 한 줄 주제" aria-label="주제만 넣기 · 한 줄 주제" />
        <input className="yp-in" style={{ flex: 1, minWidth: 160 }} value={topic.target} maxLength={300} onChange={event => setTopic({ ...topic, target: event.target.value })} placeholder="누구에게" aria-label="주제만 넣기 · 누구에게" />
        <button type="button" className="yp-btn" disabled={topic.title.trim().length < 2 || !topic.target.trim() || Boolean(busy) || view.bench.items.length >= BENCH_MAX}
          onClick={() => void act("topic", { action: "addTopic", title: topic.title.trim(), target: topic.target.trim(), note: "" }).then(ok => { if (ok) setTopic({ title: "", target: "" }); })}>넣기</button></div>
    </YpSection>

    <YpSection n={2} title="이 정본으로 다시 뽑기" gq="회사 GPT가 시험 원본을 모두 지금 정본으로 다시 써요 · 3~6분">
      <div className="yp-row-btns" style={{ flexWrap: "wrap", gap: 12 }}>
        {CARD_FORMAT_IDS.map(id => <label key={id} className="yp-chk"><input type="checkbox" checked={formats.includes(id)} disabled={!formats.includes(id) && formats.length >= 3}
          onChange={() => setFormats(formats.includes(id) ? formats.filter(row => row !== id) : [...formats, id])} /> {CARD_FORMATS[id].name}</label>)}
        <span className="yp-sp" />
        {(["saving", "precise"] as const).map(key => <label key={key} className="yp-chk"><input type="radio" name="grind-tier" checked={tier === key} onChange={() => setTier(key)} /> {GPT_TIERS[key].label}{key === "saving" ? " (권장)" : ""}</label>)}</div>
      <div className="yp-row-btns" style={{ marginTop: 10 }}>
        <button type="button" className="yp-btn yp-pri" disabled={!formats.length || !view.bench.items.length || Boolean(busy) || running} onClick={() => void runDraw()}>{running ? "다시 뽑는 중…" : "이 정본으로 다시 뽑기"}</button><CostTag kind="paid" /></div>
      {running ? <p className="yp-hint" role="status">GPT가 쓰고 있어요. 끝나면 아래 비교에 새 칸이 생겨요.</p> : null}
    </YpSection>

    <YpSection n={3} title="정본 버전끼리 비교" gq="최근 3번 · 칸을 눌러 평가표로 채점해요">
      {runs.length ? <div className="yp-grind-table" style={{ gridTemplateColumns: `minmax(140px, 200px) repeat(${runs.length}, minmax(260px, 1fr))` }}>
        <div />
        {runs.map(run => { const sum = runSummary(run);
          return <div key={run.id} className="yp-grind-head"><b>정본 {run.canon}</b><small>{day(run.at)} · {run.byName} · {run.model.startsWith("gpt-6-astra") ? "정밀" : "절약"}</small>
            {run.state === "running" ? <span className="yp-tag yp-warn">뽑는 중</span> : run.state === "failed" ? <span className="yp-tag yp-bad">못 뽑음 · {run.error}</span>
              : <small>채점 {sum.scored}/{sum.drafts} · 통과 {sum.passed} ({Math.round(sum.passRate * 100)}%) · 자동 검사 {sum.findings}{sum.failed ? ` · 실패 ${sum.failed}` : ""}{sum.graduated ? " · 졸업 기준 ✓" : ""}</small>}</div>; })}
        {keys.map(key => { const [itemId, format] = key.split(":") as [string, CardFormatId]; const title = runs.map(run => result(run, key)?.title).find(Boolean) ?? itemId;
          return [<div key={`${key}-h`} className="yp-grind-row-h"><b>{title}</b><small>{CARD_FORMATS[format]?.name}</small></div>,
            ...runs.map(run => <GrindCell key={`${key}-${run.id}`} run={run} result={result(run, key)} me={view.me} active={open?.runId === run.id && open.key === key} onOpen={() => setOpen({ runId: run.id, key })} />)]; })}
      </div> : <p className="yp-pempty">아직 다시 뽑은 적이 없어요.</p>}
    </YpSection>

    {openRun && openResult?.draft ? <ScorePanel run={openRun} result={openResult} me={view.me} busy={busy === "score"} onClose={() => setOpen(null)}
      onSave={(grades, notes) => void act("score", { action: "score", runId: openRun.id, key: openResult.key, grades, notes }).then(ok => { if (ok) setOpen(null); })} /> : null}

    <YpSection n={4} title="고칠 점" gq={latest ? `정본 ${latest.canon} · ${day(latest.at)} 결과에서` : "채점한 결과가 생기면 보여요"}>
      {latest && fixList(latest).length ? <ul className="yp-grind-fix">{fixList(latest).map(row => <li key={row.n}>
        <div><b>{row.n}. {row.name}</b> <span className={row.canonIssue ? "yp-tag yp-bad" : "yp-tag"}>{row.canonIssue ? `초안 ${row.drafts}개에서 · 정본 문제` : "초안 1개에서 · 그 초안 문제"}</span></div>
        <ul>{row.notes.map((note, at) => <li key={at}><span className={note.grade === "하" ? "yp-bad" : "yp-warn"}>{note.grade}</span> {note.title} · {CARD_FORMATS[note.format].name} — {note.note || "이유 없음"} <small className="yp-muted">({note.by})</small></li>)}</ul></li>)}</ul>
        : <p className="yp-pempty">아직 지적이 없어요.</p>}
      <ol className="yp-grind-how">
        <li>‘정본 문제’로 표시된 지적만 골라, 정본에 넣을 문장(지금 문장 → 새 문장)을 정해요.</li>
        <li>대표 승인을 받은 뒤 OS의 카드뉴스 정본을 고치고, 맨 위 「정본 묶음」 줄을 0.1 올리고, 변경 이력에 이유를 적어요.</li>
        <li>여기서 같은 시험 묶음을 다시 뽑아 채점해요. 점수가 떨어지면 OS 문서의 이전 버전으로 되돌려요.</li></ol>
    </YpSection>
  </>;
}

function GrindCell({ run, result, me, active, onOpen }: { run: BenchRun; result?: BenchResult; me: string; active: boolean; onOpen: () => void }) {
  if (run.state === "running") return <div className="yp-grind-cell yp-muted">뽑는 중…</div>;
  if (!result) return <div className="yp-grind-cell yp-muted">이 정본에서는 안 뽑았어요</div>;
  if (!result.draft) return <div className="yp-grind-cell"><span className="yp-tag yp-bad">못 뽑음</span><small>{result.error}</small></div>;
  const draft = { ...result.draft, id: result.key, at: run.at, by: run.byName };
  const merged = mergedGrades(run.scores[result.key]);
  const blocking = cardProblems(result.draft).blocking.length;
  return <button type="button" className={`yp-grind-cell${active ? " yp-on" : ""}`} onClick={onOpen} aria-label={`${result.title} · 정본 ${run.canon} 채점`}>
    <span className="yp-card-strip">{draft.slides.slice(0, 3).map((_, index) => <CardPreview key={index} draft={draft} index={index} width={84} />)}</span>
    <small>{blocking ? `자동 검사 ${blocking}` : "자동 검사 통과"} · {merged ? `채점 ${tally(merged)}` : "채점 전"}{run.scores[result.key]?.[me] ? " · 내 채점 ✓" : ""}</small>
  </button>;
}

function ScorePanel({ run, result, me, busy, onClose, onSave }: { run: BenchRun; result: BenchResult; me: string; busy: boolean; onClose: () => void;
  onSave: (grades: Record<string, CardGrade>, notes: Record<string, string>) => void }) {
  const mine = run.scores[result.key]?.[me];
  const [grades, setGrades] = useState<Partial<Record<CardCriterion, CardGrade>>>(mine?.grades ?? {});
  const [notes, setNotes] = useState<Partial<Record<CardCriterion, string>>>(mine?.notes ?? {});
  const draft = { ...result.draft!, id: result.key, at: run.at, by: run.byName };
  const others = Object.entries(run.scores[result.key] ?? {}).filter(([id]) => id !== me);
  const done = CARD_CRITERIA.every(c => grades[c.n]);
  return <section className="yp-card yp-grind-score" aria-label="평가표">
    <div className="yp-card-h">{result.title} · {CARD_FORMATS[result.format].name} · 정본 {run.canon}<span className="yp-sp" /><button type="button" className="yp-btn yp-sm" onClick={onClose}>닫기</button></div>
    <div className="yp-card-b">
      <div className="yp-card-strip">{draft.slides.map((_, index) => <CardPreview key={index} draft={draft} index={index} width={170} />)}</div>
      {result.draft!.caption ? <p className="yp-card-caption" style={{ marginTop: 10 }}>{result.draft!.caption}</p> : null}
      <div className="yp-grind-form">{CARD_CRITERIA.map(c => <div key={c.n} className="yp-grind-crit">
        <div><b>{c.n}. {c.name}</b><small className="yp-muted">상: {c.top}</small></div>
        <div role="radiogroup" aria-label={c.name} className="yp-row-btns">{CARD_GRADES.map(grade => <button key={grade} type="button" role="radio" aria-checked={grades[c.n] === grade}
          className={`yp-btn yp-sm${grades[c.n] === grade ? " yp-pri" : ""}`} onClick={() => setGrades(current => ({ ...current, [c.n]: grade }))}>{grade}</button>)}</div>
        <input className="yp-in" value={notes[c.n] ?? ""} maxLength={300} onChange={event => { const text = event.target.value; setNotes(current => ({ ...current, [c.n]: text })); }} placeholder={grades[c.n] && grades[c.n] !== "상" ? "이유 한 줄 (필수)" : "이유 한 줄"} aria-label={`${c.name} 이유`} /></div>)}</div>
      {others.length ? <p className="yp-hint">다른 사람 채점: {others.map(([, score]) => `${score.name} (${tally(score.grades)})`).join(" · ")}</p> : null}
      <div className="yp-row-btns"><button type="button" className="yp-btn yp-pri" disabled={busy || !done || CARD_CRITERIA.some(c => grades[c.n] && grades[c.n] !== "상" && !notes[c.n]?.trim())}
        onClick={() => onSave(Object.fromEntries(Object.entries(grades)) as Record<string, CardGrade>, Object.fromEntries(Object.entries(notes).filter(([, note]) => note?.trim())) as Record<string, string>)}>{busy ? "저장하는 중…" : "채점 저장"}</button>
        {!done ? <small className="yp-muted">여섯 기준을 모두 골라요. ‘중’ · ‘하’는 이유를 한 줄 써요.</small> : null}</div>
    </div>
  </section>;
}
