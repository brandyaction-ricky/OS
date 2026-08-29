"use client";

import { ArrowRight, CalendarDays, CheckCircle2, CircleAlert, Film, Instagram, Layers3, Plus, Send, Sparkles, X, Youtube } from "lucide-react";
import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { createRecord, generateContent, listRecords, updateRecord } from "@/lib/api-client";
import type { OsRecord } from "@/lib/record-types";
import { useSession } from "./session-provider";

type AutomationView = "pipeline" | "review";

interface OutputTemplate { format: string; platform: string; count: number; days: number[]; hour: number; }

const OUTPUT_TEMPLATES: OutputTemplate[] = [
  { format: "유튜브 쇼츠", platform: "youtube", count: 3, days: [1, 1, 1], hour: 18 },
  { format: "인스타 카드뉴스", platform: "instagram", count: 1, days: [2], hour: 19 },
  { format: "스레드 단문", platform: "threads", count: 3, days: [1, 3, 5], hour: 12 },
  { format: "짧은 포스트", platform: "threads", count: 2, days: [2, 4], hour: 12 },
  { format: "연속 스레드", platform: "threads", count: 1, days: [6], hour: 20 },
];

const STATUS_LABEL: Record<string, string> = { draft: "초안", review: "검수", ready: "발행 준비", scheduled: "예약", published: "발행", blocked: "막힘", active: "제작 중", done: "완료" };

function meta(record: OsRecord, key: string) {
  const value = record.metadata?.[key];
  return typeof value === "string" ? value : "";
}

function platformIcon(platform: string) {
  if (platform === "youtube") return <Youtube size={15} />;
  if (platform === "instagram") return <Instagram size={15} />;
  return <Send size={15} />;
}

