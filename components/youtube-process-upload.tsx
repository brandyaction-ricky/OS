"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { Check, Copy, ExternalLink, FileText, Plus, RefreshCw, Sparkles, Upload, X, Youtube } from "lucide-react";
import { apiRequest, uploadYoutubeFile } from "@/lib/api-client";
import { ENDSCREEN_CARD_DEFAULT, type EndscreenCard } from "@/lib/youtube-process/endscreen-card";
import type { ChannelConnection } from "@/lib/channel-types";
import { projectName, stepHref } from "@/lib/youtube-process/project";
import { DESC_TEMPLATE, descChecks, descWritten, diagnosisLink, finalPair, linksMissing, pinnedDraft, publishAtProblem, shortLinkProblem, SLOTS, UTM_DESTS, UTM_OPTIONS, utmBase, utmCode, utmUrl, withLinks, type YpMake, type YpUpload } from "@/lib/youtube-process/stages";
import { errorMessage } from "./youtube-process-data";
import { JobLine, SendDialog, useStaffJob, type SendTab } from "./youtube-process-ai";
import { draftTag, isGptModel } from "@/lib/youtube-process/gpt-draft";
import { CostTag } from "./cost-notice";
import { GateBanner, hhmm, LockedStep, stepAction, Subject, useYpBundle, YpFrame, YpSection, type YpPage } from "./youtube-process-frame";
import { ShortExportScreen } from "./youtube-process-short";
import { CardExportScreen } from "./youtube-process-card";
import { useAssetUrl, YtCard, type YpMediaSource } from "./youtube-process-media";

/** S7 업로드, or 내보내기 for a 숏폼 (download, no YouTube upload). */
export function YoutubeUploadScreen({ header }: { header: ReactNode }) {
  const page = useYpBundle();
  const kind = page.bundle?.project.yp.topic.type;
  return kind === "card" ? <CardExportScreen header={header} page={page} /> : kind === "short" ? <ShortExportScreen header={header} page={page} /> : <LongUploadScreen header={header} page={page} />;
}

