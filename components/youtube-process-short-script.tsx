"use client";
/* eslint-disable @next/next/no-img-element -- private signed previews do not have stable optimizer URLs */
import Link from "next/link";
import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { Copy, Plus, Search, Sparkles, X } from "lucide-react";
import { editableFields } from "@/lib/youtube-process/confirm";
import { projectName, stepHref, topicEditable, type YpProject } from "@/lib/youtube-process/project";
import { checkShortScript, headCopyProblem, parseCount, refCounts, refCountsLine, refHostOk, refPlatform, refReaction, refTexts, SHORT_REF_BAR_TEXT, SHORT_SCRIPT, shortResearchOpen, shortScriptMissing, type YpShortRefFetch } from "@/lib/youtube-process/short-script";
import type { YpShortFormula, YpShortRef, YpShortScript, YpShortTopicPick } from "@/lib/youtube-process/stages";
import { GateBanner, gateAction, gateSub, hhmm, LockedStep, Subject, useGate, useYpBundle, YpFrame, YpSection, type YpPage } from "./youtube-process-frame";
import { JobLine, SendDialog, useStaffJob } from "./youtube-process-ai";

const blankRef: YpShortRef = { url: "", title: "", script: "" };

/**
 * 입구 C (owner direction 2026-10-28: "메타 광고는 어사이드 통해서"): Aside, in the PD's own browser, reads the Meta 광고 라이브러리 — the
 * longest-running active video ads and how many versions each runs — and enters each one on this screen as a 참고 영상; [찾기] then has
 * the 영상 만드는 컴퓨터 fetch the ad's video like any other. Nothing is run, liked or bought.
 */
export function asideAdInstruction(input: { topic: string; query: string; links: string[]; audience: string; count: number; page: string }) {
  return `[Aside 브라우저 조사 · 메타 광고 참고 영상]
먼저 OS 문서에서 「숏폼 대본 정본」을 찾아 §2-5와 §2-2 · §2-3을 읽고 따르세요. 열지 못하면 추정하지 말고 막힌 곳을 알려 주세요.
초안 주제: ${input.topic}
검색 키워드: ${input.query || input.topic}
시청자: ${input.audience || "정본의 현재 타겟"}${input.links.length ? `\n관련 링크: ${input.links.join(" · ")}` : ""}

1. https://www.facebook.com/ads/library/ 를 엽니다. 국가 「대한민국」, 광고 카테고리 「모든 광고」, 상태 「활성 광고」로 두고 검색 키워드와 비슷한 말(2~3개를 바꿔 가며)로 검색합니다. 관련 링크가 있으면 먼저 열어 어떤 제품 · 고민을 다루는지 보고, 같은 광고주나 같은 고민을 다루는 광고도 찾습니다.
2. 영상 광고만 봅니다. 게재 시작일이 오래된 것부터 봅니다 — 라이브러리는 지금 켜져 있는 광고만 보여 주므로, 오래 켜져 있을수록 돈이 되는 광고일 가능성이 높습니다. 30일 넘게 켜져 있는 것만 후보로 둡니다.
3. 같은 광고를 여러 버전으로 돌리는지(「N개 버전」 표시) 확인합니다. 오래 켜져 있고 버전이 많을수록 앞에 둡니다.
4. 최대 ${input.count}개만 고릅니다. 수를 채우려고 약한 광고를 넣지 않습니다. 0개도 정상입니다.
5. 광고마다 확인합니다: 광고 라이브러리 주소(https://www.facebook.com/ads/library/?id=숫자), 광고주, 게재 시작일(YYYY-MM-DD), 버전 수, 첫 3초 화면의 헤드 카피(화면의 큰 글자 그대로), 본문 첫 줄, CTA 버튼, 연결 페이지 주소. 보이지 않는 값은 「확인 불가」라고 씁니다.
6. 아래 OS 화면의 「참고 영상」에서 [링크 넣기]를 눌러 광고마다 한 번씩 넣습니다.
   - 영상 주소: 광고 라이브러리 주소
   - 제목: 광고주 · 게재 시작 YYYY-MM-DD · 버전 N개
   - 영상에서 한 말: 헤드 카피: … / 본문 첫 줄: … / CTA: … / 연결: …
   이미 있는 주소는 다시 넣지 않습니다.
7. 광고를 누르거나 좋아요 · 댓글 · 문의 · 구매 · 결제는 하지 않습니다. [찾기] · [내 AI에게 맡기기] · [주제 확정] · [대본 확정]도 누르지 않습니다 — 사람이 합니다.
8. 마지막에 넣은 광고 목록(광고주 · 게재 시작일 · 버전 수)과, 기준에 못 미쳐 뺀 이유를 짧게 보고합니다.

등록 화면: ${input.page}`;
}

