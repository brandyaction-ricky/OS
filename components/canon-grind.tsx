"use client";
// 정본 다듬기 (카드뉴스 정본 §9, 설계서 §9): the same 시험 묶음 drawn again under each 정본 version, scored on the 평가표, runs side by side,
// and the 고칠 점 that point at the 정본. One screen for every kind (카드뉴스 · 숏폼 대본 · 스레드 · SEO 칼럼); each 정본 is edited in its OS document.
// 롱폼 원고 has a screen of its own below: its scores are the 두 번째 검수 each 원고 already got.
import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState, type MutableRefObject } from "react";
import { apiRequest } from "@/lib/api-client";
import { CARD_FORMAT_IDS, CARD_FORMATS, type CardFormatId } from "@/lib/cardnews/formats";
import { BENCH_MAX, CARD_GRADES, fixList, GRADUATION, graduatedTwice, GRIND_KINDS, mergedGrades, resultKey, runSummary, scriptBundles, scriptFixes, scriptGraduated,
  type ScriptVerdict, type Bench, type BenchResult, type BenchRun, type CardCriterion, type CardDraftPart, type CardGrade, type ColumnDraft, type GrindKind, type ShortDraft, type ThreadsDraft } from "@/lib/canon-grind/grind";
import { tokenEstimate } from "@/lib/cost";
import { columnMeta, columnSlots, renderColumn } from "@/lib/seo-column";
import { GPT_TIERS, type GptTier } from "@/lib/youtube-process/gpt-draft";
import { projectName, stepHref } from "@/lib/youtube-process/project";
import { threadsPostLength, threadsPostRole } from "@/lib/threads-posts";
import { checkShortScript } from "@/lib/youtube-process/short-script";
import { CostTag, useCostConfirm } from "./cost-notice";
import { useSession } from "./session-provider";
import { CardPreview } from "./youtube-process-card";
import { errorMessage, youtubeProcessClient } from "./youtube-process-data";
import { YpSection } from "./youtube-process-frame";

interface GrindView { bench: Bench; runs: BenchRun[]; canon: { id: string; version: string } | null; me: string }
/** The fields of a personal 스레드 주제 the picker looks at. */
interface ThreadsTopicRow { id: string; title: string; stage: string; metadata?: { kind?: string; editorial_workflow?: string; reference_items?: unknown[] } }
const API = (kind: GrindKind) => `/api/v1/content/youtube/canon-grind?kind=${kind}`;
const day = (iso: string) => { const date = new Date(iso); return `${date.getMonth() + 1}/${date.getDate()} ${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`; };
const SOURCE = { longform: "롱폼", short: "숏폼", threads: "스레드", none: "주제만" } as const;
// ponytail: planning figures for the estimate shown as 「최대」 — a card answer reads the 정본 + 원본 (≈28,000) and writes 4,000 per format;
// a 숏폼 대본 answer reads its 정본, the 말투 정본 and the 참고 영상 (≈45,000) and writes ≈3,000; a 스레드 answer reads the long 스레드 정본
// with its adopted examples and the topic's 재료 (≈60,000) and writes ≈3,000; an SEO 칼럼 reads its 정본 and the 롱폼 원고 (≈40,000) and
// writes one HTML document with its image prompts (≈8,000).
const ESTIMATE: Record<GrindKind, (formats: number) => { input: number; output: number }> = {
  card: formats => ({ input: 28_000, output: 4_000 * formats }), short: () => ({ input: 45_000, output: 3_000 }), threads: () => ({ input: 60_000, output: 3_000 }),
  column: () => ({ input: 40_000, output: 8_000 }),
};
const formatName = (format: string) => format === "script" ? "대본" : format === "posts" ? "글타래" : format === "html" ? "칼럼" : CARD_FORMATS[format as CardFormatId]?.name ?? format;
/** What goes in, per kind: the picker's first line and the empty 시험 묶음. */
const PICK: Record<GrindKind, { choose: string; empty: string }> = {
  card: { choose: "만든 카드뉴스에서 고르기", empty: "아직 없어요. 롱폼 · 숏폼 · 스레드 · 주제만에서 하나씩, 3~5개를 넣어요." },
  short: { choose: "대본을 확정한 숏폼에서 고르기", empty: "아직 없어요. 대본을 확정한 숏폼을 3~5개 넣어요." },
  threads: { choose: "내가 확정한 스레드 주제에서 고르기", empty: "아직 없어요. 확정한 스레드 주제를 3~5개 넣어요. 넣은 주제의 재료는 팀에 보여요." },
  column: { choose: "원고를 확정한 롱폼에서 고르기", empty: "아직 없어요. 원고를 확정한 롱폼을 3~5개 넣어요." },
};
/** The longform stages whose 원고 is confirmed (from 제작 on). */
const SCRIPT_CONFIRMED = ["make", "review", "upload", "shorts", "done"];
/** 「상 3 · 중 2 · 하 1」: how many criteria got each grade. */
const tally = (grades: Partial<Record<CardCriterion, CardGrade>>) => CARD_GRADES.map(grade => [grade, Object.values(grades).filter(value => value === grade).length] as const)
  .filter(([, count]) => count).map(([grade, count]) => `${grade} ${count}`).join(" · ");
const scriptLines = (draft: ShortDraft) => draft.text.split(/\r?\n/).map(line => line.trim()).filter(Boolean);