/** S7 업로드: UTM · SRT · 설명란 · 고정 댓글 (내 AI) · 공개 범위, then one [업로드] to YouTube (4-8 · 10-2). */
function LongUploadScreen({ header, page }: { header: ReactNode; page: YpPage }) {
  const [form, setForm] = useState<YpUpload | null>(null);
  const [dirty, setDirty] = useState(false);
  const [savedAt, setSavedAt] = useState("");
  const [send, setSend] = useState<false | SendTab>(false);
  const [channels, setChannels] = useState<ChannelConnection[]>([]);
  const [owner, setOwner] = useState("");
  const [progress, setProgress] = useState<number | null>(null);
  const [bytes, setBytes] = useState<{ loaded: number; total: number; since: number } | null>(null);
  const [step, setStep] = useState("");
  // 로건 피드백 10/26-9: an upload failure showed only at the top of the page, far from the button that was pressed.
  const [goError, setGoError] = useState("");
  const [shortBusy, setShortBusy] = useState(false);
  const [shortError, setShortError] = useState("");
  const [copied, setCopied] = useState("");
  const [myinSrt, setMyinSrt] = useState<string | null>(null);
  const [handouts, setHandouts] = useState<{ deck: string | null; summary: string | null }>({ deck: null, summary: null });
  const [extraTab, setExtraTab] = useState<"kakao" | "cafe" | "post">("kakao");
  const srtInput = useRef<HTMLInputElement>(null);
  const editRev = useRef(0);
  const saving = useRef(false);
  const upload = page.bundle?.stages.upload;
  useEffect(() => { if (upload && !dirty) setForm(upload.data); }, [upload, dirty]);
  const project = page.bundle?.project;
  const finals = page.bundle?.finals ?? [];
  const last = finals.at(-1) ?? null;
  const done = form?.run?.status === "done";
  const editable = project?.yp.stage === "upload" && !done;
  const reloadAll = useCallback(() => { setDirty(false); void page.reload(); }, [page]);
  const job = useStaffJob(page, "kit", reloadAll);

  useEffect(() => {
    if (page.demo || !page.accessToken) return;
    apiRequest<{ connections: ChannelConnection[] }>("/api/v1/channels", { token: page.accessToken })
      .then(result => { const rows = result.connections.filter(row => row.platform === "youtube" && row.status === "connected"); setChannels(rows); setOwner(current => current || rows[0]?.ownerId || ""); }, () => setChannels([]));
  }, [page.demo, page.accessToken]);
  useEffect(() => {
    let active = true;
    if (!last?.runId || page.demo || !page.accessToken) { setMyinSrt(null); return; }
    apiRequest<{ srt: string | null; deck: string | null; summary: string | null }>(`/api/v1/content/youtube-automation/myin?outputs=${last.runId}`, { token: page.accessToken })
      .then(result => { if (active) { setMyinSrt(result.srt); setHandouts({ deck: result.deck, summary: result.summary }); } }, () => undefined);
    return () => { active = false; };
  }, [last?.runId, page.demo, page.accessToken]);

  const save = async (next: YpUpload | null = form, patch?: Record<string, unknown>) => {
    if (!page.client || !project || !upload || !next || saving.current) return;
    saving.current = true;
    const rev = editRev.current;
    try {
      const result = await page.client.saveStage(project.id, "upload", upload.version, patch ?? { utm: next.utm, desc: next.desc, pinned: next.pinned, privacy: next.privacy, publishAt: next.publishAt ?? null });
      page.setBundle(current => current ? { ...current, project: result.project, stages: { ...current.stages, upload: result.stage } } : current);
      setSavedAt(hhmm());
      if (editRev.current === rev) setDirty(false);
    } catch (reason) { page.fail(reason); } finally { saving.current = false; }
  };
  const edit = (patch: Partial<YpUpload>, now = false) => {
    editRev.current += 1;
    const next = { ...form!, ...patch };
    setForm(next); setDirty(true);
    if (now) void save(next);
  };
  const copy = async (key: string, value: string) => { await navigator.clipboard.writeText(value).catch(() => undefined); setCopied(key); window.setTimeout(() => setCopied(""), 1200); };
  const uploadSrt = async (file: File) => {
    if (!page.client || !project) return;
    try { const saved = await page.client.uploadAsset(project.id, "srt", file); await save(form, { srt: { path: saved.path, name: saved.name } }); }
    catch (reason) { page.fail(reason); }
  };
  const go = async () => {
    if (!page.client || !project || !last) return;
    page.setError(""); setGoError("");
    try {
      if (dirty) await save();
      setStep("영상을 준비하는 중"); setProgress(0);
      const url = await page.client.finalUrl(project.id, last);
      const response = url ? await fetch(url) : null;
      if (!response?.ok) throw new Error("저장된 최종본을 불러오지 못했어요.");
      const file = new File([await response.blob()], last.name || "final.mp4", { type: "video/mp4" });
      setStep("유튜브로 보내는 중");
      const session = await page.client.uploadSession(project.id, { fileName: file.name, fileSize: file.size, mimeType: file.type, ...(owner ? { connectionOwnerId: owner } : {}) });
      const since = Date.now();
      const video = await uploadYoutubeFile(session.uploadUrl, file, (percent, loaded, total) => { setProgress(percent); setBytes({ loaded, total, since }); });
      setStep("결과를 기록하는 중");
      await page.client.uploadComplete(project.id, { videoId: video.id, ...(owner ? { connectionOwnerId: owner } : {}) });
      await page.reload(); setDirty(false);
    } catch (reason) { page.fail(reason); setGoError(errorMessage(reason)); } finally { setProgress(null); setBytes(null); setStep(""); }
  };
  // 마이인 단축 링크 (owner decision 2026-10-26): the UTM address of this video, shortened on the MYIN site, straight into the field.
  const dest = form ? (form.utm.dest === "직접 입력" ? "직접 입력" : UTM_DESTS.find(([, url]) => url && url === utmBase(form.utm))?.[0] ?? "직접 입력") : "정밀 진단";
  const makeShort = async () => {
    if (!form || !project || !page.accessToken) return;
    setShortBusy(true); setShortError("");
    try {
      const made = await apiRequest<{ url: string }>("/api/v1/short-links", { method: "POST", token: page.accessToken, body: JSON.stringify({ url: utmUrl(form.utm, utmCode(project.id)), label: `유튜브 · ${projectName(project)}`.slice(0, 80) }) });
      edit({ utm: { ...form.utm, short: made.url } }, true);
    } catch (reason) { setShortError(errorMessage(reason)); } finally { setShortBusy(false); }
  };
  // After the upload the project moves on to 쇼츠 · 칼럼 (it ends there, with or without shorts and a column).
  const router = useRouter();
  const onward = async () => {
    if (!page.client || !project) return;
    try { const next = await page.client.move(project.id, "shorts", project.version); page.setBundle(current => current ? { ...current, project: next } : current); router.push(stepHref(6, project.id)); }
    catch (reason) { page.fail(reason); }
  };

  const reason = !form ? "" : !last ? "최종본이 없어요" : !descWritten(form.desc) ? "설명란을 채워 주세요" : !channels.length && !page.demo ? "유튜브 채널을 연결해 주세요"
    : publishAtProblem(form.publishAt) ? "예약 시각을 10분 뒤 이후로 정해 주세요" : "";
  const others = form?.utm.others ?? [];
  const setOthers = (list: { note: string; url: string }[], now = false) => edit({ utm: { ...form!.utm, others: list } }, now);
  const missing = form ? linksMissing(form.desc, form.utm) : [];
  const action = page.bundle ? stepAction(page, 5, done ? { kind: "button", label: "쇼츠 · 칼럼으로", onClick: () => void onward(), reason: project?.yp.stage === "done" ? "끝난 영상이에요" : "" }
    : { kind: "button", label: "유튜브에 올리기", reason, busy: progress !== null, onClick: () => void go() }) : null;
  const confirmed = page.bundle?.stages.plan.data.confirmed;
  const plan = { confirmed };
  const make = page.bundle?.stages.make.data;
  const checks = form ? descChecks(form.desc, { ...form, srt: form.srt ?? (myinSrt ? { path: "myin", name: "final.srt" } : null) }) : [];
  const aiDraftWaiting = Boolean(form?.descBy && form.desc !== form.descBy.draft);

  return <YpFrame page={page} view={5} action={action} header={header} title="업로드" sub={done ? "유튜브에 올렸어요. 이어서 쇼츠 · 칼럼을 만들어요." : "설명란을 채우고 유튜브에 올려요."} savedAt={savedAt}
    todo={form && !done ? [{ label: "최종본", done: Boolean(last) }, { label: "설명란", done: descWritten(form.desc) }, { label: "유튜브 채널", done: page.demo || channels.length > 0 }] : undefined}
    onSave={editable ? () => void save() : undefined} saveDisabled={!dirty}>
    {page.bundle && form && project && make ? !["upload", "done", "shorts"].includes(project.yp.stage) ? <LockedStep page={page} name="업로드" /> : <div onBlur={() => { if (dirty) void save(); }}>
      {done ? <div className="yp-note yp-ok" role="status"><Check size={16} className="yp-i" aria-hidden="true" /><div><b>유튜브에 올렸어요.</b> {form.run?.thumbnail === "ok" ? "썸네일 A도 넣었어요." : "썸네일은 스튜디오에서 넣어 주세요."}
        {form.run?.publishAt ? ` ${whenKo(form.run.publishAt)}에 공개돼요.` : ""}<br />
        {form.run?.privacy === "private" && !form.run.publishAt && form.privacy !== "private" ? <><b className="yp-warn-t">유튜브가 비공개로 올렸어요.</b> 스튜디오에서 공개 범위를 바꿔 주세요.<br /></> : null}
        <Processing page={page} owner={owner} />
        {form.run?.videoUrl ? <a className="yp-lnk" href={form.run.videoUrl} target="_blank" rel="noreferrer">유튜브에서 보기 <ExternalLink size={12} /></a> : null}</div></div> : <GateBanner page={page} gate="review" />}
      <Subject page={page} />
      <div className="yp-wrap2"><div>
        <YpSection n={1} title="UTM 설정" need>
          <div className="yp-g2">
            {/* 보낼 곳 (owner decision 2026-10-26): a MYIN mall page or any https address; changing it or the campaign drops the old 단축 링크. */}
            <div><label className="yp-lbl" style={{ marginTop: 0 }}>보낼 곳</label>
              <select className="yp-in" disabled={!editable} value={dest} aria-label="보낼 곳" onChange={event => {
                const preset = UTM_DESTS.find(([name]) => name === event.target.value);
                edit({ utm: { ...form.utm, dest: event.target.value, url: preset?.[1] ?? "", short: "" } }, true);
              }}>{UTM_DESTS.map(([name]) => <option key={name} value={name}>{name}</option>)}</select>
              {dest === "직접 입력" ? <input className="yp-in" style={{ marginTop: 6 }} value={form.utm.url ?? ""} readOnly={!editable} placeholder="https://로 시작하는 주소" aria-label="보낼 곳 주소"
                onChange={event => edit({ utm: { ...form.utm, url: event.target.value.trim(), short: "" } })} /> : null}</div>
            {(["cat", "camp"] as const).map(key => <div key={key}><label className="yp-lbl" style={{ marginTop: 0 }}>{{ cat: "영상 카테고리", camp: "캠페인" }[key]}</label>
              <select className="yp-in" disabled={!editable} value={form.utm[key]} onChange={event => edit({ utm: { ...form.utm, [key]: event.target.value, ...(key === "camp" ? { short: "" } : {}) } }, true)} aria-label={key}>{UTM_OPTIONS[key].map(([value, text]) => <option key={value} value={value}>{text}</option>)}</select></div>)}
          </div>
          <label className="yp-lbl">UTM 주소</label><div className="yp-utm">{utmUrl(form.utm, utmCode(project.id))}</div>
          <label className="yp-lbl">단축 링크 <span className="yp-gq">마이인 단축 링크로 만들어요</span></label>
          <div className="yp-savebar"><input className="yp-in" value={form.utm.short} readOnly={!editable} placeholder="[단축 링크 만들기]를 누르거나 붙여 넣어요" onChange={event => edit({ utm: { ...form.utm, short: event.target.value } })} aria-label="단축 링크" />
            {editable ? <button type="button" className="yp-btn" disabled={shortBusy || page.demo} title={page.demo ? "데모에서는 만들지 않아요" : undefined} onClick={() => void makeShort()}>{shortBusy ? "만드는 중…" : "단축 링크 만들기"}</button> : null}</div>
          {shortError ? <div className="yp-errline" role="alert">{shortError}</div> : null}
          {shortLinkProblem(form.utm.short) ? <div className="yp-errline" role="alert">{shortLinkProblem(form.utm.short)}</div> : null}
          {/* 로건 요청 10/30: each link with the line said above it in the description; they go in under the 진단 링크 automatically. */}
          <label className="yp-lbl">이어서 볼 영상 <span className="yp-gq">설명란 · 고정 댓글에 들어가요</span></label>
          <div className="yp-links"><input className="yp-in" value={form.utm.nextNote ?? ""} readOnly={!editable} maxLength={100} placeholder="이어서 보면 좋을 영상" onChange={event => edit({ utm: { ...form.utm, nextNote: event.target.value } })} aria-label="이어서 볼 영상 멘트" />
            <input className="yp-in" value={form.utm.next} readOnly={!editable} placeholder="https://youtu.be/…" onChange={event => edit({ utm: { ...form.utm, next: event.target.value.trim() } })} aria-label="이어서 볼 영상 링크" /></div>
          <label className="yp-lbl">다른 유입처 <span className="yp-gq">카페 · PPT 내려받기처럼 보낼 곳마다 멘트와 링크</span></label>
          {others.map((row, index) => <div key={index} className="yp-links" style={{ marginBottom: 6 }}>
            <input className="yp-in" value={row.note} readOnly={!editable} maxLength={100} placeholder="예) PPT는 카페에서 받아 가세요" onChange={event => setOthers(others.map((item, at) => at === index ? { ...item, note: event.target.value } : item))} aria-label={`유입처 ${index + 1} 멘트`} />
            <input className="yp-in" value={row.url} readOnly={!editable} placeholder="https://" onChange={event => setOthers(others.map((item, at) => at === index ? { ...item, url: event.target.value.trim() } : item))} aria-label={`유입처 ${index + 1} 링크`} />
            {editable ? <button type="button" className="yp-btn yp-sm" aria-label={`유입처 ${index + 1} 빼기`} onClick={() => setOthers(others.filter((_, at) => at !== index), true)}><X size={14} /></button> : null}</div>)}
          {editable && others.length < 5 ? <button type="button" className="yp-btn yp-sm" onClick={() => setOthers([...others, { note: "", url: "" }])}><Plus size={14} /> 유입처 추가</button> : !others.length ? <p className="yp-hint" style={{ margin: 0 }}>없음</p> : null}
        </YpSection>
        <YpSection n={2} title="자막(SRT)">
          {myinSrt ? <div className="yp-drop yp-ok" style={{ padding: 12 }}><Check size={20} aria-hidden="true" /><b>자동 제작 자막을 그대로 써요</b><span style={{ fontSize: 12 }}>유튜브 자막은 올린 뒤 스튜디오에서 넣어요.</span>
            <div className="yp-row-btns" style={{ justifyContent: "center" }}><a className="yp-btn yp-sm" href={myinSrt} target="_blank" rel="noreferrer">자막 파일 열기</a></div></div>
            : <div className={`yp-drop${form.srt ? " yp-ok" : ""}`} style={{ padding: 12 }}>{form.srt ? <Check size={20} aria-hidden="true" /> : <FileText size={20} aria-hidden="true" />}<b>{form.srt ? form.srt.name : "자막 파일"}</b><span style={{ fontSize: 12 }}>설명란 타임라인 시간은 이 자막 기준이에요</span>
              {editable ? <div className="yp-row-btns" style={{ justifyContent: "center" }}><button type="button" className="yp-btn yp-sm" onClick={() => form.srt ? void save(form, { srt: null }) : srtInput.current?.click()}>{form.srt ? "빼기" : "파일 올리기"}</button></div> : null}</div>}
          <input ref={srtInput} type="file" hidden accept=".srt,application/x-subrip" onChange={event => { const file = event.target.files?.[0]; event.target.value = ""; if (file) void uploadSrt(file); }} />
        </YpSection>
        <YpSection n={3} title="설명란 · 고정 댓글" need>
          {!form.desc.trim() && !aiDraftWaiting ? (job.open || job.status?.job?.status === "blocked" ? <JobLine job={job} onRetry={() => setSend(job.status?.job?.executor === "gpt" ? "gpt" : "queue")} /> : editable ? <div className="yp-ways">
            <button type="button" className="yp-way yp-rec" onClick={() => setSend("gpt")}><b><Sparkles size={14} aria-hidden="true" /> GPT로 바로 만들기</b><span>3~6분 · 설명란 · 고정 댓글 · 다른 채널 문안까지</span></button>
            <button type="button" className="yp-way" onClick={() => setSend("queue")}><b>내 AI에게 맡기기</b><span>내 AI 구독으로 만들어요</span></button>
            <button type="button" className="yp-way" onClick={() => edit({ desc: DESC_TEMPLATE })}><b>직접 쓰기</b><span>정해진 구역 순서가 들어간 칸에 바로 써요</span></button></div> : null) : <>
            <div className="yp-row-btns" style={{ margin: "0 0 6px" }}><button type="button" className="yp-btn yp-sm" onClick={() => void copy("desc", form.desc)}><Copy size={14} /> {copied === "desc" ? "복사됨" : "설명란 복사"}</button>
              {editable ? <button type="button" className="yp-btn yp-sm" onClick={() => setSend("gpt")}><RefreshCw size={14} /> 다시 만들기</button> : null}
              {form.descBy ? <span className="yp-aitag"><Sparkles size={11} aria-hidden="true" /> {draftTag(form.descBy.name, form.descBy.model)}</span> : null}</div>
            {job.open || job.status?.job?.status === "blocked" ? <JobLine job={job} onRetry={() => setSend(job.status?.job?.executor === "gpt" ? "gpt" : "queue")} /> : null}
            {aiDraftWaiting && editable ? <div className="yp-note yp-purple" role="status"><Sparkles size={16} className="yp-i" aria-hidden="true" /><div><b>{isGptModel(form.descBy?.model) ? "GPT 초안이 왔어요." : "AI 초안이 왔어요."}</b> 고친 설명란이 있어 바로 넣지 않았어요.
              <button type="button" className="yp-lnk" onClick={() => edit({ desc: form.descBy!.draft, ...(form.pinnedDraft ? { pinned: form.pinnedDraft } : {}) }, true)}>이 초안으로 바꾸기</button>
              <details><summary>초안 보기</summary><pre style={{ whiteSpace: "pre-wrap", fontSize: 12 }}>{form.descBy!.draft}</pre></details></div></div> : null}
            <textarea className="yp-in yp-desc" rows={16} readOnly={!editable} value={form.desc} onChange={event => edit({ desc: event.target.value })} aria-label="설명란" />
            <ul className="yp-chk2">{checks.map(check => <li key={check.text}><span className={check.ok ? "yp-o" : "yp-x"}>{check.ok ? "✓" : "⚠"}</span><span>{check.text}</span></li>)}</ul>
            {missing.length ? <p className="yp-hint"><span className="yp-warn-t">1번의 링크 {missing.length}개가 설명란에 없어요.</span> 올릴 때 진단 링크 아래에 자동으로 들어가요.
              {editable ? <> <button type="button" className="yp-lnk" onClick={() => edit({ desc: withLinks(form.desc, form.utm) }, true)}>지금 넣기</button></> : null}</p> : null}
            <p className="yp-hint">점검은 참고용이에요. 업로드를 막지 않아요.</p>
            <label className="yp-lbl">태그 <span className="yp-gq">히든 태그에서 자동으로</span></label>
            <div className="yp-chips">{form.hiddenTags.length ? form.hiddenTags.map(tag => <span key={tag} className="yp-tag">{tag}</span>) : <span className="yp-hint">없음</span>}</div>
            <label className="yp-lbl">고정 댓글<span style={{ flex: 1 }} /><button type="button" className="yp-btn yp-sm" onClick={() => void copy("pin", form.pinned || pinnedDraft(form.utm))}><Copy size={14} /> {copied === "pin" ? "복사됨" : "복사"}</button></label>
            <textarea className="yp-in yp-box yp-pin" rows={4} readOnly={!editable} value={form.pinned || pinnedDraft(form.utm)} onChange={event => edit({ pinned: event.target.value })} aria-label="고정 댓글" />
            <p className="yp-hint">올린 뒤 이 글을 댓글로 달고 고정해요.</p></>}
        </YpSection>
        {form.extras ? <YpSection title="다른 채널 문안 · 업로드 체크리스트">
          <div className="yp-seg2 yp-sm" role="tablist" style={{ marginBottom: 8 }}>{([["kakao", "카카오톡"], ["cafe", "네이버 카페"], ["post", "게시글"]] as const).map(([key, label]) =>
            <button key={key} type="button" role="tab" aria-selected={extraTab === key} className={extraTab === key ? "yp-on" : ""} onClick={() => setExtraTab(key)}>{label}</button>)}</div>
          <div className="yp-box" style={{ whiteSpace: "pre-wrap", fontSize: 13, maxHeight: 260, overflow: "auto" }}>{form.extras[extraTab] || "없음"}</div>
          <div className="yp-row-btns" style={{ marginTop: 6 }}><button type="button" className="yp-btn yp-sm" disabled={!form.extras[extraTab]} onClick={() => void copy(extraTab, form.extras![extraTab])}><Copy size={14} /> {copied === extraTab ? "복사됨" : "복사"}</button></div>
          {form.extras.checklist.length ? <><label className="yp-lbl">업로드 체크리스트 <span className="yp-gq">올린 뒤 할 일</span></label>
            <ul className="yp-chk2">{form.extras.checklist.map((item, index) => <li key={item}><label style={{ display: "flex", gap: 8, alignItems: "flex-start" }}>
              <input type="checkbox" checked={form.extras!.checked.includes(index)} disabled={project.yp.stage !== "upload"} onChange={event => {
                const checked = event.target.checked ? [...form.extras!.checked, index] : form.extras!.checked.filter(value => value !== index);
                setForm({ ...form, extras: { ...form.extras!, checked } }); void save(form, { checked });
              }} /><span>{item}</span></label></li>)}</ul></> : null}
        </YpSection> : null}
        <YpSection n={4} title="최종 화면" need={false}><Endscreen page={page} utm={form.utm} code={utmCode(project.id)} videoId={form.run?.videoId} copy={copy} copied={copied} /></YpSection>
        <YpSection n={5} title="공개 범위" need>
          {/* 로건 요청 10/30: YouTube's own choices; 예약 goes up private and YouTube makes it public at that time. */}
          <div className="yp-radio-row">{([["private", "비공개"], ["unlisted", "일부 공개"], ["public", "공개"], ["schedule", "예약"]] as const).map(([value, text]) => {
            const on = value === "schedule" ? Boolean(form.publishAt) : !form.publishAt && form.privacy === value;
            return <label key={value} className={`yp-radio${on ? " yp-on" : ""}`}>
              <input type="radio" name="yp-privacy" checked={on} disabled={!editable} onChange={() => edit(value === "schedule" ? { privacy: "private", publishAt: form.publishAt || tomorrowSix() } : { privacy: value, publishAt: null }, true)} />{text}</label>; })}</div>
          {form.publishAt ? <label className="yp-lbl">공개할 때 <span className="yp-gq">한국 시간 · 비공개로 올라가고 이 시각에 공개돼요</span>
            <input className="yp-in yp-w-auto" type="datetime-local" value={localInput(form.publishAt)} readOnly={!editable} onChange={event => { const at = new Date(event.target.value); if (!Number.isNaN(at.getTime())) edit({ publishAt: at.toISOString() }, true); }} aria-label="공개 예약 시각" /></label> : null}
          {form.privacy === "public" && !form.publishAt ? <p className="yp-hint">올리자마자 모두에게 보여요.</p> : null}
          {channels.length > 1 ? <label className="yp-lbl">올릴 채널<select className="yp-in" value={owner} onChange={event => setOwner(event.target.value)}>{channels.map(row => <option key={row.ownerId} value={row.ownerId}>{row.accountName}{row.teamShared ? " · 팀 공유" : " · 나만"}</option>)}</select></label> : null}
          <div style={{ marginTop: 12 }}>{channels.length ? <span className="yp-chan"><Youtube size={15} aria-hidden="true" /> 유튜브 채널 연결됨 · {channels.find(row => row.ownerId === owner)?.accountName}</span>
            : page.demo ? <span className="yp-hint">데모에서는 채널 연결이 없어요</span> : <span className="yp-hint">유튜브 채널이 연결되지 않았어요. <Link className="yp-lnk" href="/settings/account">내 계정 › 채널 연결</Link>에서 연결해요.</span>}</div>
        </YpSection>
        <section className="yp-upgo"><div className="yp-upgo-l"><b>올라갈 영상</b><span>{last ? `v${last.v} · ${last.source === "myin" ? "자동 제작" : last.name}${project?.yp.gates.review.decidedAt && last.at > project.yp.gates.review.decidedAt ? " · 컨펌 뒤 올린 버전" : ""}` : "최종본이 없어요"}</span>
          {handouts.deck || handouts.summary ? <span style={{ fontSize: 12 }}>{handouts.deck ? <a className="yp-lnk" href={handouts.deck} target="_blank" rel="noreferrer">덱 PDF</a> : null}{handouts.deck && handouts.summary ? " · " : ""}{handouts.summary ? <a className="yp-lnk" href={handouts.summary} target="_blank" rel="noreferrer">한 장 정리 이미지</a> : null}</span> : null}
          <span className="yp-muted" style={{ fontSize: 12 }}>제목 A{finalPair(plan, make, "A")?.changed ? "(제작에서 바꾼 것)" : ""} · 썸네일 A로 올라가요. 다 올라갈 때까지 화면을 닫지 마세요.</span></div>
          <div className="yp-upgo-r">{done ? <><button type="button" className="yp-btn yp-lg" disabled><Check size={16} /> 유튜브에 올리기</button><small className="yp-upok">✓ 올렸어요</small></>
            : <><button type="button" className="yp-btn yp-pri yp-lg" disabled={Boolean(reason) || progress !== null || !editable} onClick={() => void go()}><Upload size={16} /> {progress !== null ? `${step} ${progress ? `${progress}%` : ""}` : "유튜브에 올리기"}</button>
              {goError ? <small className="yp-errline" role="alert">올리지 못했어요: {goError}</small> : reason ? <small className="yp-errline">{reason}</small> : <CostTag kind="youtube" />}</>}</div>
          {progress !== null ? <div className="yp-gauge" role="status"><progress max={100} value={bytes ? progress : undefined} aria-label="유튜브로 보내는 진행률" />
            <small>{bytes ? `${progress}% · ${mb(bytes.loaded)} / ${mb(bytes.total)}${left(bytes) ? ` · 남은 시간 ${left(bytes)}` : ""}` : `${step}…`}</small></div> : null}</section>
      </div>
      <aside className="yp-rside"><section className="yp-card"><div className="yp-card-h">제목 · 썸네일 테스트</div><div className="yp-card-b">
        {SLOTS.filter(slot => confirmed?.[slot]).map(slot => <div key={slot} className="yp-tst" style={{ marginBottom: 12 }}><div className="yp-abc-h" style={{ marginBottom: 6 }}><span className={`yp-ltag${slot === "C" ? " yp-c" : ""}`}>{slot}</span>{finalPair(plan, make, slot)?.changed ? <span className="yp-tag yp-warn">컨펌본과 다름</span> : null}</div>
          <YtCard page={page} thumb={finalPair(plan, make, slot)?.thumb} path={make.thumbs[slot]?.path} title={finalPair(plan, make, slot)?.title ?? ""} /></div>)}
        {/* 로건 요청 10/30: YouTube offers no API for 테스트 및 비교, so the OS names the kind of test and hands over the B · C files. */}
        {testKind(plan, make) ? <p className="yp-hint">올린 뒤 스튜디오(PC) › 테스트 및 비교에서 <b>「{testKind(plan, make)}」</b> 방식으로 걸어요.
          {SLOTS.filter(slot => slot !== "A" && confirmed?.[slot] && make.thumbs[slot]?.path).map(slot => <ThumbFile key={slot} page={page} slot={slot} path={make.thumbs[slot]!.path} />)}</p> : null}
        <p className="yp-hint">유튜브는 테스트를 API로 받지 않아서 직접 걸어야 해요. 제목 · 썸네일 문구는 최종 검토 전 <Link className="yp-lnk" href={stepHref(3, project.id)}>제작 › 최종 썸네일</Link>에서 바꿀 수 있어요.</p>
      </div></section></aside></div>
      <SendDialog page={page} task="kit" open={Boolean(send)} initialTab={send || undefined} onClose={() => setSend(false)} job={job} />
    </div> : null}
  </YpFrame>;
}