/** The 숏폼's 대본 record as a form, saved on blur and before anything reads it (the staff AI, the 영상 만드는 컴퓨터). */
function useShortForm(page: YpPage, onProject?: (project: YpProject) => void) {
  const stage = page.bundle?.stages.shortScript;
  const [form, setForm] = useState<YpShortScript | null>(null);
  const [dirty, setDirty] = useState(false);
  const [savedAt, setSavedAt] = useState("");
  useEffect(() => { if (stage && !dirty) setForm(stage.data); }, [stage, dirty]);
  const project = page.bundle?.project;
  const save = async (next: YpShortScript | null = form) => {
    if (!page.client || !project || !stage || !next) return false;
    try {
      const { query, refs: own, text, hooks, insight, formula, headCopy } = next;
      const result = await page.client.saveStage(project.id, "shortScript", stage.version, { query, refs: own, text, hooks, insight, formula, headCopy });
      page.setBundle(current => current ? { ...current, project: result.project, stages: { ...current.stages, shortScript: result.stage } } : current);
      onProject?.(result.project);
      setDirty(false); setSavedAt(hhmm());
      return true;
    } catch (reason) { page.fail(reason); return false; }
  };
  const edit = (patch: Partial<YpShortScript>, now = false) => {
    const next = { ...form!, ...patch };
    setForm(next); setDirty(true); page.setError("");
    if (now) void save(next);
  };
  // What the AI and the 영상 만드는 컴퓨터 read is the saved step: an unsaved edit is saved first instead of disabling the button.
  const saved = async () => !dirty || await save();
  return { stage, form, dirty, setDirty, savedAt, save, edit, saved };
}

/** 참고 영상: the 영상 만드는 컴퓨터 keeps each one's thumbnail, first three seconds and words; polled while it works. */
function useShortRefs(page: YpPage) {
  const [refs, setRefs] = useState<YpShortRefFetch | null>(null);
  const [fetching, setFetching] = useState(false);
  const client = page.client, projectId = page.bundle?.project.id, fail = page.fail;
  const load = useCallback(async () => {
    if (!client || !projectId) return;
    try { setRefs(await client.shortRefs(projectId)); } catch (reason) { fail(reason); }
  }, [client, projectId, fail]);
  useEffect(() => { void load(); }, [load]);
  const busy = Boolean(refs && ["backlog", "in_progress"].includes(refs.status));
  useEffect(() => {
    if (!busy) return;
    const timer = window.setInterval(() => void load(), 15_000);
    return () => window.clearInterval(timer);
  }, [busy, load]);
  const fetch = async (saved: () => Promise<boolean>) => {
    if (!client || !projectId || !await saved()) return;
    setFetching(true); page.setError("");
    try { setRefs(await client.fetchShortRefs(projectId)); } catch (reason) { fail(reason); } finally { setFetching(false); }
  };
  return { refs, working: busy || fetching, fetch, done: refs?.status === "done" ? refs : null };
}

/**
 * 릴스 · 틱톡 (owner 2026-10-28: "기준이 충족된 레퍼런스가 최대한 많을수록 … 틱톡, 인스타릴스도"): neither has a search the OS or the
 * render PC may use, so Aside searches them in the PD's own browser and enters the ones over the 반응도 기준 with their counts. The render
 * PC then fetches each TikTok like a Short; a Reel it cannot open without a login keeps the counts and the words Aside wrote.
 */
export function asideSocialInstruction(input: { topic: string; query: string; links: string[]; audience: string; count: number; page: string }) {
  const q = encodeURIComponent(input.query || input.topic);
  return `[Aside 브라우저 조사 · 릴스 · 틱톡 참고 영상]
먼저 OS 문서에서 「숏폼 대본 정본」을 찾아 §2-2 · §2-3을 읽고 따르세요. 열지 못하면 추정하지 말고 막힌 곳을 알려 주세요.
초안 주제: ${input.topic}
검색 키워드: ${input.query || input.topic}
시청자: ${input.audience || "정본의 현재 타겟"}${input.links.length ? `\n이미 넣은 링크: ${input.links.join(" · ")}` : ""}

반응도 기준(셋 다 넘은 것만 넣습니다): ${SHORT_REF_BAR_TEXT}. 팔로워 수가 안 보이면 조회와 좋아요만 봅니다.

1. 틱톡: https://www.tiktok.com/search/video?q=${q} 를 엽니다. 검색 키워드와 비슷한 말 2~3개로도 찾습니다.
2. 인스타그램 릴스: https://www.instagram.com/explore/search/keyword/?q=${q} 에서 릴스만 봅니다. 키워드 해시태그(https://www.instagram.com/explore/tags/키워드/)도 봅니다.
3. 영상 페이지를 하나씩 열어 조회수(재생 수) · 좋아요 수 · 계정 팔로워 수(보이면)를 확인하고, 기준을 넘고 같은 시청자 고민을 다룬 것만 고릅니다. 최대 ${input.count}개입니다. 수를 채우려고 약한 영상을 넣지 않습니다. 0개도 정상입니다.
4. 고른 영상마다 첫 화면의 큰 글자(헤드 카피)를 그대로, 그리고 첫 문장(말이나 자막)을 적어 둡니다.
5. 아래 OS 화면의 「참고 영상」에서 [링크 넣기]를 눌러 영상마다 한 번씩 넣습니다.
   - 영상 주소: 영상 하나의 주소(https://www.tiktok.com/@계정/video/숫자 또는 https://www.instagram.com/reel/코드/)
   - 제목: 틱톡 · @계정 (릴스면 릴스 · @계정)
   - 영상에서 한 말: 헤드 카피: … / 첫 문장: …
   - 조회수 · 좋아요 · 팔로워: 화면의 숫자 그대로(12.5만처럼 적어도 됩니다). 안 보이는 칸은 비웁니다.
   이미 있는 주소는 다시 넣지 않습니다.
6. 좋아요 · 팔로우 · 댓글 · 저장 · 공유 · 메시지는 하지 않습니다. [다시 찾기] · [내 AI에게 맡기기] · [주제 확정] · [대본 확정]도 누르지 않습니다 — 사람이 합니다.
7. 마지막에 넣은 영상 목록(플랫폼 · 계정 · 조회수 · 좋아요)과 기준에 못 미쳐 뺀 개수를 짧게 보고합니다.

등록 화면: ${input.page}`;
}