const DEMO_PROMPT = "Editorial flat vector illustration of a tired Korean office worker at a desk late in the evening, looking at a salary slip and a calendar. Centered composition, wide shot, generous negative space at top. Minimalist palette of deep navy (#0D1531) and vivid blue (#2735C8) on a light off-white background (#F7F8FF). Calm, thoughtful, professional mood, soft even lighting. 16:9 aspect ratio. No text, no words, no logos in the image.";
const DEMO_COLUMN = `<!DOCTYPE html><html lang="ko"><head><title>[예시] 연봉 보고 옮겼는데 또 힘들다면, 다음엔 무엇부터 봐야 할까</title><meta name="description" content="[예시] 연봉을 올려 이직했는데 석 달 만에 다시 지쳤다면 연봉이 막아 주는 것과 막지 못하는 것을 나눠 봐야 해요. 다시 고를 때 먼저 볼 세 가지를 정리했어요."><meta name="keywords" content="이직, 연봉, 번아웃, 직장인, 강점"><meta name="slug" content="salary-move-still-tired"></head><body><article class="ba-article"><h1>[예시] 연봉 보고 옮겼는데 또 힘들다면</h1><figure class="ph hero" data-slot="hero" data-prompt="${DEMO_PROMPT}"><figcaption>[대표 이미지] 늦은 저녁 급여 명세서를 보는 직장인</figcaption></figure><div class="tldr"><b>3줄 요약</b><ul><li>[예시] 연봉은 불만을 줄일 뿐 힘이 나게 하진 못해요.</li><li>[예시] 다시 지쳤다면 일 · 역할 · 환경을 나눠 봐야 해요.</li><li>[예시] 다음엔 내가 힘이 나는 조건부터 적어요.</li></ul></div><p class="lead">[예시] 도입 문단이에요.</p><h2>[예시] 연봉이 막아 주는 것</h2><p>[예시] 본문</p><h2>[예시] 연봉이 막지 못하는 것</h2><p>[예시] 본문</p><h2>[예시] 다시 지치는 이유</h2><p>[예시] 본문</p><h2>[예시] 다음엔 무엇부터 볼까</h2><p>[예시] 본문</p><div class="takeaways"><div class="t">핵심 정리</div><ul><li>[예시] 하나</li><li>[예시] 둘</li><li>[예시] 셋</li></ul></div><section class="faq"><h2>자주 묻는 질문</h2><dl><dt>[예시] 연봉을 올려도 왜 지칠까요?</dt><dd>[예시] 답</dd></dl></section></article></body></html>`;

/** The demo has no GPT: one example run per kind so the comparison and the 평가표 have something to show. */
function demoView(kind: GrindKind): GrindView {
  const at = new Date().toISOString();
  const format = kind === "card" ? "list" : kind === "short" ? "script" : kind === "threads" ? "posts" : "html";
  const item = { id: "demo-i1", title: kind === "card" ? "[예시] 월요일마다 무거운 사람의 공통점" : kind === "short" ? "[예시] 연봉 올려 옮긴 회사, 석 달 만에 또 지치는 이유"
    : kind === "threads" ? "[예시] 칭찬받던 꼼꼼함이 문제가 될 때" : "[예시] 연봉 보고 옮겼는데 또 힘들다면",
    target: "3~7년 차 직장인", note: "", focus: "", source: { kind: kind === "short" ? "short" as const : kind === "threads" ? "threads" as const : "longform" as const, title: "[예시] 원본", text: "[예시] 원고", at }, at, by: "리키" };
  const draft: BenchResult["draft"] = kind === "card" ? { format: "list", caption: "[예시] 캡션", hashtags: ["직장인", "강점", "번아웃"], slides: [
    { type: "cover" as const, fields: { head: "월요일마다 무거운 사람의 공통점 3가지", sub: "쉬어도 안 풀리는 피로는 신호일 수 있어요" } },
    ...["실수가 먼저 떠올라요", "주말에도 일 생각이 나요", "내가 고른 일이 없어요"].map(title => ({ type: "item" as const, fields: { title, body: "[예시] 장면 하나와 그 뜻 한 줄" } })),
    { type: "summary" as const, fields: { line: "지친 건 양이 아니라 고를 수 없어서예요" } }, { type: "end" as const, fields: { line: "이번 주에 고를 일 하나를 적어 봐요", action: "저장해 두기" } }] }
    : kind === "column" ? { html: DEMO_COLUMN }
    : kind === "threads" ? { posts: ["[예시] 신입 때는 꼼꼼하다는 칭찬을 들었다. 그런데 팀장이 되자 같은 꼼꼼함이 「느리다」는 말로 돌아왔다.\n왜 같은 사람의 같은 장점이 평가만 바뀌었을까.",
      "[예시] 바뀐 건 장점이 아니라 그 장점에 맡겨진 일이다. 혼자 결과물을 내던 자리에서는 빠짐없이 보는 힘이 그대로 성과였지만, 여러 사람의 일을 넘겨받는 자리에서는 다 직접 확인하려는 순간 병목이 된다.",
      "[예시] 이번 주에 직접 확인한 일 중 하나를 골라, 남에게 맡겼다면 무엇이 달라졌을지 적어 보자. 꼼꼼함을 버리라는 게 아니라, 꼼꼼함을 쓸 곳을 다시 고르는 일이다."] }
    : { headCopy: "연봉 올렸는데 또 지쳤다면", insight: "[예시] 돈은 덜 싫게 할 뿐, 힘이 나게 하진 못한다", formula: "[예시] 좋은 조건, 반대 감정",
      hooks: [{ kind: "반전형", text: "연봉 올려 옮겼는데 석 달 만에 또 지쳤다면" }, { kind: "직격형", text: "일요일 밤에 채용공고 앱을 또 열고 있다면" }],
      text: "연봉 올려 옮겼는데 석 달 만에 또 지쳤다면\n분명히 연봉은 꽤 올랐는데 말이죠\n근데 연봉이 막아 주는 건 딱 하나예요\n돈이 적어서 생기는 불만, 그거 하나요\n돈은 덜 싫게 할 뿐, 힘이 나게 하진 못해요\n지금 회사에서 내 하루, 몇 점이에요?" };
  const key = resultKey(item.id, format);
  const second = { ...item, id: "demo-i2", title: "[예시] 두 번째 시험 원본" }, key2 = resultKey(second.id, format);
  const version = kind === "card" ? "v0.1" : kind === "short" ? "v0.7" : kind === "threads" ? "v5.9" : "doc v2";
  return { bench: { items: [item, second] }, canon: { id: "demo-canon", version }, me: "demo-ricky", runs: [{ id: "demo-run-1", canon: version, at, by: "demo-ricky", byName: "리키",
    model: GPT_TIERS.saving.model, formats: [format], state: "done", results: [{ key, itemId: item.id, title: item.title, format, draft }, { key: key2, itemId: second.id, title: second.title, format, draft }],
    scores: { [key]: { "demo-logan": { name: "로건", grades: { 1: "상", 2: "상", 3: "중", 4: "하", 5: "상", 6: "중" }, notes: { 3: "[예시] 근거가 한 줄뿐이에요", 4: "[예시] 끝말이 딱딱해요", 6: "[예시] 마지막 줄이 약해요" }, at } } } }] };
}