const mb = (value: number) => value >= 1e9 ? `${(value / 1e9).toFixed(1)}GB` : `${Math.round(value / 1e6)}MB`;
/** Time left at the speed so far, once there is enough to tell. */
function left(bytes: { loaded: number; total: number; since: number }) {
  const spent = (Date.now() - bytes.since) / 1000;
  if (spent < 3 || !bytes.loaded) return "";
  const seconds = Math.round((bytes.total - bytes.loaded) / (bytes.loaded / spent));
  return seconds >= 60 ? `약 ${Math.ceil(seconds / 60)}분` : `약 ${seconds}초`;
}
const pad = (value: number) => String(value).padStart(2, "0");
const localInput = (iso: string) => { const at = new Date(iso); return `${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())}T${pad(at.getHours())}:${pad(at.getMinutes())}`; };
const tomorrowSix = () => { const at = new Date(); at.setDate(at.getDate() + 1); at.setHours(18, 0, 0, 0); return at.toISOString(); };
const whenKo = (iso: string) => { const at = new Date(iso); return `${at.getMonth() + 1}/${at.getDate()} (${"일월화수목금토"[at.getDay()]}) ${pad(at.getHours())}:${pad(at.getMinutes())}`; };

/** Which 테스트 및 비교 the confirmed A · B · C make: titles, thumbnails or both differ. */
function testKind(plan: Parameters<typeof finalPair>[0], make: YpMake) {
  const pairs = SLOTS.map(slot => finalPair(plan, make, slot)).filter(Boolean);
  if (pairs.length < 2) return "";
  const titles = new Set(pairs.map(pair => pair!.title.trim())).size > 1;
  const thumbs = new Set(SLOTS.filter(slot => plan.confirmed?.[slot]).map(slot => make.thumbs[slot]?.path ?? slot)).size > 1;
  return titles && thumbs ? "제목과 썸네일" : thumbs ? "썸네일만" : titles ? "제목만" : "";
}
function ThumbFile({ page, slot, path }: { page: YpMediaSource; slot: string; path: string }) {
  const url = useAssetUrl(page, path);
  return url ? <> <a className="yp-lnk" href={url} target="_blank" rel="noreferrer" download>썸네일 {slot} 파일</a></> : null;
}