/** A 숏폼's 대본 (숏폼 대본 정본, owner direction 2026-10-28): 첫 화면 · 대본 on the left, 참고 영상 on the right, then the PD's 대본 확정. */
export function ShortScriptScreen({ page, header }: { page: YpPage; header: ReactNode }) {
  const control = useGate(page, "draft");
  const { stage, form, dirty, setDirty, savedAt, save, edit, saved: savedFirst } = useShortForm(page);
  const [send, setSend] = useState(false);
  const [manual, setManual] = useState(false);
  const reload = page.reload;
  const onJobDone = useCallback(() => { setDirty(false); void reload(); }, [reload, setDirty]);
  const job = useStaffJob(page, "short-script", onJobDone);
  const shortRefs = useShortRefs(page);
  const project = page.bundle?.project;
  const can = Boolean(project && project.yp.stage === "draft" && editableFields(project, "draft") === "all");
  const askAi = async () => { if (await savedFirst()) setSend(true); };
  const applyDraft = async () => {
    if (!page.client || !project || !stage || !form?.aiDraft) return;
    try {
      const result = await page.client.saveStage(project.id, "shortScript", stage.version, { ...form.aiDraft, aiDraft: null });
      page.setBundle(current => current ? { ...current, project: result.project, stages: { ...current.stages, shortScript: result.stage } } : current);
      setDirty(false);
    } catch (reason) { page.fail(reason); }
  };
  const pickHook = (text: string) => {
    const lines = form!.text.split(/\r?\n/); const at = lines.findIndex(line => line.trim());
    edit({ text: at < 0 ? text : [...lines.slice(0, at), text, ...lines.slice(at + 1)].join("\n") }, true);
  };

  const done = shortRefs.done;
  const check = form ? checkShortScript(form.text, { refs: refTexts(form, done) }) : null;
  const missing = !form ? "" : dirty ? "저장한 뒤에 확정해요" : shortScriptMissing(form, done);
  const action = page.bundle ? gateAction(page, "draft", 1, control, missing) : null;
  const from = project?.yp.shortFrom;
  // From what is saved, so the two choice cards do not vanish (and the page jump) on the first key pressed.
  const saved = stage?.data;
  // The 통찰 may come from the 주제 후보 the topic was fixed with; the 대본 has started once its own fields hold something.
  const started = Boolean(saved && (saved.text.trim() || saved.headCopy?.trim() || saved.ai));
  const firstLine = form?.text.split(/\r?\n/).map(line => line.trim()).find(Boolean) ?? "";
  const head = form?.headCopy ?? "";
  return <YpFrame page={page} view={1} action={action} header={header} title="대본"
    sub={gateSub(project, "draft", "첫 화면 문구와 대본을 쓰고 확정해요.", "대본을 확정했어요. 제작으로 넘어가요.")}
    savedAt={savedAt} onSave={can ? () => void save() : undefined} saveDisabled={!dirty}
    todo={form && can ? [{ label: "헤드 카피", done: !headCopyProblem(head) }, { label: "핵심 한 줄", done: Boolean(form.insight.trim()) }, { label: "대본", done: Boolean(form.text.trim()) }, { label: "검사 통과", done: Boolean(form.text.trim() && check && !check.problems.length) }] : undefined}>
    {page.bundle && form && project ? project.yp.stage === "topic" ? <LockedStep page={page} name="대본" /> : <div onBlur={() => { if (dirty && can) void save(); }}>
      <GateBanner page={page} gate="draft" />
      <Subject page={page} />
      {from ? <div className="yp-note yp-gray"><div><b>롱폼에서 온 주제</b> · <Link className="yp-lnk" href={`/content/shorts?project=${from.projectId}`}>{from.title}</Link> · {from.scene}</div></div> : null}

      {can ? (job.open || job.status?.job?.status === "blocked" ? <JobLine job={job} onRetry={() => void askAi()} />
        : !started && !manual ? <div className="yp-ways">
          <button type="button" className="yp-way yp-rec" onClick={() => void askAi()}><b><Sparkles size={14} aria-hidden="true" /> 내 AI에게 맡기기</b><span>{form.formula.trim() ? "주제를 정할 때 고른 공식으로 헤드 카피와 대본을 써 줘요" : "참고 영상에서 공식을 뽑아 헤드 카피와 대본을 써 줘요"}</span></button>
          <button type="button" className="yp-way" onClick={() => { setManual(true); window.setTimeout(() => document.querySelector<HTMLInputElement>("[aria-label='헤드 카피']")?.focus(), 50); }}><b>직접 쓰기</b><span>아래 칸을 바로 채워요</span></button></div>
        : <div className="yp-row-btns" style={{ marginBottom: 10 }}><button type="button" className="yp-btn yp-sm" onClick={() => void askAi()}><Sparkles size={14} /> {form.ai ? "내 AI로 다시 쓰기" : "내 AI에게 맡기기"}</button>
          {form.ai ? <span className="yp-aitag"><Sparkles size={11} aria-hidden="true" /> AI 초안 · {form.ai.by}</span> : null}</div>) : null}
      {form.aiDraft && can ? <div className="yp-note yp-purple" role="status"><Sparkles size={16} className="yp-i" aria-hidden="true" /><div><b>AI 대본이 왔어요.</b> 이미 쓴 내용이 있어 바로 넣지 않았어요.
        <button type="button" className="yp-lnk" onClick={() => void applyDraft()}>이 초안으로 바꾸기</button>
        <details><summary>초안 보기</summary><p style={{ fontSize: 13, margin: "6px 0" }}><b>헤드 카피</b> {form.aiDraft.headCopy}<br /><b>핵심 한 줄</b> {form.aiDraft.insight}</p><div style={{ whiteSpace: "pre-wrap", fontSize: 13 }}>{form.aiDraft.text}</div></details></div></div> : null}

      <div className="yp-wrap2"><div>
        <YpSection n={1} title="첫 화면" gq="넘기지 않게 할 첫 3초는?" need>
          <div className="yp-field"><div className="yp-fld-h"><b>헤드 카피</b><span className="yp-gq">화면 맨 위 큰 글자</span><span className="yp-sp" />
            <span className={head.trim().length > SHORT_SCRIPT.head ? "yp-errline" : "yp-muted"} style={{ fontSize: 12, margin: 0 }}>{head.trim().length}/{SHORT_SCRIPT.head}</span></div>
            <input className="yp-in" value={head} maxLength={40} readOnly={!can} placeholder="예) 일은 두 개뿐인데 왜 지칠까" onChange={event => edit({ headCopy: event.target.value })} aria-label="헤드 카피" /></div>
          {form.hooks.length ? <div className="yp-field"><div className="yp-fld-h"><b>첫 문장</b><span className="yp-gq">골라서 대본 첫 줄로</span></div>
            <div className="yp-chips">{form.hooks.map(hook => <button key={hook.kind} type="button" className={`yp-chip${firstLine === hook.text ? " yp-on" : ""}`} disabled={!can || firstLine === hook.text} onClick={() => pickHook(hook.text)}>
              <b>{hook.kind}</b> {hook.text}</button>)}</div></div> : null}
        </YpSection>

        <YpSection n={2} title="대본" gq="40초 동안 무슨 말을 하나요?" need>
          <div className="yp-field"><div className="yp-fld-h"><b>핵심 한 줄</b><span className="yp-gq">다 들은 사람이 기억할 한 문장</span></div>
            <input className="yp-in" value={form.insight} maxLength={120} readOnly={!can} placeholder="예) 지치는 건 일이 많아서가 아니라 고를 게 많아서예요" onChange={event => edit({ insight: event.target.value })} aria-label="핵심 한 줄" /></div>
          <div className="yp-field"><div className="yp-fld-h"><b>대본</b><span className="yp-gq">한 줄에 한 문장</span></div>
            <textarea className="yp-in" rows={16} value={form.text} maxLength={3000} readOnly={!can} aria-label="대본"
              placeholder={"퇴근하고 소파에 누워 휴대폰만 봐요\n할 일은 두 개뿐이었는데 말이죠\n[사람] 3년 차 마케터 지은 씨도 그랬어요\n[관계] 일한 시간보다 고른 횟수가 문제였어요\n…"} onChange={event => edit({ text: event.target.value })} />
            {check && form.text.trim() ? <div className={`yp-note ${check.problems.length ? "yp-warn" : "yp-ok"}`} role="status" style={{ marginTop: 8 }}><div style={{ width: "100%" }}>
              <b>{check.chars}자 · 약 {check.seconds}초{check.problems.length ? ` · 고칠 곳 ${check.problems.length}개` : " · 검사 통과"}</b>
              {check.problems.length ? <ul style={{ margin: "4px 0 0", paddingLeft: 18 }}>{check.problems.map(problem => <li key={problem}>{problem}</li>)}</ul> : null}
              {check.notes.map(note => <div key={note}>{note}</div>)}</div></div> : null}</div>
          {form.ai?.notes ? <details className="yp-more-fields"><summary>내 AI가 남긴 메모</summary><p style={{ whiteSpace: "pre-line", fontSize: 13 }}>{form.ai.notes}</p></details> : null}
          {form.confirmed ? <p className="yp-hint">제작은 확정한 대본으로 시작해요. <Link className="yp-lnk" href={stepHref(3, project.id)}>제작으로 →</Link></p> : null}
        </YpSection>
        <FormulaBox page={page} form={form} can={can} onChange={formula => edit({ formula })} />
      </div>
      <aside className="yp-rside"><section className="yp-card"><div className="yp-card-h">참고 영상 <span className="yp-opt">선택</span></div><div className="yp-card-b">
        <ShortRefs page={page} form={form} can={can} refs={shortRefs.refs} working={shortRefs.working} onFetch={() => void shortRefs.fetch(savedFirst)} onEdit={edit} /></div></section></aside>
      </div>
      <SendDialog page={page} task="short-script" open={send} onClose={() => setSend(false)} job={job} />
    </div> : null}
  </YpFrame>;
}