export function CanonGrindScreen({ kind }: { kind: GrindKind }) {
  const { accessToken, demo } = useSession();
  const client = useMemo(() => youtubeProcessClient(accessToken, demo), [accessToken, demo]);
  const spec = GRIND_KINDS[kind];
  const [view, setView] = useState<GrindView | null>(null);
  const [choices, setChoices] = useState<{ id: string; title: string }[]>([]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState("");
  const [pick, setPick] = useState("");
  const [topic, setTopic] = useState({ title: "", target: "" });
  const [formats, setFormats] = useState<CardFormatId[]>(["list"]);
  const [tier, setTier] = useState<GptTier>("saving");
  const [open, setOpen] = useState<{ runId: string; key: string } | null>(null);
  const { confirm, element: costDialog } = useCostConfirm();
  const load = useCallback(async () => {
    if (demo) { setView(current => current ?? demoView(kind)); return; }
    if (!accessToken) return;
    try { setView(await apiRequest<GrindView>(API(kind), { token: accessToken })); setError(""); } catch (reason) { setError(errorMessage(reason)); }
  }, [accessToken, demo, kind]);
  useEffect(() => { void load(); }, [load]);
  // What may go in: 카드뉴스 any, 숏폼 only an organic one whose 대본 is confirmed, 스레드 only a 주제 the person confirmed in their own
  // space, SEO 칼럼 a 롱폼 whose 원고 is confirmed (the server checks the same).
  useEffect(() => {
    if (kind === "threads") {
      if (demo || !accessToken) return;
      apiRequest<{ topics: ThreadsTopicRow[] }>("/api/v1/content/automation/topics?limit=200", { token: accessToken })
        .then(data => setChoices(data.topics.filter(row => row.stage === "confirmed" && row.metadata?.kind !== "threads_reference"
          && (row.metadata?.editorial_workflow === "threads_editorial_v1" || row.metadata?.editorial_workflow === "threads_reference_v1" && Boolean(row.metadata.reference_items?.length)))
          .map(row => ({ id: row.id, title: row.title }))), () => undefined);
      return;
    }
    if (client) client.list().then(rows => setChoices(rows.filter(row => kind === "card" ? row.yp.topic.type === "card"
      : kind === "column" ? row.yp.topic.type !== "short" && row.yp.topic.type !== "card" && SCRIPT_CONFIRMED.includes(row.yp.stage)
      : row.yp.topic.type === "short" && row.yp.topic.purpose !== "ad" && ["make", "review", "upload", "done"].includes(row.yp.stage)).map(row => ({ id: row.id, title: projectName(row) }))), () => undefined);
  }, [client, kind, demo, accessToken]);
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
      setView(await apiRequest<GrindView>(API(kind), { token: accessToken, method: "POST", body: JSON.stringify(body) }));
      return true;
    } catch (reason) { setError(errorMessage(reason)); return false; } finally { setBusy(""); }
  };
  const runDraw = async () => {
    if (!view) return;
    const model = GPT_TIERS[tier].model, items = view.bench.items.length, size = ESTIMATE[kind](formats.length);
    const each = tokenEstimate(model, size.input, size.output);
    if (!(await confirm({ model, amount: each === null ? null : each * items * 2, upTo: true,
      detail: `시험 원본 ${items}개${kind === "card" ? ` × 포맷 ${formats.length}개` : ""} · 형식이 틀리면 한 번 더 물어요`, ok: "다시 뽑기" }))) return;
    await act("run", { action: "run", formats: kind === "card" ? formats : [], tier });
  };

  if (!view) return <>{error ? <div className="yp-note yp-warn" role="alert"><div>{error}</div></div> : <p className="yp-hint" role="status">불러오는 중이에요…</p>}</>;
  const runs = [...view.runs].sort((a, b) => a.at.localeCompare(b.at)).slice(-3);
  const latest = [...view.runs].filter(run => run.state === "done").sort((a, b) => b.at.localeCompare(a.at))[0];
  const keys = [...new Set(runs.flatMap(run => run.results.map(result => result.key)))];
  const result = (run: BenchRun, key: string) => run.results.find(row => row.key === key);
  const openRun = open && view.runs.find(run => run.id === open.runId);
  const openResult = openRun && open ? result(openRun, open.key) : undefined;
  const order = openRun ? openRun.results.filter(row => row.draft).map(row => row.key) : [];
  const at = open ? order.indexOf(open.key) : -1;
  const go = (key?: string) => setOpen(key && openRun ? { runId: openRun.id, key } : null);
  const inBench = new Set(view.bench.items.map(item => item.from?.projectId).filter(Boolean));
  const fixes = latest ? fixList(latest, kind) : [];

  return <>
    {costDialog}
    {error ? <div className="yp-note yp-warn" role="alert"><div>{error}</div></div> : null}
    <section className="yp-card yp-grind-canon"><div className="yp-card-b">
      <b>지금 정본: {spec.canonTitle} {view.canon?.version ?? "없음"}</b>
      {view.canon && !demo ? <Link className="yp-lnk" href={`/knowledge?document=${view.canon.id}`}>정본 열기 →</Link> : null}
      <span className={graduatedTwice(view.runs, kind) ? "yp-tag yp-ok" : "yp-tag"}>{graduatedTwice(view.runs, kind) ? "졸업 기준 충족 · 다음 정본 승인 요청" : `졸업: 두 번 연속 초안 ${GRADUATION.passRate * 100}% 이상이 모든 기준 ‘중’ 이상 · ‘상’ ${GRADUATION.tops}개 이상 · 자동 검사 지적 0`}</span>
    </div></section>

    <YpSection n={1} title="시험 묶음" gq={`${view.bench.items.length}/${BENCH_MAX} · 정본이 바뀌어도 늘 같은 원본으로 뽑아요`}>
      {view.bench.items.length ? <ul className="yp-hist">{view.bench.items.map(item => <li key={item.id} style={{ alignItems: "center", gap: 10 }}>
        <span className="yp-tag">{SOURCE[item.source.kind]}</span><span style={{ flex: 1, minWidth: 0 }}><b>{item.title}</b>{item.focus ? <small className="yp-muted"> · {item.focus}</small> : null}</span>
        <button type="button" className="yp-btn yp-sm" disabled={Boolean(busy)} onClick={() => void act("remove", { action: "remove", itemId: item.id })}>빼기</button></li>)}</ul>
        : <p className="yp-pempty">{PICK[kind].empty}</p>}
      <div className="yp-row-btns" style={{ marginTop: 10, flexWrap: "wrap" }}>
        <select className="yp-in" value={pick} onChange={event => setPick(event.target.value)} aria-label={`넣을 ${spec.label}`} style={{ flex: 1, minWidth: 220 }}>
          <option value="">{PICK[kind].choose}</option>
          {choices.filter(row => !inBench.has(row.id)).map(row => <option key={row.id} value={row.id}>{row.title}</option>)}</select>
        <button type="button" className="yp-btn" disabled={!pick || Boolean(busy) || view.bench.items.length >= BENCH_MAX}
          onClick={() => { if (kind !== "threads" || window.confirm("이 주제의 재료(브리프 · 참고 글 · 질문 · 장면 · 출처)가 팀에 보여요. 넣을까요?")) void act("add", { action: "add", projectId: pick }).then(ok => { if (ok) setPick(""); }); }}>넣기</button></div>
      {kind === "card" ? <div className="yp-row-btns" style={{ marginTop: 8, flexWrap: "wrap" }}>
        <input className="yp-in" style={{ flex: 2, minWidth: 200 }} value={topic.title} maxLength={200} onChange={event => setTopic({ ...topic, title: event.target.value })} placeholder="주제만 넣기 · 한 줄 주제" aria-label="주제만 넣기 · 한 줄 주제" />
        <input className="yp-in" style={{ flex: 1, minWidth: 160 }} value={topic.target} maxLength={300} onChange={event => setTopic({ ...topic, target: event.target.value })} placeholder="누구에게" aria-label="주제만 넣기 · 누구에게" />
        <button type="button" className="yp-btn" disabled={topic.title.trim().length < 2 || !topic.target.trim() || Boolean(busy) || view.bench.items.length >= BENCH_MAX}
          onClick={() => void act("topic", { action: "addTopic", title: topic.title.trim(), target: topic.target.trim(), note: "" }).then(ok => { if (ok) setTopic({ title: "", target: "" }); })}>넣기</button></div> : null}
    </YpSection>

    <YpSection n={2} title="이 정본으로 다시 뽑기" gq={`회사 GPT가 시험 원본을 모두 지금 정본으로 다시 써요 · 3~6분${kind === "short" ? " · 넣을 때의 주제 · 공식 · 참고 영상 그대로" : kind === "threads" ? " · 넣을 때의 재료 그대로" : kind === "column" ? " · 넣을 때의 원고 그대로" : ""}`}>
      <div className="yp-row-btns" style={{ flexWrap: "wrap", gap: 12 }}>
        {kind === "card" ? CARD_FORMAT_IDS.map(id => <label key={id} className="yp-chk"><input type="checkbox" checked={formats.includes(id)} disabled={!formats.includes(id) && formats.length >= 3}
          onChange={() => setFormats(formats.includes(id) ? formats.filter(row => row !== id) : [...formats, id])} /> {CARD_FORMATS[id].name}</label>) : null}
        <span className="yp-sp" />
        {(["saving", "precise"] as const).map(key => <label key={key} className="yp-chk"><input type="radio" name="grind-tier" checked={tier === key} onChange={() => setTier(key)} /> {GPT_TIERS[key].label}{key === "saving" ? " (권장)" : ""}</label>)}</div>
      <div className="yp-row-btns" style={{ marginTop: 10 }}>
        <button type="button" className="yp-btn yp-pri" disabled={(kind === "card" && !formats.length) || !view.bench.items.length || Boolean(busy) || running} onClick={() => void runDraw()}>{running ? "다시 뽑는 중…" : "이 정본으로 다시 뽑기"}</button><CostTag kind="paid" /></div>
      {running ? <p className="yp-hint" role="status">GPT가 쓰고 있어요. 끝나면 아래 비교에 새 칸이 생겨요.</p> : null}
    </YpSection>

    <YpSection n={3} title="정본 버전끼리 비교" gq="최근 3번 · 칸을 눌러 평가표로 채점해요">
      {runs.length ? <div className="yp-grind-table" style={{ gridTemplateColumns: `minmax(140px, 200px) repeat(${runs.length}, minmax(260px, 1fr))` }}>
        <div />
        {runs.map(run => { const sum = runSummary(run, kind);
          return <div key={run.id} className="yp-grind-head"><b>정본 {run.canon}</b><small>{day(run.at)} · {run.byName} · {run.model.startsWith("gpt-6-astra") ? "정밀" : "절약"}</small>
            {run.state === "running" ? <span className="yp-tag yp-warn">뽑는 중</span> : run.state === "failed" ? <span className="yp-tag yp-bad">못 뽑음 · {run.error}</span>
              : <small>채점 {sum.scored}/{sum.drafts} · 통과 {sum.passed} ({Math.round(sum.passRate * 100)}%) · 자동 검사 {sum.findings}{sum.failed ? ` · 실패 ${sum.failed}` : ""}{sum.graduated ? " · 졸업 기준 ✓" : ""}</small>}</div>; })}
        {keys.map(key => { const format = key.split(":")[1]; const title = runs.map(run => result(run, key)?.title).find(Boolean) ?? key;
          return [<div key={`${key}-h`} className="yp-grind-row-h"><b>{title}</b><small>{formatName(format)}</small></div>,
            ...runs.map(run => <GrindCell key={`${key}-${run.id}`} kind={kind} run={run} result={result(run, key)} me={view.me} active={open?.runId === run.id && open.key === key} onOpen={() => setOpen({ runId: run.id, key })} />)]; })}
      </div> : <p className="yp-pempty">아직 다시 뽑은 적이 없어요.</p>}
    </YpSection>

    {openRun && openResult?.draft ? <ScorePanel kind={kind} run={openRun} result={openResult} me={view.me} busy={busy === "score"} error={error}
      place={`${at + 1} / ${order.length}`} prev={order[at - 1]} next={order[at + 1]} onGo={go}
      onSave={(grades, notes) => void act("score", { action: "score", runId: openRun.id, key: openResult.key, grades, notes }).then(ok => { if (ok) go(order[at + 1]); })} /> : null}

    <YpSection n={4} title="고칠 점" gq={latest ? `정본 ${latest.canon} · ${day(latest.at)} 결과에서` : "채점한 결과가 생기면 보여요"}>
      {fixes.length ? <ul className="yp-grind-fix">{fixes.map(row => <li key={row.n}>
        <div><b>{row.n}. {row.name}</b> <span className={row.canonIssue ? "yp-tag yp-bad" : "yp-tag"}>{row.canonIssue ? `초안 ${row.drafts}개에서 · 정본 문제` : "초안 1개에서 · 그 초안 문제"}</span></div>
        <ul>{row.notes.map((note, at) => <li key={at}><span className={note.grade === "하" ? "yp-bad" : "yp-warn"}>{note.grade}</span> {note.title} · {formatName(note.format)} — {note.note || "이유 없음"} <small className="yp-muted">({note.by})</small></li>)}</ul></li>)}</ul>
        : <p className="yp-pempty">아직 지적이 없어요.</p>}
      <ol className="yp-grind-how">
        <li>‘정본 문제’로 표시된 지적만 골라, 정본에 넣을 문장(지금 문장 → 새 문장)을 정해요.</li>
        {spec.steward ? <li>{spec.steward}가 OS의 {spec.canonTitle}에 {view.canon && !demo ? <Link className="yp-lnk" href={`/knowledge/canon/${view.canon.id}/propose`}>변경 제안</Link> : "변경 제안"}을 보내요. 맨 위 버전 줄을 올리고, 변경 이력에 이유를 적어요.</li>
          : <li>대표 승인을 받은 뒤 OS의 {spec.canonTitle}을 고치고, 맨 위 버전 줄을 올리고, 변경 이력에 이유를 적어요.</li>}
        <li>여기서 같은 시험 묶음을 다시 뽑아 채점해요. 점수가 떨어지면 OS 문서의 이전 버전으로 되돌려요.</li></ol>
    </YpSection>
  </>;
}