/** YouTube's processing after the upload, read every 15 seconds while it is still going and the page is open. */
function Processing({ page, owner }: { page: YpPage; owner: string }) {
  const [state, setState] = useState<{ processing: string; percent: number | null } | null>(null);
  const id = page.bundle?.project.id, client = page.client;
  useEffect(() => {
    if (!id || !client) return;
    let active = true, tries = 0, timer = 0;
    const read = () => client.uploadStatus(id, owner ? { connectionOwnerId: owner } : {}).then(next => {
      if (!active) return;
      setState(next);
      if (next.processing === "processing" && ++tries < 120) timer = window.setTimeout(read, 15_000);
    }, () => undefined);
    void read();
    return () => { active = false; window.clearTimeout(timer); };
  }, [id, client, owner]);
  if (!state?.processing) return null;
  const text = state.processing === "processing" ? `유튜브가 처리하는 중이에요${state.percent !== null ? ` ${state.percent}%` : ""}.`
    : state.processing === "succeeded" ? "유튜브 처리도 끝났어요." : state.processing === "uploaded" ? "유튜브가 처리를 시작하기 전이에요." : "유튜브 처리에 문제가 있어요. 스튜디오에서 확인해 주세요.";
  return <>{text}<br /></>;
}

const youtubeId = (link: string) => link.match(/(?:youtu\.be\/|[?&]v=|\/shorts\/)([A-Za-z0-9_-]{11})/)?.[1] ?? "";