/**
 * 숏폼 주제 (owner direction 2026-10-28: "주제를 먼저 정하는 게 아니라 초안 주제만 키워드나 관련 링크로 전하고, 레퍼런스를 보고 공식을
 * 도출해서 주제를 픽스"): under the 초안 주제, the 참고 영상 and the staff AI's formulas with three 주제 후보. [이 주제로] puts one in the
 * 주제 field above and keeps its formula and 통찰 for the 대본. The topic screen owns the project (its saves move the version), so this
 * part reads the project from it and hands back what its own saves return.
 */
export function ShortTopicResearch({ project, onProject, onPick, onState }: {
  project: YpProject; onProject: (project: YpProject) => void; onPick: (title: string) => void; onState: (state: { refs: boolean; formula: string }) => void;
}) {
  const loaded = useYpBundle();
  const page: YpPage = useMemo(() => ({ ...loaded, bundle: loaded.bundle && { ...loaded.bundle, project } }), [loaded, project]);
  const { stage, form, dirty, setDirty, save, edit, saved } = useShortForm(page, onProject);
  const [send, setSend] = useState(false);
  const reload = loaded.reload;
  const job = useStaffJob(page, "short-formula", useCallback(() => { setDirty(false); void reload(); }, [reload, setDirty]));
  const shortRefs = useShortRefs(page);
  const can = shortResearchOpen(project);
  // Formulas and 주제 후보 belong to 주제: once the topic is fixed they are read-only here (the 대본 keeps the chosen formula).
  const canPick = project.yp.stage === "topic" && topicEditable(project);
  // References the AI may use: fetched, and not known to be under the 반응도 기준.
  const found = Boolean(shortRefs.done?.items.some(item => (item.result?.ok || item.source === "pd") && refReaction(refCounts(item)) !== "below"));
  // What 주제 확정 checks is the saved formula, not one still being typed.
  const formula = stage?.data.formula.trim() ?? "";
  useEffect(() => { onState({ refs: found, formula }); }, [found, formula, onState]);
  if (!form) return loaded.error ? <div className="yp-note yp-warn" role="alert"><div>{loaded.error}</div></div> : null;
  const research = form.research;
  // The 초안 주제 stays as the search words, so [다시 찾기] still looks for what the references were found with.
  // The 대본 record first, then the title: the record's save may move the project's version, and the title save starts from that.
  const pick = async (topic: YpShortTopicPick) => {
    const patch = { formula: topic.formula, insight: topic.insight, ...(form.query.trim() ? {} : { query: projectName(project).slice(0, 60) }) };
    edit(patch);
    if (await save({ ...form, ...patch })) onPick(topic.title);
  };
  const askAi = async () => { if (await saved()) setSend(true); };
  return <div onBlur={() => { if (dirty && can) void save(); }}>
    {loaded.conflict ? <div className="yp-note yp-warn" role="alert"><div>참고 영상 · 공식을 다른 사람이 먼저 고쳤어요. <button type="button" className="yp-lnk" onClick={() => { setDirty(false); void reload(); }}>새로 불러오기</button></div></div> : null}
    {loaded.error ? <div className="yp-note yp-warn" role="alert"><div>{loaded.error}</div></div> : null}
    <YpSection n={4} title="참고 영상" gq="키워드나 링크로 비슷한 영상을 찾아요" need>
      <div className="yp-max720"><ShortRefs page={page} form={form} can={can} refs={shortRefs.refs} working={shortRefs.working} onFetch={() => void shortRefs.fetch(saved)} onEdit={edit} /></div>
    </YpSection>
    <YpSection n={5} title="공식 · 주제 후보" gq="먹힌 공식으로 어떤 주제를 할까요?" need
      extra={canPick && research && !job.open ? <button type="button" className="yp-btn yp-sm" onClick={() => void askAi()}><Sparkles size={14} /> 내 AI로 다시 뽑기</button> : null}>
      <div className="yp-max720">
        {canPick && (job.open || job.status?.job?.status === "blocked") ? <JobLine job={job} onRetry={() => void askAi()} />
          : canPick && !research ? <div className="yp-ways" style={{ marginBottom: 0 }}>
            <button type="button" className="yp-way yp-rec" disabled={!found} onClick={() => void askAi()}><b><Sparkles size={14} aria-hidden="true" /> 내 AI에게 맡기기</b>
              <span>{found ? "참고 영상에서 공식을 뽑고, 그 공식으로 주제 후보 3개를 내 줘요" : "먼저 4에서 참고 영상을 찾아요"}</span></button></div> : null}
        {research ? <ul className="yp-hist">{research.topics.map(topic => {
          const chosen = topic.title === projectName(project) && topic.formula === form.formula.trim();
          return <li key={topic.title} style={{ alignItems: "center", flexWrap: "wrap", gap: 10 }}>
            <span style={{ flex: "1 1 260px", minWidth: 0 }}><b>{topic.title}</b><br /><span style={{ fontSize: 13 }}>{topic.insight}</span><br />
              <span className="yp-muted" style={{ fontSize: 12 }}>공식: {topic.formula}{topic.why ? ` · ${topic.why}` : ""}</span></span>
            {/* Not while a new run is open: a pick changes the 초안 주제 the run was asked with, and the run would be closed. */}
            {chosen ? <span className="yp-tag yp-ok">고른 주제</span> : canPick && !job.open ? <button type="button" className="yp-btn yp-sm yp-pri" onClick={() => void pick(topic)}>이 주제로</button> : null}
          </li>;
        })}</ul> : null}
        {research?.formulas.length ? <details className="yp-more-fields"><summary>뽑은 공식 {research.formulas.length}개</summary>
          <ol style={{ margin: "8px 0", paddingLeft: 18, fontSize: 13, lineHeight: 1.6 }}>{research.formulas.map(item => <li key={item.name} style={{ marginBottom: 6 }}><b>{item.name}</b><br />{formulaLines(item)}</li>)}</ol></details> : null}
        {research?.notes ? <details className="yp-more-fields"><summary>내 AI가 남긴 메모</summary><p style={{ whiteSpace: "pre-line", fontSize: 13 }}>{research.notes}</p></details> : null}
        <FormulaBox page={page} form={form} can={canPick} drawn={false} label="공식 창고에서 직접 고르기" onChange={value => edit({ formula: value })} />
      </div>
    </YpSection>
    <SendDialog page={page} task="short-formula" open={send} onClose={() => setSend(false)} job={job} />
  </div>;
}