function GrindCell({ kind, run, result, me, active, onOpen }: { kind: GrindKind; run: BenchRun; result?: BenchResult; me: string; active: boolean; onOpen: () => void }) {
  if (run.state === "running") return <div className="yp-grind-cell yp-muted">뽑는 중…</div>;
  if (!result) return <div className="yp-grind-cell yp-muted">이 정본에서는 안 뽑았어요</div>;
  if (!result.draft) return <div className="yp-grind-cell"><span className="yp-tag yp-bad">못 뽑음</span><small>{result.error}</small></div>;
  const merged = mergedGrades(run.scores[result.key]);
  const findings = GRIND_KINDS[kind].findings(result.draft);
  return <button type="button" className={`yp-grind-cell${active ? " yp-on" : ""}`} onClick={onOpen} aria-label={`${result.title} · 정본 ${run.canon} 채점`}>
    {kind === "card" ? <span className="yp-card-strip">{(result.draft as CardDraftPart).slides.slice(0, 3).map((_, index) =>
      <CardPreview key={index} draft={{ ...(result.draft as CardDraftPart), id: result.key, at: run.at, by: run.byName }} index={index} width={84} />)}</span>
      : kind === "short" ? <span className="yp-grind-script"><b>{(result.draft as ShortDraft).headCopy}</b>{scriptLines(result.draft as ShortDraft).slice(0, 3).map((line, at) => <span key={at}>{line}</span>)}</span>
      : kind === "threads" ? <span className="yp-grind-script"><span className="yp-grind-post">{(result.draft as ThreadsDraft).posts[0]}</span><small className="yp-muted">글 {(result.draft as ThreadsDraft).posts.length}개</small></span>
      : <span className="yp-grind-script"><b>{columnMeta((result.draft as ColumnDraft).html).title}</b><span className="yp-grind-post">{columnMeta((result.draft as ColumnDraft).html).description}</span></span>}
    <small>{findings ? `자동 검사 ${findings}` : "자동 검사 통과"} · {merged ? `채점 ${tally(merged)}` : "채점 전"}{run.scores[result.key]?.[me] ? " · 내 채점 ✓" : ""}</small>
  </button>;
}