export function ContentAutomationWorkspace({ initialView = "pipeline" }: { initialView?: AutomationView }) {
  const { accessToken, demo, profile } = useSession();
  const [sources, setSources] = useState<OsRecord[]>([]);
  const [outputs, setOutputs] = useState<OsRecord[]>([]);
  const [view, setView] = useState<AutomationView>(initialView);
  const [selectedId, setSelectedId] = useState("");
  const [sourceOpen, setSourceOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    if (demo) return;
    try {
      const [topics, publishes] = await Promise.all([listRecords(accessToken, "content_topic", "limit=200"), listRecords(accessToken, "content_publish", "limit=200")]);
      const automationSources = topics.records;
      setSources(automationSources); setOutputs(publishes.records.filter((record) => record.metadata?.automationOutput === true));
      setSelectedId((current) => current || automationSources[0]?.id || ""); setError("");
    } catch (reason) { setError(reason instanceof Error ? reason.message : "콘텐츠 자동화 항목을 불러오지 못했습니다."); }
  }, [accessToken, demo]);

  useEffect(() => { load(); }, [load]);
  const selected = sources.find((source) => source.id === selectedId) ?? sources[0] ?? null;
  const selectedOutputs = outputs.filter((output) => output.parent_id === selected?.id);
  const draftCount = outputs.filter((output) => ["draft", "review"].includes(output.status)).length;
  const scheduledCount = outputs.filter((output) => output.status === "scheduled").length;
  const publishedCount = outputs.filter((output) => output.status === "published").length;

  const submitSource = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const value = (name: string) => String(form.get(name) ?? "").trim();
    setBusy(true); setError("");
    try {
      const { record } = await createRecord(accessToken, {
        recordType: "content_topic", title: value("title"), description: value("transcript"), status: "active", priority: "high",
        brand: value("brand"), team: value("team"), sourceUrl: value("sourceUrl") || null,
        metadata: { automationSource: true, publishDate: value("publishDate"), audience: value("audience"), coreMessage: value("coreMessage") },
        tags: ["롱폼", "멀티채널"],
      });
      setSourceOpen(false); await load(); setSelectedId(record.id);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "원본 콘텐츠를 저장하지 못했습니다."); }
    finally { setBusy(false); }
  };

  const generateOutputs = async (source: OsRecord) => {
    if (outputs.some((output) => output.parent_id === source.id)) { setError("이미 파생 콘텐츠가 생성된 원본입니다. 기존 묶음을 검수해 주세요."); return; }
    setBusy(true); setError("");
    try {
      const result = await generateContent(accessToken, { action: "derivatives", sourceId: source.id, platforms: ["shorts", "threads", "column", "instagram", "essay"] });
      if (result.queued) setError("Claude 연결 대기 작업으로 저장했습니다. 설정 > 연결에서 키를 등록하면 실행할 수 있습니다.");
      await load();
    } catch (reason) { setError(reason instanceof Error ? reason.message : "파생 콘텐츠를 생성하지 못했습니다."); }
    finally { setBusy(false); }
  };

  const setOutputStatus = async (output: OsRecord, status: string) => {
    try { await updateRecord(accessToken, { id: output.id, expectedVersion: output.version, status }); await load(); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "콘텐츠 상태를 변경하지 못했습니다."); }
  };

  const groupedReview = useMemo(() => sources.map((source) => ({ source, items: outputs.filter((output) => output.parent_id === source.id && ["draft", "review", "ready", "blocked"].includes(output.status)) })).filter((group) => group.items.length), [outputs, sources]);

  return <>
    <header className="page-header"><div className="page-title-group"><span className="eyebrow">MULTICHANNEL AUTOMATION</span><h1>{view === "review" ? "콘텐츠 묶음 검수" : "멀티채널 자동화"}</h1><p>최종 롱폼 1개를 쇼츠·카드뉴스·스레드 묶음으로 전환하고 검수·예약합니다.</p></div><div className="header-actions"><button className="secondary-button" onClick={() => setView(view === "pipeline" ? "review" : "pipeline")}><CheckCircle2 size={16} /> {view === "pipeline" ? `검수함 ${draftCount}` : "자동화 현황"}</button><button className="primary-button" onClick={() => setSourceOpen(true)}><Plus size={16} /> 롱폼 등록</button></div></header>
    {error ? <div className="inline-alert danger"><CircleAlert size={16} /> {error}</div> : null}
    <section className="metric-grid compact-metrics"><div className="metric-card"><div className="metric-top"><span>원본 롱폼</span><span className="metric-icon"><Film size={16} /></span></div><div className="metric-value">{sources.length}</div><div className="metric-caption">자동화 시작점</div></div><div className="metric-card"><div className="metric-top"><span>검수 대기</span><span className="metric-icon"><Sparkles size={16} /></span></div><div className="metric-value">{draftCount}</div><div className="metric-caption warn">사람 판단 필요</div></div><div className="metric-card"><div className="metric-top"><span>예약 발행</span><span className="metric-icon"><CalendarDays size={16} /></span></div><div className="metric-value">{scheduledCount}</div><div className="metric-caption">채널별 일정</div></div><div className="metric-card"><div className="metric-top"><span>발행 완료</span><span className="metric-icon"><CheckCircle2 size={16} /></span></div><div className="metric-value">{publishedCount}</div><div className="metric-caption good">성과 측정 가능</div></div></section>
      {view === "pipeline" ? <section className="automation-layout"><aside className="panel source-list"><div className="panel-header"><div><h2>원본 콘텐츠</h2><p>최종 롱폼 기준</p></div></div>{sources.map((source) => <button className={selected?.id === source.id ? "active" : ""} key={source.id} onClick={() => setSelectedId(source.id)}><span className="platform-icon youtube">{platformIcon("youtube")}</span><span><strong>{source.title}</strong><small>{source.brand || "공통"} · 파생 {outputs.filter((item) => item.parent_id === source.id).length}개</small></span><ArrowRight size={14} /></button>)}{!sources.length ? <div className="list-empty"><Film size={20} /><span>최종 롱폼을 등록하세요.</span></div> : null}</aside><div className="panel automation-detail">{selected ? <><header><div><span className="status-pill status-active">원본 롱폼</span><h2>{selected.title}</h2><p>{meta(selected, "coreMessage") || "핵심 메시지를 입력하세요."}</p></div><button className="primary-button" disabled={busy || selectedOutputs.length > 0} onClick={() => generateOutputs(selected)}><Sparkles size={15} /> {selectedOutputs.length ? "파생물 생성 완료" : "정본으로 파생물 생성"}</button></header><div className="output-plan">{OUTPUT_TEMPLATES.map((template) => <div key={template.format}><span className={`platform-icon ${template.platform}`}>{platformIcon(template.platform)}</span><span><strong>{template.format}</strong><small>{template.count}개 · {template.days.map((day) => `D+${day}`).join(", ")}</small></span><em>{selectedOutputs.filter((item) => meta(item, "format") === template.format).length}/{template.count}</em></div>)}</div>{selectedOutputs.length ? <div className="output-list">{selectedOutputs.map((output) => <div key={output.id}><span className={`platform-icon ${meta(output, "platform")}`}>{platformIcon(meta(output, "platform"))}</span><span><strong>{output.title}</strong><small>{output.starts_at ? new Intl.DateTimeFormat("ko-KR", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }).format(new Date(output.starts_at)) : "일정 미정"}</small></span><span className={`status-pill status-${output.status}`}>{STATUS_LABEL[output.status] ?? output.status}</span></div>)}</div> : <div className="automation-guide"><Layers3 size={28} /><h3>정본 실행 대기</h3><p>채널별 회사 절차를 실행 시점에 읽고 생성한 뒤, 자가검수 결과와 함께 사람 검토 단계에 올립니다.</p></div>}</> : <div className="empty-state"><div><span><Youtube /></span><h3>원본 롱폼을 선택하세요.</h3></div></div>}</div></section> : <section className="review-bundles">{groupedReview.map(({ source, items }) => <article className="panel review-bundle" key={source.id}><header><div><span className="platform-icon youtube"><Youtube size={15} /></span><span><strong>{source.title}</strong><small>{source.brand || "공통"} · 확인 {items.length}개</small></span></div><button className="secondary-button compact" disabled={busy} onClick={async () => { setBusy(true); for (const item of items.filter((entry) => ["draft", "review"].includes(entry.status))) await setOutputStatus(item, item.status === "draft" ? "review" : "ready"); setBusy(false); }}><CheckCircle2 size={14} /> 검토 항목 일괄 완료</button></header><div>{items.map((output) => <div className="review-output" key={output.id}><span className={`platform-icon ${meta(output, "platform")}`}>{platformIcon(meta(output, "platform"))}</span><span><strong>{output.title}</strong><small>{meta(output, "format")} · {output.description}</small></span><div>{output.status === "blocked" ? <button className="ghost-button" onClick={() => setOutputStatus(output, "review")}>되살리기</button> : <button className="ghost-button" onClick={() => setOutputStatus(output, "blocked")}>수정 요청</button>}{output.status === "draft" ? <button className="primary-button compact" onClick={() => setOutputStatus(output, "review")}>검토 시작</button> : output.status === "review" ? <button className="primary-button compact" onClick={() => setOutputStatus(output, "ready")}>검토 완료</button> : output.status === "ready" ? <button className="primary-button compact" onClick={() => setOutputStatus(output, "scheduled")}>최종 승인·예약</button> : null}</div></div>)}</div></article>)}{!groupedReview.length ? <div className="panel empty-state"><div><span><CheckCircle2 /></span><h3>확인할 파생 콘텐츠가 없습니다.</h3><p>새 원본에서 파생물을 생성하면 검토→최종 승인→예약 순으로 표시됩니다.</p></div></div> : null}</section>}
    {sourceOpen ? <div className="drawer-backdrop" onMouseDown={() => !busy && setSourceOpen(false)}><form className="record-drawer" onSubmit={submitSource} onMouseDown={(event) => event.stopPropagation()}><div className="drawer-head"><div><span className="eyebrow">SOURCE CONTENT</span><h2>최종 롱폼 등록</h2></div><button type="button" className="icon-button" onClick={() => setSourceOpen(false)}><X size={18} /></button></div><label><span>콘텐츠 제목</span><input name="title" required placeholder="유튜브 최종 롱폼 제목" /></label><label><span>원본 영상 URL</span><input type="url" name="sourceUrl" required placeholder="https://youtube.com/…" /></label><div className="form-grid"><label><span>브랜드</span><input name="brand" placeholder="브랜디액션" /></label><label><span>담당 팀</span><input name="team" defaultValue={profile?.team ?? "콘텐츠"} /></label></div><label><span>기준 발행일</span><input type="date" name="publishDate" required defaultValue={new Date().toISOString().slice(0, 10)} /></label><label><span>타깃 시청자</span><input name="audience" placeholder="방향을 잃은 직장인" /></label><label><span>핵심 메시지</span><textarea name="coreMessage" required rows={4} /></label><label><span>최종 스크립트·자막 원문</span><textarea name="transcript" required rows={10} placeholder="파생 콘텐츠 생성의 기준 원문" /></label><div className="drawer-actions"><button type="button" className="secondary-button" onClick={() => setSourceOpen(false)}>취소</button><button className="primary-button" disabled={busy}>{busy ? "저장 중…" : "원본 등록"}</button></div></form></div> : null}
  </>;
}