const formulaLines = (item: { head?: string; cover?: string; hook: string; flow: string }) => <>
  {item.head ? <>헤드 카피: {item.head}<br /></> : null}{item.cover ? <>썸네일 카피: {item.cover}<br /></> : null}첫 문장: {item.hook}<br /><span className="yp-muted">흐름: {item.flow}</span></>;
/** The formulas drawn for this 숏폼: on 주제 from the references, and on 대본 when no formula had been chosen. */
const drawnFormulas = (form: YpShortScript) => [...(form.research?.formulas ?? []), ...(form.ai?.formulas ?? [])]
  .filter((item, index, list) => list.findIndex(other => other.name === item.name) === index);

/** Which formula the 대본 follows: the ones drawn for it and the company 공식 창고 (most used first), folded away until asked for. */
function FormulaBox({ page, form, can, onChange, label = "쓴 공식", drawn = true }: { page: YpPage; form: YpShortScript; can: boolean; onChange: (formula: string) => void; label?: string; drawn?: boolean }) {
  const warehouse = [...(page.bundle?.formulas ?? [])].sort((a, b) => b.uses - a.uses);
  const lines = formulaLines;
  const mine: YpShortFormula[] = drawn ? drawnFormulas(form) : [];
  return <details className="yp-more-fields"><summary>{label}{form.formula ? ` · ${form.formula}` : ""}</summary>
    {mine.length ? <ol style={{ margin: "8px 0", paddingLeft: 18, fontSize: 13, lineHeight: 1.6 }}>{mine.map(item => <li key={item.name} style={{ marginBottom: 6 }}>
      <b>{item.name}</b>{item.name === form.formula ? <span className="yp-tag yp-ok" style={{ marginLeft: 6 }}>이 대본</span> : null}<br />{lines(item)}</li>)}</ol> : null}
    <input className="yp-in" list="yp-formulas" value={form.formula} maxLength={40} readOnly={!can} placeholder="공식 창고에서 고르기" onChange={event => onChange(event.target.value)} aria-label={label} style={{ marginTop: 8 }} />
    <datalist id="yp-formulas">{warehouse.map(item => <option key={item.name} value={item.name} />)}</datalist>
    {warehouse.length ? <ul className="yp-hist" style={{ maxHeight: 280, overflow: "auto", marginTop: 8 }}>{warehouse.slice(0, 50).map(item => <li key={item.name} style={{ alignItems: "flex-start" }}>
      <span style={{ flex: 1, minWidth: 0, fontSize: 13 }}><b>{item.name}</b> <span className="yp-muted">· {item.uses}번 씀</span><br />{lines(item)}</span></li>)}</ul> : null}
  </details>;
}