interface PanelProps { kind: GrindKind; run: BenchRun; result: BenchResult; me: string; busy: boolean; error: string; place: string; prev?: string; next?: string;
  onGo: (key?: string) => void; onSave: (grades: Record<string, CardGrade>, notes: Record<string, string>) => void }
/** The 평가표 over the page: the draft on the left, the six criteria on the right, and 이전 · 다음 so a run is scored without scrolling back up. */
function ScorePanel(props: PanelProps) {
  const dialog = useRef<HTMLDialogElement>(null);
  const dirty = useRef(false);
  useEffect(() => { dialog.current?.showModal(); }, []);
  const leave = (key?: string) => { if (!dirty.current || window.confirm("채점을 저장하지 않았어요. 그래도 넘어갈까요?")) props.onGo(key); };
  return <dialog ref={dialog} className="yp-modal yp-grind-dlg" aria-label="평가표" onCancel={event => { event.preventDefault(); leave(); }}>
    <ScoreBody key={`${props.run.id}:${props.result.key}`} {...props} dirty={dirty} leave={leave} />
  </dialog>;
}

function ScoreBody({ kind, run, result, me, busy, error, place, prev, next, onSave, dirty, leave }: PanelProps & { dirty: MutableRefObject<boolean>; leave: (key?: string) => void }) {
  const mine = run.scores[result.key]?.[me];
  const [grades, setGrades] = useState<Partial<Record<CardCriterion, CardGrade>>>(mine?.grades ?? {});
  const [notes, setNotes] = useState<Partial<Record<CardCriterion, string>>>(mine?.notes ?? {});
  dirty.current = JSON.stringify(grades) !== JSON.stringify(mine?.grades ?? {}) || JSON.stringify(notes) !== JSON.stringify(mine?.notes ?? {});
  const criteria = GRIND_KINDS[kind].criteria;
  const others = Object.entries(run.scores[result.key] ?? {}).filter(([id]) => id !== me);
  const done = criteria.every(c => grades[c.n]);
  const unit = kind === "card" ? "카드뉴스" : kind === "short" ? "대본" : kind === "threads" ? "글타래" : "칼럼";
  return <>
    <div className="yp-modal-h"><span className="yp-grind-dlg-t">{result.title} · {formatName(result.format)} · 정본 {run.canon}</span><span className="yp-sp" />
      <small className="yp-muted">{place}</small>
      <button type="button" className="yp-btn yp-sm" disabled={!prev} onClick={() => leave(prev)}>이전 {unit}</button>
      <button type="button" className="yp-btn yp-sm" disabled={!next} onClick={() => leave(next)}>다음 {unit}</button>
      <button type="button" className="yp-btn yp-sm" onClick={() => leave()}>닫기</button></div>
    <div className="yp-grind-dlg-b">
      <div className={`yp-grind-dlg-draft${kind === "column" ? " yp-grind-dlg-col" : ""}`}>{kind === "card" ? <>
        <div className="yp-grind-slides">{(result.draft as CardDraftPart).slides.map((_, index) => <CardPreview key={index} draft={{ ...(result.draft as CardDraftPart), id: result.key, at: run.at, by: run.byName }} index={index} width={170} />)}</div>
        {(result.draft as CardDraftPart).caption ? <p className="yp-card-caption" style={{ marginTop: 10 }}>{(result.draft as CardDraftPart).caption}</p> : null}
      </> : kind === "short" ? <ShortDraftView draft={result.draft as ShortDraft} /> : kind === "threads" ? <ThreadsDraftView draft={result.draft as ThreadsDraft} />
        : <ColumnDraftView draft={result.draft as ColumnDraft} title={result.title} />}</div>
      <div className="yp-grind-dlg-form">
        <div className="yp-grind-form">{criteria.map(c => <div key={c.n} className="yp-grind-crit">
          <div><b>{c.n}. {c.name}</b><small className="yp-muted">상: {c.top}</small></div>
          <div role="radiogroup" aria-label={c.name} className="yp-row-btns">{CARD_GRADES.map(grade => <button key={grade} type="button" role="radio" aria-checked={grades[c.n] === grade}
            className={`yp-btn yp-sm${grades[c.n] === grade ? " yp-pri" : ""}`} onClick={() => setGrades(current => ({ ...current, [c.n]: grade }))}>{grade}</button>)}</div>
          <input className="yp-in" value={notes[c.n] ?? ""} maxLength={300} onChange={event => { const text = event.target.value; setNotes(current => ({ ...current, [c.n]: text })); }}
            placeholder={grades[c.n] && grades[c.n] !== "상" ? "이유 한 줄 (필수)" : "이유 한 줄"} aria-label={`${c.name} 이유`} /></div>)}</div>
        {others.length ? <p className="yp-hint">다른 사람 채점: {others.map(([, score]) => `${score.name} (${tally(score.grades)})`).join(" · ")}</p> : null}
        {error ? <div className="yp-note yp-warn" role="alert"><div>{error}</div></div> : null}
      </div>
    </div>
    <div className="yp-modal-f">
      {!done ? <small className="yp-muted" style={{ marginRight: "auto" }}>여섯 기준을 모두 골라요. ‘중’ · ‘하’는 이유를 한 줄 써요.</small> : null}
      <button type="button" className="yp-btn yp-pri" disabled={busy || !done || criteria.some(c => grades[c.n] && grades[c.n] !== "상" && !notes[c.n]?.trim())}
        onClick={() => onSave(Object.fromEntries(Object.entries(grades)) as Record<string, CardGrade>, Object.fromEntries(Object.entries(notes).filter(([, note]) => note?.trim())) as Record<string, string>)}>
        {busy ? "저장하는 중…" : next ? `저장하고 다음 ${unit}` : "채점 저장"}</button></div>
  </>;
}

