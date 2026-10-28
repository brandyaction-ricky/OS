"use client";
/* eslint-disable @next/next/no-img-element -- private signed previews do not have stable optimizer URLs */
import Link from "next/link";
import { useCallback, useEffect, useState, type ReactNode } from "react";
import { Plus, Sparkles, X } from "lucide-react";
import { editableFields } from "@/lib/youtube-process/confirm";
import { projectName, stepHref } from "@/lib/youtube-process/project";
import { checkShortScript, headCopyProblem, refHostOk, refTexts, SHORT_SCRIPT, shortScriptMissing, type YpShortRefFetch } from "@/lib/youtube-process/short-script";
import type { YpShortRef, YpShortScript } from "@/lib/youtube-process/stages";
import { compactCount } from "@/lib/youtube-process/discover";
import { GateBanner, gateAction, gateSub, hhmm, LockedStep, Subject, useGate, YpFrame, YpSection, type YpPage } from "./youtube-process-frame";
import { JobLine, SendDialog, useStaffJob } from "./youtube-process-ai";

const blankRef: YpShortRef = { url: "", title: "", script: "" };

/**
 * 입구 C (owner direction 2026-10-28: "메타 광고는 어사이드 통해서"): Aside, in the PD's own browser, reads the Meta 광고 라이브러리 — the
 * longest-running active video ads and how many versions each runs — and enters each one on this screen as a reference; [레퍼런스 받기]
 * then has the render PC fetch the ad's video like any other. Nothing is run, liked or bought.
 */
export function asideAdInstruction(input: { topic: string; audience: string; count: number; page: string }) {
  return `[Aside 브라우저 조사 · 메타 광고 레퍼런스]
먼저 OS 문서에서 「숏폼 대본 정본」을 찾아 §2 입구 C와 §2-2 · §2-3을 읽고 따르세요. 열지 못하면 추정하지 말고 막힌 곳을 알려 주세요.
주제: ${input.topic}
시청자: ${input.audience || "정본의 현재 타겟"}

1. https://www.facebook.com/ads/library/ 를 엽니다. 국가 「대한민국」, 광고 카테고리 「모든 광고」, 상태 「활성 광고」로 두고 주제의 핵심어(2~3개를 바꿔 가며)로 검색합니다.
2. 영상 광고만 봅니다. 게재 시작일이 오래된 것부터 봅니다 — 라이브러리는 지금 켜져 있는 광고만 보여 주므로, 오래 켜져 있을수록 돈이 되는 광고일 가능성이 높습니다. 30일 넘게 켜져 있는 것만 후보로 둡니다.
3. 같은 광고를 여러 버전으로 돌리는지(「N개 버전」 표시) 확인합니다. 오래 켜져 있고 버전이 많을수록 앞에 둡니다.
4. 최대 ${input.count}개만 고릅니다. 수를 채우려고 약한 광고를 넣지 않습니다. 0개도 정상입니다.
5. 광고마다 확인합니다: 광고 라이브러리 주소(https://www.facebook.com/ads/library/?id=숫자), 광고주, 게재 시작일(YYYY-MM-DD), 버전 수, 첫 3초 화면의 헤드 카피(화면의 큰 글자 그대로), 본문 첫 줄, CTA 버튼, 연결 페이지 주소. 보이지 않는 값은 「확인 불가」라고 씁니다.
6. 아래 OS 화면의 「레퍼런스 › 직접 넣은 레퍼런스」에 광고마다 한 번씩 넣고 [레퍼런스 추가]를 누릅니다.
   - 영상 주소: 광고 라이브러리 주소
   - 제목: 광고주 · 게재 시작 YYYY-MM-DD · 버전 N개
   - 그 영상에서 실제로 한 말: 헤드 카피: … / 본문 첫 줄: … / CTA: … / 연결: …
   이미 있는 주소는 다시 넣지 않습니다.
7. 광고를 누르거나 좋아요 · 댓글 · 문의 · 구매 · 결제는 하지 않습니다. [레퍼런스 받기] · 대본 쓰기 · 확정도 누르지 않습니다 — 사람이 합니다.
8. 마지막에 넣은 광고 목록(광고주 · 게재 시작일 · 버전 수)과, 기준에 못 미쳐 뺀 이유를 짧게 보고합니다.

등록 화면: ${input.page}`;
}