/** 참고 영상: search words + [찾기], what the 영상 만드는 컴퓨터 kept of each, links put in by hand, and Meta ads via Aside. */
function ShortRefs({ page, form, can, refs, working, onFetch, onEdit }: {
  page: YpPage; form: YpShortScript; can: boolean; refs: YpShortRefFetch | null; working: boolean; onFetch: () => void; onEdit: (patch: Partial<YpShortScript>, now?: boolean) => void;
}) {
  const [open, setOpen] = useState("");
  const [adding, setAdding] = useState(false);
  const [link, setLink] = useState<YpShortRef>(blankRef);
  const [nums, setNums] = useState({ views: "", likes: "", followers: "" });
  const [copied, setCopied] = useState("");
  const project = page.bundle!.project;
  const add = () => {
    if (!refHostOk(link.url.trim())) { page.setError("유튜브 · 인스타그램 · 틱톡 · 메타 광고 라이브러리 주소를 넣어 주세요."); return; }
    if (form.refs.some(ref => ref.url === link.url.trim())) { page.setError("이미 넣은 영상이에요."); return; }
    if (form.refs.length >= 12) { page.setError("직접 넣는 링크는 12개까지예요."); return; }
    const counts = { views: parseCount(nums.views), likes: parseCount(nums.likes), followers: parseCount(nums.followers) };
    const unread = (["views", "likes", "followers"] as const).filter(key => nums[key].trim() && counts[key] === null);
    if (unread.length) { page.setError(`숫자를 읽지 못했어요: ${unread.map(key => nums[key]).join(", ")} — 12.5만, 3,400처럼 적어 주세요.`); return; }
    onEdit({ refs: [...form.refs, { url: link.url.trim(), title: link.title.trim(), script: link.script.trim(), ...counts }] }, true);
    setLink(blankRef); setNums({ views: "", likes: "", followers: "" }); setAdding(false);
  };
  // Aside in the PD's own browser: Meta ads, and Reels · TikTok (neither has a search the OS may use).
  const copyAside = async (kind: "ad" | "social") => {
    try {
      const input = { topic: projectName(project), query: form.query.trim(), links: form.refs.map(ref => ref.url), audience: project.yp.topic.target,
        count: Math.max(1, 12 - form.refs.length), page: `${window.location.origin}/content/plan?project=${project.id}${project.yp.stage === "draft" ? "&view=draft" : ""}` };
      await navigator.clipboard.writeText(kind === "ad" ? asideAdInstruction(input) : asideSocialInstruction(input));
      setCopied(kind); window.setTimeout(() => setCopied(""), 4000);
    } catch { page.setError("복사하지 못했어요. 브라우저의 클립보드 권한을 확인해 주세요."); }
  };
  const items = refs?.status === "done" ? refs.items : [];
  return <>
    {can ? <form className="yp-savebar" style={{ margin: 0 }} onSubmit={event => { event.preventDefault(); onFetch(); }}>
      <input className="yp-in" style={{ flex: 1, minWidth: 0 }} value={form.query} maxLength={60} placeholder={projectName(project)} onChange={event => onEdit({ query: event.target.value })} aria-label="참고 영상 검색어" />
      <button type="submit" className="yp-btn yp-sm yp-pri" disabled={working}><Search size={14} /> {working ? "가져오는 중" : refs ? "다시 찾기" : "찾기"}</button></form> : null}
    {working ? <p className="yp-hint" role="status">참고 영상을 가져오는 중이에요. 영상이 많으면 5~10분 걸려요.</p>
      : refs && refs.status !== "done" ? <p className="yp-errline">가져오지 못했어요. 다시 찾아 주세요.</p> : refs?.error ? <p className="yp-errline">{refs.error}</p> : null}
    <p className="yp-hint" style={{ margin: "6px 0 0" }}>반응도 기준: {SHORT_REF_BAR_TEXT}</p>
    {items.length ? <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(130px, 1fr))", gap: 10, marginTop: 8 }}>{items.map(item => {
      const shown = open === item.url;
      const counts = refCounts(item);
      const reaction = refReaction(counts);
      // A Short's thumbnail is a vertical frame: shown 9:16 and large enough to read its copy, with the whole title under it.
      return <button key={item.url} type="button" aria-expanded={shown} onClick={() => setOpen(shown ? "" : item.url)}
          style={{ display: "grid", gap: 4, alignContent: "start", textAlign: "left", background: "none", border: shown ? "2px solid var(--accent)" : "1px solid var(--line)", borderRadius: 8, padding: 6, color: "inherit", cursor: "pointer" }}>
          {/* Under the bar: only the picture fades; the words stay readable (readability audit 2026-10-28). */}
          {item.thumbUrl ? <img src={item.thumbUrl} alt="" style={{ width: "100%", aspectRatio: "9 / 16", objectFit: "cover", borderRadius: 6, opacity: reaction === "below" ? 0.45 : 1 }} />
            : <span style={{ width: "100%", aspectRatio: "9 / 16", borderRadius: 6, background: "var(--panel-2)", opacity: reaction === "below" ? 0.45 : 1 }} />}
          <span className="yp-muted" style={{ fontSize: 12 }}>{refPlatform(item.url)}{item.source === "pd" ? " · 직접 넣음" : ""}</span>
          <span style={{ fontSize: 13, lineHeight: 1.4 }}>{item.title || item.url}</span>
          {refCountsLine(counts) ? <span className="yp-muted" style={{ fontSize: 12 }}>{refCountsLine(counts)}</span> : null}
          <span>{reaction === "pass" ? <span className="yp-tag yp-ok">반응 높음</span> : reaction === "below" ? <span className="yp-tag yp-warn">기준 아래 · AI에 안 넘김</span>
            : <span className="yp-tag">숫자 없음</span>}{item.result && !item.result.ok ? <span className="yp-muted" style={{ fontSize: 12 }}> · 화면 못 받음</span> : null}</span>
        </button>;
    })}</div> : !working && !form.refs.length ? <p className="yp-pempty" style={{ padding: "18px 8px" }}>{can ? "키워드로 찾거나 링크를 넣어요" : "찾은 참고 영상이 없어요"}</p> : null}
    {/* The one opened: its first three seconds (the 헤드 카피) and its words, under the cards so the rows keep their places. */}
    {items.filter(item => item.url === open).map(item => <div key={item.url} style={{ display: "grid", gap: 6, fontSize: 12, marginTop: 10 }}>
          <b style={{ fontSize: 13 }}>{item.title || item.url}</b>
          {item.sheetUrl ? <><b>첫 3초 화면 (헤드 카피)</b><img src={item.sheetUrl} alt="첫 3초 화면" style={{ width: "100%", borderRadius: 6 }} /></> : null}
          {item.result?.transcript ? <div style={{ maxHeight: 200, overflow: "auto", lineHeight: 1.6 }}>{item.result.transcript.split("\n").map((line, at) => {
            const [, time, said] = line.match(/^(\d+(?:\.\d+)?) (.*)$/) ?? [null, null, line];
            return <div key={at}>{time !== null ? <span className="yp-muted" style={{ display: "inline-block", width: 38 }}>{`${Math.floor(Number(time) / 60)}:${String(Math.floor(Number(time) % 60)).padStart(2, "0")}`}</span> : null}{said}</div>;
          })}</div> : <span className="yp-muted">{item.result?.ok ? "대사가 없어요" : item.result?.error || "가져오지 못했어요"}</span>}
          <a className="yp-lnk" href={item.url} target="_blank" rel="noreferrer">영상 열기 →</a></div>)}
    {form.refs.length ? <><div className="yp-fld-h" style={{ marginTop: 12 }}><b>직접 넣은 링크</b></div>
      <ul className="yp-open-list" style={{ marginTop: 4 }}>{form.refs.map((ref, index) => <li key={`${ref.url}-${index}`}><a href={ref.url} target="_blank" rel="noreferrer" style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{refPlatform(ref.url)} · {ref.title || ref.url}</a>
        {refCountsLine({ views: ref.views ?? null, followers: ref.followers ?? null, likes: ref.likes ?? null }) ? <span className="yp-muted" style={{ fontSize: 12, flex: "none" }}>{refCountsLine({ views: ref.views ?? null, followers: ref.followers ?? null, likes: ref.likes ?? null })}</span> : null}
        {can ? <button type="button" className="yp-ib" aria-label="빼기" onClick={() => onEdit({ refs: form.refs.filter((_, at) => at !== index) }, true)}><X size={14} /></button> : null}</li>)}</ul></> : null}
    {can ? adding ? <form style={{ display: "grid", gap: 6, marginTop: 10 }} onSubmit={event => { event.preventDefault(); add(); }}>
      <input className="yp-in" placeholder="영상 주소" aria-label="링크 주소" value={link.url} autoFocus onChange={event => setLink({ ...link, url: event.target.value })} />
      <input className="yp-in" placeholder="제목 (선택)" aria-label="링크 제목" maxLength={200} value={link.title} onChange={event => setLink({ ...link, title: event.target.value })} />
      <textarea className="yp-in" rows={2} maxLength={5000} placeholder="영상에서 한 말 (선택) — 헤드 카피 · 첫 문장" aria-label="영상에서 한 말" value={link.script} onChange={event => setLink({ ...link, script: event.target.value })} />
      {/* A Reel the 영상 만드는 컴퓨터 cannot open is judged by the numbers on its page. */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: 6 }}>
        {([["views", "조회수"], ["likes", "좋아요"], ["followers", "팔로워"]] as const).map(([key, label]) => <input key={key} className="yp-in" inputMode="decimal" placeholder={`${label} (선택)`} aria-label={label}
          value={nums[key]} onChange={event => setNums({ ...nums, [key]: event.target.value })} />)}</div>
      <span className="yp-hint" style={{ margin: 0 }}>숫자는 화면 그대로 적어도 돼요(예: 12.5만). 영상 만드는 컴퓨터가 읽은 숫자가 있으면 그걸 써요.</span>
      <div className="yp-row-btns"><button type="submit" className="yp-btn yp-sm yp-pri">넣기</button><button type="button" className="yp-btn yp-sm" onClick={() => { setAdding(false); setLink(blankRef); }}>취소</button></div></form>
      : <div className="yp-row-btns" style={{ marginTop: 10, flexWrap: "wrap" }}>
        <button type="button" className="yp-btn yp-sm" onClick={() => setAdding(true)}><Plus size={14} /> 링크 넣기</button>
        <button type="button" className="yp-btn yp-sm" onClick={() => void copyAside("social")}><Copy size={14} /> {copied === "social" ? "복사했어요 · Aside에 붙여 넣기" : "릴스 · 틱톡 찾기 (Aside)"}</button>
        <button type="button" className="yp-btn yp-sm" onClick={() => void copyAside("ad")}><Copy size={14} /> {copied === "ad" ? "복사했어요 · Aside에 붙여 넣기" : "메타 광고 찾기 (Aside)"}</button></div> : null}
  </>;
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
    <YpSection n={1} title="숏폼 주제" gq="이 원고로 만들 숏폼은?" extra={items.length && !job.open ? <button type="button" className="yp-btn yp-sm" onClick={() => setSend(true)}><Sparkles size={14} /> 내 AI로 다시 뽑기</button> : null}>
      {job.open || job.status?.job?.status === "blocked" ? <JobLine job={job} onRetry={() => setSend(true)} /> : null}
      {items.length ? <ul className="yp-hist">{items.map(item => <li key={item.id} style={{ alignItems: "center", flexWrap: "wrap", gap: 10 }}>
        <span style={{ flex: "1 1 260px", minWidth: 0 }}><b>{item.insight}</b><br /><span className="yp-muted" style={{ fontSize: 13 }}>{item.scene}</span></span>
        {item.made ? <Link className="yp-btn yp-sm" href={stepHref(0, item.made.projectId)}>숏폼 열기 →</Link>
          : <button type="button" className="yp-btn yp-sm yp-pri" disabled={Boolean(making)} onClick={() => void make(item.id)}>{making === item.id ? "만드는 중…" : "숏폼 만들기"}</button>}
      </li>)}</ul>
        : job.open ? null : <div className="yp-ways" style={{ marginBottom: 0 }}><button type="button" className="yp-way yp-rec" onClick={() => setSend(true)}><b><Sparkles size={14} aria-hidden="true" /> 내 AI에게 맡기기</b><span>원고에서 숏폼 주제 3개를 뽑아요</span></button></div>}
    </YpSection>
    <SendDialog page={page} task="short-topics" open={send} onClose={() => setSend(false)} job={job} />
  </>;
}