/** A 숏폼 대본 as the 대본 step shows it: 헤드 카피, the two first lines, the insight and the script (one line = one screen). */
function ShortDraftView({ draft }: { draft: ShortDraft }) {
  const lines = scriptLines(draft);
  return <div className="yp-grind-short">
    <dl className="yp-kv"><dt>헤드 카피</dt><dd><b>{draft.headCopy}</b></dd>
      <dt>첫 문장 두 안</dt><dd>{draft.hooks.map(hook => <div key={hook.kind}>{hook.kind} · {hook.text}</div>)}</dd>
      <dt>핵심 한 줄</dt><dd>{draft.insight}</dd><dt>쓴 공식</dt><dd>{draft.formula}</dd>
      <dt>대본</dt><dd>{lines.length}줄 · {checkShortScript(draft.text).chars}자</dd></dl>
    <ol className="yp-grind-lines">{lines.map((line, at) => <li key={at}>{line}</li>)}</ol>
  </div>;
}

/** A 스레드 글타래 as it would be posted: each post with its place in the chain and its length. */
function ThreadsDraftView({ draft }: { draft: ThreadsDraft }) {
  return <ol className="yp-grind-posts">{draft.posts.map((post, at) => <li key={at}>
    <small className="yp-muted">{threadsPostRole(draft.posts, at)} · {threadsPostLength(post)}자</small><p>{post}</p></li>)}</ol>;
}