/** A 숏폼's 대본 (숏폼 대본 정본 §2~§10, owner direction 2026-10-28): 레퍼런스 → 공식 → 대본, then the PD's 대본 확정. */
export function ShortScriptScreen({ page, header }: { page: YpPage; header: ReactNode }) {
  const control = useGate(page, "draft");
  const stage = page.bundle?.stages.shortScript;
  const [form, setForm] = useState<YpShortScript | null>(null);
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [savedAt, setSavedAt] = useState("");
  const [send, setSend] = useState(false);
  const [ref, setRef] = useState<YpShortRef>(blankRef);
  useEffect(() => { if (stage && !dirty) setForm(stage.data); }, [stage, dirty]);
  // 레퍼런스 받기 (2026-10-28): the render PC keeps each reference's thumbnail, first three seconds and words; polled while it works.
  const [refs, setRefs] = useState<YpShortRefFetch | null>(null);
  const [fetching, setFetching] = useState(false);
  const client = page.client, projectId = page.bundle?.project.id, fail = page.fail;
  const loadRefs = useCallback(async () => {
    if (!client || !projectId) return;
    try { setRefs(await client.shortRefs(projectId)); } catch (reason) { fail(reason); }
  }, [client, projectId, fail]);
  useEffect(() => { void loadRefs(); }, [loadRefs]);
  const refsWorking = Boolean(refs && ["backlog", "in_progress"].includes(refs.status));
  useEffect(() => {
    if (!refsWorking) return;
    const timer = window.setInterval(() => void loadRefs(), 15_000);
    return () => window.clearInterval(timer);
  }, [refsWorking, loadRefs]);
  const fetchRefs = async () => {
    if (!client || !projectId) return;
    setFetching(true); page.setError("");
    try { setRefs(await client.fetchShortRefs(projectId)); } catch (reason) { fail(reason); } finally { setFetching(false); }
  };
  const reload = page.reload;
  const onJobDone = useCallback(() => { setDirty(false); void reload(); }, [reload]);
  const job = useStaffJob(page, "short-script", onJobDone);
  const project = page.bundle?.project;
  const can = Boolean(project && project.yp.stage === "draft" && editableFields(project, "draft") === "all");

  const save = async (next: YpShortScript | null = form) => {
    if (!page.client || !project || !stage || !next) return;
    setBusy(true);
    try {
      const { query, refs: own, text, hooks, insight, formula, headCopy } = next;
      const result = await page.client.saveStage(project.id, "shortScript", stage.version, { query, refs: own, text, hooks, insight, formula, headCopy });
      page.setBundle(current => current ? { ...current, project: result.project, stages: { ...current.stages, shortScript: result.stage } } : current);
      setDirty(false); setSavedAt(hhmm());
    } catch (reason) { page.fail(reason); } finally { setBusy(false); }
  };
  const edit = (patch: Partial<YpShortScript>, now = false) => {
    const next = { ...form!, ...patch };
    setForm(next); setDirty(true); page.setError("");
    if (now) void save(next);
  };
  const applyDraft = async () => {
    if (!page.client || !project || !stage || !form?.aiDraft) return;
    try {
      const result = await page.client.saveStage(project.id, "shortScript", stage.version, { ...form.aiDraft, aiDraft: null });
      page.setBundle(current => current ? { ...current, project: result.project, stages: { ...current.stages, shortScript: result.stage } } : current);
      setDirty(false);
    } catch (reason) { page.fail(reason); }
  };

  const done = refs?.status === "done" ? refs : null;
  const check = form ? checkShortScript(form.text, { refs: refTexts(form, done) }) : null;
  const missing = !form ? "" : dirty ? "저장한 뒤에 확정해요" : shortScriptMissing(form, done);
  const action = page.bundle ? gateAction(page, "draft", 1, control, missing) : null;
  const from = project?.yp.shortFrom;
  const warehouse = [...(page.bundle?.formulas ?? [])].sort((a, b) => b.uses - a.uses);
  const firstLine = form?.text.split(/\r?\n/).map(line => line.trim()).find(Boolean) ?? "";
  return <YpFrame page={page} view={1} action={action} header={header} title="대본"
    sub={gateSub(project, "draft", "레퍼런스에서 공식을 뽑고, 그 공식으로 대본을 써서 확정해요.", "대본을 확정했어요. 제작으로 넘어가요.")}
    savedAt={savedAt} onSave={can ? () => void save() : undefined} saveDisabled={!dirty || busy}
    todo={form && can ? [{ label: "통찰 한 줄", done: Boolean(form.insight.trim()) }, { label: "헤드 카피", done: !headCopyProblem(form.headCopy ?? "") }, { label: "대본", done: Boolean(form.text.trim()) }, { label: "기계 검사", done: Boolean(check && !check.problems.length) }] : undefined}>
    {page.bundle && form && project ? project.yp.stage === "topic" ? <LockedStep page={page} name="대본" /> : <div onBlur={() => { if (dirty && can) void save(); }}>
      <GateBanner page={page} gate="draft" />
      <Subject page={page} />
      {from ? <div className="yp-note yp-gray"><div><b>롱폼에서 온 주제</b> · <Link className="yp-lnk" href={`/content/shorts?project=${from.projectId}`}>「{from.title}」</Link><br />
        <span className="yp-muted" style={{ fontSize: 13 }}>장면: {from.scene}{from.paragraph ? ` · 원고: ${from.paragraph}` : ""}</span></div></div> : null}

      {can ? (job.open || job.status?.job?.status === "blocked" ? <JobLine job={job} onRetry={() => setSend(true)} />
        : <div className="yp-row-btns" style={{ marginBottom: 10 }}><button type="button" className="yp-btn yp-sm yp-pri" disabled={page.demo || dirty} title={dirty ? "검색어 · 레퍼런스를 저장한 뒤에 보내요" : undefined} onClick={() => setSend(true)}><Sparkles size={14} /> {form.ai ? "내 AI로 다시 쓰기" : "내 AI로 공식 뽑고 대본 쓰기"}</button>
          {form.ai ? <span className="yp-aitag"><Sparkles size={11} aria-hidden="true" /> AI 초안 · {form.ai.by}</span> : null}</div>) : null}
      {form.aiDraft && can ? <div className="yp-note yp-purple" role="status"><Sparkles size={16} className="yp-i" aria-hidden="true" /><div><b>AI 대본이 왔어요.</b> 이미 쓴 내용이 있어 바로 넣지 않았어요.
        <button type="button" className="yp-lnk" onClick={() => void applyDraft()}>이 초안으로 바꾸기</button>
        <details><summary>초안 보기</summary><p style={{ fontSize: 13 }}><b>통찰</b> {form.aiDraft.insight}<br /><b>헤드 카피</b> {form.aiDraft.headCopy}<br /><b>공식</b> {form.aiDraft.formula}</p><div style={{ whiteSpace: "pre-wrap", fontSize: 13 }}>{form.aiDraft.text}</div></details></div></div> : null}

      <div>
        <YpSection n={1} title="레퍼런스" gq="같은 시청자 고민을 다룬 쇼츠 3~5개" need={false}>
          <label className="yp-lbl" style={{ display: "block" }}>검색어 <span className="yp-gq">OS가 이 말로 유튜브 쇼츠를 찾아 내 AI에게 줘요 · 비우면 주제 첫 줄</span>
            <input className="yp-in" value={form.query} maxLength={60} readOnly={!can} placeholder={projectName(project)} onChange={event => edit({ query: event.target.value })} aria-label="레퍼런스 검색어" /></label>
          <div className="yp-field"><div className="yp-fld-h"><b>받아 둔 레퍼런스</b><span className="yp-gq">렌더 PC가 썸네일 · 첫 3초 화면(헤드 카피) · 대사를 받아 둬요. 내 AI는 이걸 보고 공식을 뽑아요</span><span className="yp-sp" />
            {can ? <button type="button" className="yp-btn yp-sm" disabled={fetching || refsWorking || dirty || page.demo} title={dirty ? "검색어 · 레퍼런스를 저장한 뒤에 받아요" : page.demo ? "데모에서는 받지 않아요" : undefined}
              onClick={() => void fetchRefs()}>{refsWorking ? "받는 중…" : refs ? "다시 받기" : "레퍼런스 받기"}</button> : null}</div>
            {!refs ? <p className="yp-hint">[레퍼런스 받기]를 누르면 검색어로 찾은 쇼츠 6편과 직접 넣은 링크(유튜브 · 인스타 · 틱톡 · 메타 광고 라이브러리)를 받아요. 1~3분쯤 걸려요.</p>
              : refsWorking ? <p className="yp-hint">렌더 PC가 받는 중이에요 ({refs.items.length}편 · 「{refs.query}」). 다른 영상을 만드는 중이면 그 뒤에 받아요.</p>
              : refs.status !== "done" ? <p className="yp-errline">받지 못했어요{refs.error ? ` (${refs.error})` : ""}. [다시 받기]를 눌러 주세요.</p> : null}
            {refs?.status === "done" ? <ul className="yp-hist">{refs.items.map(item => <li key={item.url} style={{ alignItems: "flex-start", flexWrap: "wrap" }}>
              {item.thumbUrl ? <a href={item.thumbUrl} target="_blank" rel="noreferrer"><img src={item.thumbUrl} alt="썸네일" style={{ width: 120, borderRadius: 6, display: "block" }} /></a> : null}
              {item.sheetUrl ? <a href={item.sheetUrl} target="_blank" rel="noreferrer"><img src={item.sheetUrl} alt="첫 3초 화면" style={{ width: 180, borderRadius: 6, display: "block" }} /></a> : null}
              <span style={{ flex: "1 1 200px", minWidth: 0, fontSize: 13 }}><a href={item.url} target="_blank" rel="noreferrer">{item.title || item.url}</a>
                <span className="yp-tag" style={{ marginLeft: 6 }}>{item.source === "pd" ? "직접 넣음" : "검색"}</span>
                {item.views ? <span className="yp-muted"> · {compactCount(item.views)}회</span> : null}
                {item.result?.ok ? item.result.transcript ? <details><summary style={{ cursor: "pointer" }}>대사 보기</summary><div style={{ whiteSpace: "pre-line", fontSize: 12 }}>{item.result.transcript}</div></details>
                  : <><br /><span className="yp-muted">대사가 없어요 (음악만 있거나 소리를 못 뽑았어요)</span></>
                  : <><br /><span className="yp-errline" style={{ margin: 0 }}>{item.result?.error || "받지 못했어요"}</span></>}</span></li>)}</ul> : null}
          </div>
          {can ? <details style={{ margin: "6px 0 10px" }}><summary style={{ cursor: "pointer", fontSize: 13 }}>메타 광고는 Aside에 맡기기 (오래 켜진 광고 찾기)</summary>
            <p className="yp-hint" style={{ margin: "6px 0" }}>Aside가 내 브라우저에서 메타 광고 라이브러리를 보고, 오래 켜져 있고 버전이 많은 영상 광고를 아래 「직접 넣은 레퍼런스」에 넣어요. 다 넣으면 [레퍼런스 받기]를 눌러요.</p>
            <button type="button" className="yp-btn yp-sm" onClick={() => void navigator.clipboard.writeText(asideAdInstruction({ topic: projectName(project), audience: project.yp.topic.target, count: Math.max(1, 8 - form.refs.length),
              page: `${window.location.origin}/content/plan?project=${project.id}&view=draft` })).then(() => page.setError(""), () => page.setError("복사하지 못했어요. 브라우저의 클립보드 권한을 확인해 주세요."))}>Aside 조사 지침 복사</button></details> : null}
          {form.ai?.picked.length ? <div className="yp-field"><div className="yp-fld-h"><b>내 AI가 고른 쇼츠</b>{form.ai.market ? <span className="yp-gq">「{form.ai.market.query}」 {form.ai.market.count}편 중</span> : null}</div>
            <ul className="yp-open-list">{form.ai.picked.map(item => <li key={item.url}><a href={item.url} target="_blank" rel="noreferrer">{item.title}</a><span className="yp-sp" /><span className="yp-muted">{compactCount(item.views)}회</span></li>)}</ul></div> : null}
          <div className="yp-field"><div className="yp-fld-h"><b>직접 넣은 레퍼런스</b><span className="yp-gq">릴스 · 쇼츠 링크, 할 수 있으면 실제로 한 말도 붙여 넣어요 (흐름 공식이 정확해져요)</span></div>
            {form.refs.length ? <ul className="yp-open-list">{form.refs.map((item, index) => <li key={`${item.url}-${index}`} style={{ alignItems: "flex-start" }}>
              <span style={{ flex: 1, minWidth: 0 }}><a href={item.url} target="_blank" rel="noreferrer">{item.title || item.url}</a>{item.script ? <><br /><span className="yp-muted" style={{ fontSize: 12 }}>대본 {item.script.length}자</span></> : null}</span>
              {can ? <button type="button" className="yp-ib" aria-label="빼기" onClick={() => edit({ refs: form.refs.filter((_, at) => at !== index) }, true)}><X size={14} /></button> : null}</li>)}</ul> : <p className="yp-pempty">아직 없어요</p>}
            {can && form.refs.length < 8 ? <form style={{ display: "grid", gap: 6 }} onSubmit={event => { event.preventDefault();
              if (!refHostOk(ref.url.trim())) { page.setError("유튜브 · 인스타그램 · 틱톡 · 페이스북(메타 광고 라이브러리) 영상 주소를 붙여 넣어 주세요."); return; }
              edit({ refs: [...form.refs, { url: ref.url.trim(), title: ref.title.trim(), script: ref.script.trim() }] }, true); setRef(blankRef); }}>
              <div className="yp-savebar"><input className="yp-in" style={{ flex: 2 }} placeholder="영상 주소" aria-label="레퍼런스 주소" value={ref.url} onChange={event => setRef({ ...ref, url: event.target.value })} />
                <input className="yp-in" style={{ flex: 1 }} placeholder="제목 (선택)" aria-label="레퍼런스 제목" maxLength={200} value={ref.title} onChange={event => setRef({ ...ref, title: event.target.value })} /></div>
              <textarea className="yp-in" rows={2} maxLength={5000} placeholder="그 영상에서 실제로 한 말 (선택)" aria-label="레퍼런스 대본" value={ref.script} onChange={event => setRef({ ...ref, script: event.target.value })} />
              <div><button type="submit" className="yp-btn yp-sm"><Plus size={14} /> 레퍼런스 추가</button></div></form> : null}
          </div>
        </YpSection>

        <YpSection n={2} title="공식" gq="헤드 카피 · 썸네일 카피 · 첫 문장 · 흐름 공식 — 구조만 빌리고 문장은 새로" need={false}>
          {form.ai?.formulas.length ? <ol style={{ margin: 0, paddingLeft: 18, fontSize: 13, lineHeight: 1.6 }}>{form.ai.formulas.map(item => <li key={item.name} style={{ marginBottom: 6 }}>
            <b>{item.name}</b>{item.name === form.formula ? <span className="yp-tag yp-ok" style={{ marginLeft: 6 }}>이 대본에 씀</span> : null}<br />
            {item.head ? <>헤드 카피: {item.head}<br /></> : null}{item.cover ? <>썸네일 카피: {item.cover}<br /></> : null}첫 문장: {item.hook}<br />흐름: {item.flow}{item.why ? <><br /><span className="yp-muted">멈춘 이유: {item.why}</span></> : null}</li>)}</ol>
            : <p className="yp-hint">{form.ai ? `창고의 공식 「${form.formula}」를 썼어요.` : "내 AI가 레퍼런스에서 공식을 뽑아 여기 적어요."}</p>}
          <label className="yp-lbl" style={{ display: "block", marginTop: 8 }}>쓴 공식 <span className="yp-gq">창고 이름</span>
            <input className="yp-in" list="yp-formulas" value={form.formula} maxLength={40} readOnly={!can} onChange={event => edit({ formula: event.target.value })} aria-label="쓴 공식" /></label>
          <datalist id="yp-formulas">{warehouse.map(item => <option key={item.name} value={item.name} />)}</datalist>
          {warehouse.length ? <details style={{ marginTop: 8 }}><summary style={{ cursor: "pointer", fontSize: 13 }}>공식 창고 {warehouse.length}개 보기 (많이 쓴 순)</summary>
            <ul className="yp-hist" style={{ maxHeight: 280, overflow: "auto" }}>{warehouse.slice(0, 50).map(item => <li key={item.name} style={{ alignItems: "flex-start" }}><span style={{ flex: 1, minWidth: 0, fontSize: 13 }}>
              <b>{item.name}</b> <span className="yp-muted">· {item.uses}번 씀 · {item.by}</span><br />{item.head ? <>헤드 카피: {item.head}<br /></> : null}첫 문장: {item.hook}<br /><span className="yp-muted">흐름: {item.flow}</span></span></li>)}</ul></details> : null}
        </YpSection>

        <YpSection n={3} title="대본" gq="한 줄 = 한 문장 = 화면 한 장 · 비교가 있는 줄은 [관계], 인물이 처음 나오는 줄은 [사람]" need>
          <label className="yp-lbl" style={{ display: "block" }}>통찰 한 줄 <span className="yp-gq">다 들은 사람이 자기 말로 다시 할 문장</span>
            <input className="yp-in" value={form.insight} maxLength={120} readOnly={!can} onChange={event => edit({ insight: event.target.value })} aria-label="통찰 한 줄" /></label>
          <label className="yp-lbl" style={{ display: "block" }}>첫 화면 헤드 카피 <span className="yp-gq">첫 3초 화면 맨 위 큰 글자 · {SHORT_SCRIPT.head}자 이하 · 넘길지 말지가 여기서 정해져요</span>
            <input className="yp-in" value={form.headCopy ?? ""} maxLength={40} readOnly={!can} onChange={event => edit({ headCopy: event.target.value })} aria-label="첫 화면 헤드 카피" />
            {form.headCopy && headCopyProblem(form.headCopy) ? <span className="yp-errline">{headCopyProblem(form.headCopy)}</span> : null}</label>
          {form.hooks.length ? <div className="yp-field"><div className="yp-fld-h"><b>첫 문장 두 안</b><span className="yp-gq">하나를 골라 첫 줄로 써요</span></div>
            {form.hooks.map(hook => <div key={hook.kind} className="yp-savebar" style={{ marginBottom: 4 }}><span className="yp-tag">{hook.kind}</span><span style={{ flex: 1, minWidth: 0 }}>{hook.text}</span>
              {firstLine === hook.text ? <span className="yp-tag yp-ok">첫 줄</span> : can ? <button type="button" className="yp-btn yp-sm" onClick={() => {
                const lines = form.text.split(/\r?\n/); const at = lines.findIndex(line => line.trim());
                edit({ text: at < 0 ? hook.text : [...lines.slice(0, at), hook.text, ...lines.slice(at + 1)].join("\n") }, true); }}>첫 줄로 쓰기</button> : null}</div>)}</div> : null}
          <textarea className="yp-in" rows={16} value={form.text} maxLength={3000} readOnly={!can} aria-label="대본"
            placeholder={"첫 문장 (25자 이하)\n둘째 문장\n[관계] 둘을 비교하는 문장\n…"} onChange={event => edit({ text: event.target.value })} />
          {check ? <div className={`yp-note ${check.problems.length ? "yp-warn" : "yp-ok"}`} role="status" style={{ marginTop: 8 }}><div style={{ width: "100%" }}>
            <b>{check.chars}자 · 약 {check.seconds}초 · {check.lines}줄</b> <span className="yp-muted">(기본 250~370자, 1분에 490자)</span>
            {check.problems.length ? <ul style={{ margin: "4px 0 0", paddingLeft: 18 }}>{check.problems.map(problem => <li key={problem}>{problem}</li>)}</ul> : <> · 기계 검사 통과</>}
            {check.notes.map(note => <div key={note} className="yp-muted">{note}</div>)}</div></div> : null}
          {form.ai?.notes ? <p className="yp-hint" style={{ whiteSpace: "pre-line" }}>내 AI 메모: {form.ai.notes}</p> : null}
          {form.confirmed ? <p className="yp-hint">확정한 대본 · {form.confirmed.at.slice(0, 10)} — 제작은 이 대본으로 시작해요. <Link className="yp-lnk" href={stepHref(3, project.id)}>제작으로 →</Link></p> : null}
        </YpSection>
      </div>
      <SendDialog page={page} task="short-script" open={send} onClose={() => setSend(false)} job={job} />
    </div> : null}
  </YpFrame>;
}