/**
 * 최종 화면 (로건 요청 10/30): YouTube takes end screens only in Studio, so this shows what goes there — the 이어서 볼 영상
 * on the left, the company 진단 카드 (링크관리) on the right — with each value to copy and a way into Studio.
 */
function Endscreen({ page, utm, code, videoId, copy, copied }: { page: YpPage; utm: YpUpload["utm"]; code: string; videoId?: string; copy: (key: string, value: string) => void; copied: string }) {
  const [card, setCard] = useState<EndscreenCard | null>(null);
  useEffect(() => {
    if (page.demo || !page.accessToken) { setCard(ENDSCREEN_CARD_DEFAULT); return; }
    apiRequest<{ card: EndscreenCard }>("/api/v1/content/youtube/endscreen-card", { token: page.accessToken }).then(result => setCard(result.card), () => setCard(ENDSCREEN_CARD_DEFAULT));
  }, [page.demo, page.accessToken]);
  if (!card) return null;
  const next = youtubeId(utm.next), link = card.link || diagnosisLink(utm, code);
  const rows: [string, string, string][] = [["video", "동영상 요소", utm.next], ["link", "링크 요소", link], ["name", "맞춤 메시지", card.name], ["cta", "클릭 유도문", card.cta]];
  return <>
    <div className="yp-endscreen" aria-label="최종 화면 미리보기">
      <div className="yp-es-video" style={next ? { backgroundImage: `url(https://i.ytimg.com/vi/${next}/mqdefault.jpg)` } : undefined}>{next ? null : <span>이어서 볼 영상</span>}</div>
      <div className="yp-es-link">{card.image ? <span className="yp-es-img" style={{ backgroundImage: `url(${card.image})` }} /> : <span className="yp-es-img" />}<b>{card.name || "진단명"}</b><small>{card.cta || "자세히 알아보기"}</small></div>
    </div>
    <ul className="yp-es-rows">{rows.map(([key, label, value]) => <li key={key}><span className="yp-muted">{label}</span><span className="yp-es-v">{value || <span className="yp-warn-t">비어 있어요</span>}</span>
      {value ? <button type="button" className="yp-btn yp-sm" onClick={() => void copy(`es-${key}`, value)}><Copy size={12} /> {copied === `es-${key}` ? "복사됨" : "복사"}</button> : null}</li>)}
      {card.image ? <li><span className="yp-muted">링크 이미지</span><span className="yp-es-v"><a className="yp-lnk" href={card.image} download="진단-썸네일">진단 썸네일 내려받기</a></span></li> : null}</ul>
    {!card.name || !card.image ? <p className="yp-hint">진단 카드가 비어 있어요. <Link className="yp-lnk" href="/content/links">링크관리 › 최종 화면 진단 카드</Link>에서 한 번만 채우면 모든 영상에 보여요.</p> : null}
    <p className="yp-hint" style={{ margin: 0 }}>유튜브는 최종 화면을 API로 받지 않아서 올린 뒤 스튜디오에서 마지막 20초에 넣어요. 스튜디오의 「동영상에서 가져오기」로 지난 영상의 최종 화면을 가져온 뒤 동영상 요소만 바꾸면 빨라요.
      {videoId ? <> <a className="yp-lnk" href={`https://studio.youtube.com/video/${videoId}/edit`} target="_blank" rel="noreferrer">스튜디오에서 열기 <ExternalLink size={12} /></a></> : null}</p>
  </>;
}