/** An SEO 칼럼 as the 쇼츠 · 칼럼 step previews it (images not filled yet), with what the page hides: its search fields and image prompts. */
function ColumnDraftView({ draft, title }: { draft: ColumnDraft; title: string }) {
  const meta = columnMeta(draft.html), preview = useMemo(() => renderColumn(draft.html), [draft.html]);
  return <>
    <details className="yp-grind-col-meta"><summary>검색 정보 · 이미지 프롬프트</summary>
      <dl className="yp-kv"><dt>제목</dt><dd>{meta.title}</dd><dt>설명</dt><dd>{meta.description} <small className="yp-muted">({meta.description.length}자)</small></dd>
        <dt>키워드</dt><dd>{meta.keywords.join(" · ")}</dd><dt>slug</dt><dd>{meta.slug}</dd>
        {columnSlots(draft.html).filter(slot => slot.kind !== "video").map(slot => [<dt key={`${slot.slot}-t`}>{slot.slot === "hero" ? "대표 이미지" : `이미지 ${slot.slot}`}</dt>,
          <dd key={`${slot.slot}-d`}>{slot.caption}<br /><small className="yp-muted">{slot.prompt}</small></dd>])}</dl></details>
    <iframe className="yp-grind-col" title={`${title} 칼럼 미리보기`} sandbox="allow-scripts allow-popups" srcDoc={preview} />
  </>;
}

interface ScriptView { verdicts: ScriptVerdict[]; canon: { id: string; version: string } | null; me: string }
const DEMO_VERDICT = (projectId: string, title: string, at: string, bundle: string, failed: (2 | 3 | 4 | 5 | 6)[]): ScriptVerdict => ({ projectId, title, at, by: "[예시] 유쓰", bundle,
  pass: !failed.length, gates: ([2, 3, 4, 5, 6] as const).map(gate => ({ gate, pass: !failed.includes(gate),
    items: failed.includes(gate) ? [{ paragraph: gate * 3, quote: "[예시] 문장", grade: "상" as const, reason: `[예시] 관문 ${gate}에서 비었던 것`, fix: "" }] : [] })) });