/** 쇼츠 · 칼럼 › 숏폼 주제 (입구 A): the staff AI's candidates from this longform's 원고; each becomes its own 숏폼 at 주제. */
export function ShortTopicsPanel({ page }: { page: YpPage }) {
  const [send, setSend] = useState(false);
  const [making, setMaking] = useState("");
  const reload = page.reload;
  const job = useStaffJob(page, "short-topics", useCallback(() => void reload(), [reload]));
  const project = page.bundle?.project;
  const topics = page.bundle?.stages.shortTopics;
  const make = async (topicId: string) => {
    if (!page.client || !project) return;
    setMaking(topicId); page.setError("");
    try {
      const { topics: next } = await page.client.makeShort(project.id, topicId);
      page.setBundle(current => current ? { ...current, stages: { ...current.stages, shortTopics: next } } : current);
    } catch (reason) { page.fail(reason); } finally { setMaking(""); }
  };
  if (!project || !topics) return null;
  const items = topics.data.items;
  return <>
    <YpSection n={1} title="숏폼 주제 후보" gq="롱폼 원고에서 통찰 하나 + 장면 하나 · 숏폼은 새 대본 · 새 음성으로 만들어요" extra={
      <button type="button" className="yp-btn yp-sm yp-pri" disabled={page.demo || job.open} onClick={() => setSend(true)}><Sparkles size={14} /> {items.length ? "내 AI로 다시 뽑기" : "내 AI로 주제 뽑기"}</button>}>
      {job.open || job.status?.job?.status === "blocked" ? <JobLine job={job} onRetry={() => setSend(true)} /> : null}
      {topics.data.ai ? <p className="yp-hint" style={{ marginTop: 0 }}><span className="yp-aitag"><Sparkles size={10} aria-hidden="true" /> AI 초안 · {topics.data.ai.by}</span> 다시 뽑으면 아직 숏폼으로 만들지 않은 후보만 바뀌어요.</p> : null}
      {items.length ? <ul className="yp-hist">{items.map(item => <li key={item.id} style={{ alignItems: "flex-start", flexWrap: "wrap" }}>
        <span style={{ flex: "1 1 260px", minWidth: 0 }}><b>{item.insight}</b><br /><span className="yp-muted" style={{ fontSize: 13 }}>장면: {item.scene}</span>
          {item.paragraph ? <><br /><span className="yp-muted" style={{ fontSize: 12 }}>원고: {item.paragraph}</span></> : null}
          {item.why ? <><br /><span className="yp-muted" style={{ fontSize: 12 }}>멈출 이유: {item.why}</span></> : null}</span>
        {item.made ? <Link className="yp-btn yp-sm" href={stepHref(0, item.made.projectId)}>만든 숏폼 열기 →</Link>
          : <button type="button" className="yp-btn yp-sm yp-pri" disabled={Boolean(making)} onClick={() => void make(item.id)}>{making === item.id ? "만드는 중…" : "숏폼으로 만들기"}</button>}
      </li>)}</ul> : <p className="yp-pempty">아직 후보가 없어요. [내 AI로 주제 뽑기]를 누르면 원고에서 3개를 뽑아요.</p>}
      <p className="yp-hint">만든 숏폼은 내 영상 목록에 따로 생겨요. 그 숏폼에서 주제 컨펌 → 대본(레퍼런스 · 공식 · 대본 확정) → 제작으로 이어가요.</p>
    </YpSection>
    <SendDialog page={page} task="short-topics" open={send} onClose={() => setSend(false)} job={job} />
  </>;
}