const DEMO_SCRIPT: ScriptView = { canon: { id: "demo", version: "v2.5" }, me: "demo", verdicts: [
  DEMO_VERDICT("demo-1", "[예시] 연봉 보고 옮겼는데 또 힘들다면", "2026-10-30T09:23:00Z", "v2.5", [4, 5]),
  DEMO_VERDICT("demo-2", "[예시] 해야 하는 걸 알면서도 실행을 못 하는 이유", "2026-10-30T04:58:00Z", "v2.5", [2, 5, 6]),
  DEMO_VERDICT("demo-3", "[예시] 내가 진짜 원하는 것을 알아내는 방법", "2026-10-27T05:00:00Z", "v2.4", []),
] };

/** 롱폼 원고 정본 다듬기 (설계서 §9): nothing is drawn again — each 원고's 두 번째 검수 is its score, compared 정본 묶음 by 정본 묶음. */
export function ScriptCanonScreen() {
  const { accessToken, demo } = useSession();
  const [view, setView] = useState<ScriptView | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    if (demo) { setView(DEMO_SCRIPT); return; }
    if (!accessToken) return;
    apiRequest<ScriptView>("/api/v1/content/youtube/canon-grind?kind=script", { token: accessToken }).then(setView, reason => setError(errorMessage(reason)));
  }, [accessToken, demo]);
  if (!view) return <>{error ? <div className="yp-note yp-warn" role="alert"><div>{error}</div></div> : <p className="yp-hint" role="status">불러오는 중이에요…</p>}</>;
  const bundles = scriptBundles(view.verdicts);
  const latest = bundles[0];
  const fixes = latest ? scriptFixes(latest.scripts) : [];
  const graduated = scriptGraduated(bundles);
  return <>
    <section className="yp-card yp-grind-canon"><div className="yp-card-b">
      <b>지금 정본: 원고 공정 정본 {view.canon?.version ?? "없음"}</b>
      {view.canon && !demo ? <Link className="yp-lnk" href={`/knowledge?document=${view.canon.id}`}>정본 열기 →</Link> : null}
      <span className={graduated ? "yp-tag yp-ok" : "yp-tag"}>{graduated ? "졸업 기준 충족 · 다음 정본 승인 요청" : `졸업: 두 정본 묶음 연속, 원고 ${GRADUATION.passRate * 100}% 이상이 관문 2~6을 모두 통과`}</span>
    </div></section>

    <YpSection n={1} title="정본 묶음끼리 비교" gq="원고마다 받은 두 번째 검수(관문 2~6)를 모아요 · 다시 뽑지 않아 비용이 들지 않아요">
      {bundles.length ? bundles.map(row => <div key={row.bundle} className="yp-grind-bundle">
        <div className="yp-grind-head"><b>정본 묶음 {row.bundle}</b><small>원고 {row.scripts.length} · 통과 {row.passed} ({Math.round(row.passRate * 100)}%)</small></div>
        <div className="yp-chips">{row.gates.map(gate => <span key={gate.gate} className={gate.failed ? "yp-tag yp-bad" : "yp-tag yp-ok"}>관문 {gate.gate} {gate.name} {row.scripts.length - gate.failed}/{row.scripts.length}</span>)}</div>
        <ul className="yp-hist">{row.scripts.map(script => { const back = script.gates.filter(gate => !gate.pass).map(gate => gate.gate);
          return <li key={script.projectId}><span className="yp-grow"><Link className="yp-lnk" href={stepHref(2, script.projectId)}><b>{script.title}</b></Link> <small className="yp-muted">{day(script.at)}{script.by ? ` · ${script.by}` : ""}</small></span>
            <span className={script.pass ? "yp-tag yp-ok" : "yp-tag yp-bad"}>{script.pass ? "통과" : `반려 · 관문 ${back.join("·")}`}</span></li>; })}</ul>
      </div>) : <p className="yp-pempty">아직 두 번째 검수를 받은 원고가 없어요. 롱폼 구성안 단계에서 두 번째 검수를 받으면 여기에 모여요.</p>}
    </YpSection>

    <YpSection n={2} title="고칠 점" gq={latest ? `정본 묶음 ${latest.bundle} 원고에서` : "판정이 생기면 보여요"}>
      {fixes.length ? <ul className="yp-grind-fix">{fixes.map(row => <li key={row.gate}>
        <div><b>관문 {row.gate}. {row.name}</b> <span className={row.canonIssue ? "yp-tag yp-bad" : "yp-tag"}>{row.canonIssue ? `원고 ${row.scripts}편에서 반려 · 정본 문제` : "원고 1편에서 반려 · 그 원고 문제"}</span></div>
        <ul>{row.notes.map((note, at) => <li key={at}><span className={note.grade === "상" ? "yp-bad" : "yp-warn"}>{note.grade}</span> {note.title} · {note.paragraph}번 문단 — {note.reason}</li>)}</ul></li>)}</ul>
        : <p className="yp-pempty">아직 지적이 없어요.</p>}
      <ol className="yp-grind-how">
        <li>‘정본 문제’로 표시된 관문만 골라, 원고 정본(공정 · 구조 · 말투 · 검수)에 넣을 문장(지금 문장 → 새 문장)을 정해요.</li>
        <li>대표 승인을 받은 뒤 OS의 원고 정본을 고치고, 원고 공정 정본 맨 위 「정본 묶음」 줄을 올리고, 변경 이력에 이유를 적어요.</li>
        <li>다음 원고들이 새 묶음으로 쌓이면 여기서 이전 묶음과 통과율을 비교해요. 떨어지면 OS 문서의 이전 버전으로 되돌려요.</li></ol>
    </YpSection>
  </>;
}
