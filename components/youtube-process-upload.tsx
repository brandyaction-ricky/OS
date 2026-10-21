"use client";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { Check, Copy, ExternalLink, FileText, RefreshCw, Sparkles, Upload, Youtube } from "lucide-react";
import { apiRequest, uploadYoutubeFile } from "@/lib/api-client";
import type { ChannelConnection } from "@/lib/channel-types";
import { stepHref } from "@/lib/youtube-process/project";
import { descChecks, pinnedDraft, SLOTS, UTM_OPTIONS, utmUrl, type YpUpload } from "@/lib/youtube-process/stages";
import { JobLine, SendDialog, useStaffJob } from "./youtube-process-ai";
import { GateBanner, hhmm, LockedStep, stepAction, Subject, useYpBundle, YpFrame, YpSection } from "./youtube-process-frame";
import { YtCard } from "./youtube-process-media";

/** S7 업로드: UTM · SRT · 설명란 · 고정 댓글 (내 AI) · 공개 범위, then one [업로드] to YouTube (4-8 · 10-2). */
export function YoutubeUploadScreen({ header }: { header: ReactNode }) {
  const page = useYpBundle();
  const [form, setForm] = useState<YpUpload | null>(null);
  const [dirty, setDirty] = useState(false);
  const [savedAt, setSavedAt] = useState("");
  const [send, setSend] = useState(false);
  const [channels, setChannels] = useState<ChannelConnection[]>([]);
  const [owner, setOwner] = useState("");
  const [progress, setProgress] = useState<number | null>(null);
  const [step, setStep] = useState("");
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
      const result = await page.client.saveStage(project.id, "upload", upload.version, patch ?? { utm: next.utm, desc: next.desc, pinned: next.pinned, privacy: next.privacy });
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
    page.setError("");
    try {
      if (dirty) await save();
      setStep("영상을 준비하는 중"); setProgress(0);
      const url = await page.client.finalUrl(project.id, last);
      const response = url ? await fetch(url) : null;
      if (!response?.ok) throw new Error("OS에 저장된 최종본을 불러오지 못했어요.");
      const file = new File([await response.blob()], last.name || "final.mp4", { type: "video/mp4" });
      setStep("유튜브로 보내는 중");
      const session = await page.client.uploadSession(project.id, { fileName: file.name, fileSize: file.size, mimeType: file.type, ...(owner ? { connectionOwnerId: owner } : {}) });
      const video = await uploadYoutubeFile(session.uploadUrl, file, setProgress);
      setStep("결과를 기록하는 중");
      await page.client.uploadComplete(project.id, { videoId: video.id, ...(owner ? { connectionOwnerId: owner } : {}) });
      await page.reload(); setDirty(false);
    } catch (reason) { page.fail(reason); } finally { setProgress(null); setStep(""); }
  };
  const finish = async () => {
    if (!page.client || !project) return;
    try { const next = await page.client.move(project.id, "done", project.version); page.setBundle(current => current ? { ...current, project: next } : current); }
    catch (reason) { page.fail(reason); }
  };

  const reason = !form ? "" : !form.desc.trim() ? "설명란을 채워주세요" : !channels.length && !page.demo ? "유튜브 채널을 연결해 주세요" : "";
  const action = page.bundle ? stepAction(page, 5, done ? { kind: "button", label: "여기서 끝내기", onClick: () => void finish(), reason: project?.yp.stage === "done" ? "끝난 프로젝트예요" : "" }
    : { kind: "button", label: "업로드", reason, busy: progress !== null, onClick: () => void go() }) : null;
  const confirmed = page.bundle?.stages.plan.data.confirmed;
  const make = page.bundle?.stages.make.data;
  const checks = form ? descChecks(form.desc, { ...form, srt: form.srt ?? (myinSrt ? { path: "myin", name: "final.srt" } : null) }) : [];
  const aiDraftWaiting = Boolean(form?.descBy && form.desc !== form.descBy.draft);

  return <YpFrame page={page} view={5} action={action} header={header} title="업로드" sub={done ? "유튜브에 올렸어요. 쇼츠로 이어 가거나 여기서 끝내요." : "설명란을 채우고 [업로드]를 누르면 끝나요."} savedAt={savedAt}
    todo={form && !done ? [{ label: "설명란", done: Boolean(form.desc.trim()) }, { label: "유튜브 채널", done: page.demo || channels.length > 0 }] : undefined}
    onSave={editable ? () => void save() : undefined} saveDisabled={!dirty}>
    {page.bundle && form && project && make ? !["upload", "done", "shorts"].includes(project.yp.stage) ? <LockedStep page={page} name="업로드" /> : <div onBlur={() => { if (dirty) void save(); }}>
      {done ? <div className="yp-note yp-ok" role="status"><Check size={16} className="yp-i" aria-hidden="true" /><div><b>유튜브에 올렸어요</b> · {form.run?.thumbnail === "ok" ? "썸네일 A도 넣었어요" : form.run?.thumbnail === "fail" ? "썸네일은 유튜브 스튜디오에서 직접 넣어 주세요(채널 맞춤 썸네일 권한 확인)" : "썸네일은 스튜디오에서 넣어 주세요"} · 최종 검수 컨펌은 이제 되돌릴 수 없어요<br />
        {form.run?.videoUrl ? <a className="yp-lnk" href={form.run.videoUrl} target="_blank" rel="noreferrer">유튜브에서 보기 <ExternalLink size={12} /></a> : null}</div></div> : <GateBanner page={page} gate="review" />}
      <Subject page={page} />
      <div className="yp-wrap2"><div>
        <YpSection n={1} title="UTM 설정" need>
          <div className="yp-g2">
            {(["cat", "dest", "camp"] as const).map(key => <div key={key}><label className="yp-lbl" style={{ marginTop: 0 }}>{{ cat: "영상 카테고리", dest: "도착", camp: "캠페인" }[key]}{key === "dest" ? <span className="yp-gq">CTA 목적지 목록으로도 써요</span> : null}</label>
              <select className="yp-in" disabled={!editable} value={form.utm[key]} onChange={event => edit({ utm: { ...form.utm, [key]: event.target.value } }, true)} aria-label={key}>{UTM_OPTIONS[key].map(([value, text]) => <option key={value} value={value}>{text}</option>)}</select></div>)}
            <div><label className="yp-lbl" style={{ marginTop: 0 }}>이어서 볼 영상 <span className="yp-gq">유튜브 링크 붙여넣기</span></label><input className="yp-in" value={form.utm.next} readOnly={!editable} placeholder="예) https://youtu.be/…" onChange={event => edit({ utm: { ...form.utm, next: event.target.value } })} aria-label="이어서 볼 영상 링크" /></div>
          </div>
          <label className="yp-lbl">UTM 주소 <span className="yp-gq">시트 규칙 그대로 (utm_video_map)</span></label><div className="yp-utm">{utmUrl(form.utm, done ? `yp-${project.id.slice(0, 8)}` : undefined)}</div>
          <p className="yp-hint">utm_content는 업로드할 때 프로젝트 코드(yp-{project.id.slice(0, 8)})로 채워져요. 지금 유튜브 연결 권한으로는 올린 뒤 설명란을 고칠 수 없어서, 영상 ID 대신 이 코드를 써요.</p>
          <label className="yp-lbl">단축 링크 <span className="yp-gq">방식이 정해질 때까지 만들어서 붙여넣어요</span></label><input className="yp-in" value={form.utm.short} readOnly={!editable} placeholder="예) buly.kr/○○ 붙여넣기" onChange={event => edit({ utm: { ...form.utm, short: event.target.value } })} aria-label="단축 링크" />
        </YpSection>
        <YpSection n={2} title="SRT 자막">
          {myinSrt ? <div className="yp-drop yp-ok" style={{ padding: 12 }}><Check size={20} aria-hidden="true" /><b>OS가 만든 자막(SRT)을 그대로 써요</b><span style={{ fontSize: 12 }}>설명란 타임라인 시간도 이 자막 기준이에요 · 유튜브 자막은 업로드 뒤 스튜디오 › 자막에 올려요</span>
            <div className="yp-row-btns" style={{ justifyContent: "center" }}><a className="yp-btn yp-sm" href={myinSrt} target="_blank" rel="noreferrer">자막 파일 열기</a></div></div>
            : <div className={`yp-drop${form.srt ? " yp-ok" : ""}`} style={{ padding: 12 }}>{form.srt ? <Check size={20} aria-hidden="true" /> : <FileText size={20} aria-hidden="true" />}<b>{form.srt ? form.srt.name : "자막 SRT 파일"}</b><span style={{ fontSize: 12 }}>설명란 타임라인 시간은 SRT 기준이에요</span>
              {editable ? <div className="yp-row-btns" style={{ justifyContent: "center" }}><button type="button" className="yp-btn yp-sm" onClick={() => form.srt ? void save(form, { srt: null }) : srtInput.current?.click()}>{form.srt ? "빼기" : "파일 선택"}</button></div> : null}</div>}
          <input ref={srtInput} type="file" hidden accept=".srt,application/x-subrip" onChange={event => { const file = event.target.files?.[0]; event.target.value = ""; if (file) void uploadSrt(file); }} />
        </YpSection>
        <YpSection n={3} title="설명란 · 고정 댓글" gq="1 · 2번 기준 자동" need>
          {!form.desc.trim() && !aiDraftWaiting ? (job.open || job.status?.job?.status === "blocked" ? <JobLine job={job} onRetry={() => setSend(true)} /> : editable ? <div className="yp-ways">
            <button type="button" className="yp-way yp-rec" onClick={() => setSend(true)}><b><Sparkles size={14} aria-hidden="true" /> 내 AI에게 맡기기</b><span>{myinSrt || form.srt ? "자막(SRT) 시간으로" : "자막이 없어 타임라인은 자리표시로"} 설명란 · 고정 댓글 · 다른 채널 문안을 만들어 줘요</span></button>
            <button type="button" className="yp-way" onClick={() => edit({ desc: "#\n-----\n⬇️ \n-----\n[타임라인]\n00:00 \n-----\n[설명문 본문]\n\n-----\n[인용 및 출처]\n- \n-----\n[히든 태그]\n" })}><b>직접 쓰기</b><span>정해진 구역 순서가 들어간 칸에 바로 써요</span></button></div> : null) : <>
            <div className="yp-row-btns" style={{ margin: "0 0 6px" }}><button type="button" className="yp-btn yp-sm" onClick={() => void copy("desc", form.desc)}><Copy size={14} /> {copied === "desc" ? "복사됨" : "설명란 복사"}</button>
              {editable ? <button type="button" className="yp-btn yp-sm" onClick={() => setSend(true)}><RefreshCw size={14} /> 내 AI로 다시 만들기</button> : null}
              {form.descBy ? <span className="yp-aitag"><Sparkles size={11} aria-hidden="true" /> AI 초안 · {form.descBy.name}의 Claude</span> : null}</div>
            {job.open || job.status?.job?.status === "blocked" ? <JobLine job={job} onRetry={() => setSend(true)} /> : null}
            {aiDraftWaiting && editable ? <div className="yp-note yp-purple" role="status"><Sparkles size={16} className="yp-i" aria-hidden="true" /><div><b>AI 초안 도착</b> · 사람이 고친 설명란이 있어 바로 넣지 않았어요.
              <button type="button" className="yp-lnk" onClick={() => edit({ desc: form.descBy!.draft, ...(form.pinnedDraft ? { pinned: form.pinnedDraft } : {}) }, true)}>이 초안으로 바꾸기</button>
              <details><summary>초안 보기</summary><pre style={{ whiteSpace: "pre-wrap", fontSize: 12 }}>{form.descBy!.draft}</pre></details></div></div> : null}
            <textarea className="yp-in yp-desc" rows={16} readOnly={!editable} value={form.desc} onChange={event => edit({ desc: event.target.value })} aria-label="설명란" />
            <ul className="yp-chk2">{checks.map(check => <li key={check.text}><span className={check.ok ? "yp-o" : "yp-x"}>{check.ok ? "✓" : "⚠"}</span><span>{check.text}</span></li>)}</ul>
            <p className="yp-hint">순서 고정: 해시태그 → 진단 CTA → 타임라인 → 본문 5줄 → 인용 · 출처 → 히든 태그. 링크는 지어내지 않아요. 점검은 안내만 하고 업로드를 막지 않아요.</p>
            <label className="yp-lbl">태그 <span className="yp-gq">설명란 맨 끝 히든 태그가 유튜브 ‘태그’ 칸에 자동으로 들어가요</span></label>
            <div className="yp-chips">{form.hiddenTags.length ? form.hiddenTags.map(tag => <span key={tag} className="yp-tag">{tag}</span>) : <span className="yp-hint">없음</span>}</div>
            <label className="yp-lbl">고정 댓글<span style={{ flex: 1 }} /><button type="button" className="yp-btn yp-sm" onClick={() => void copy("pin", form.pinned || pinnedDraft(form.utm))}><Copy size={14} /> {copied === "pin" ? "복사됨" : "복사"}</button></label>
            <textarea className="yp-in yp-box yp-pin" rows={4} readOnly={!editable} value={form.pinned || pinnedDraft(form.utm)} onChange={event => edit({ pinned: event.target.value })} aria-label="고정 댓글" />
            <p className="yp-hint">유튜브 API에는 댓글 ‘고정’이 없어요. 올린 뒤 스튜디오에서 이 글을 댓글로 달고 고정해요.</p></>}
        </YpSection>
        {form.extras ? <YpSection title="다른 채널 문안 · 업로드 체크리스트" gq="설명란과 같은 내 AI 결과">
          <div className="yp-seg2 yp-sm" role="tablist" style={{ marginBottom: 8 }}>{([["kakao", "카카오톡"], ["cafe", "네이버 카페"], ["post", "게시글"]] as const).map(([key, label]) =>
            <button key={key} type="button" role="tab" aria-selected={extraTab === key} className={extraTab === key ? "yp-on" : ""} onClick={() => setExtraTab(key)}>{label}</button>)}</div>
          <div className="yp-box" style={{ whiteSpace: "pre-wrap", fontSize: 13, maxHeight: 260, overflow: "auto" }}>{form.extras[extraTab] || "없음"}</div>
          <div className="yp-row-btns" style={{ marginTop: 6 }}><button type="button" className="yp-btn yp-sm" disabled={!form.extras[extraTab]} onClick={() => void copy(extraTab, form.extras![extraTab])}><Copy size={14} /> {copied === extraTab ? "복사됨" : "복사"}</button></div>
          {form.extras.checklist.length ? <><label className="yp-lbl">업로드 체크리스트 <span className="yp-gq">올린 뒤 스튜디오에서 할 일 · 체크하면 저장돼요</span></label>
            <ul className="yp-chk2">{form.extras.checklist.map((item, index) => <li key={item}><label style={{ display: "flex", gap: 8, alignItems: "flex-start" }}>
              <input type="checkbox" checked={form.extras!.checked.includes(index)} disabled={project.yp.stage !== "upload"} onChange={event => {
                const checked = event.target.checked ? [...form.extras!.checked, index] : form.extras!.checked.filter(value => value !== index);
                setForm({ ...form, extras: { ...form.extras!, checked } }); void save(form, { checked });
              }} /><span>{item}</span></label></li>)}</ul></> : null}
        </YpSection> : null}
        <YpSection n={4} title="최종 화면" need={false}><p className="yp-hint" style={{ margin: 0 }}>유튜브 API로는 최종 화면을 넣을 수 없어요. 업로드 뒤 스튜디오 › 최종 화면에서 마지막 20초 안에 넣어요(구성안 클로징의 ‘마지막 20초’ 자리). 설정안 저장은 다음 차례에 들어와요.</p></YpSection>
        <YpSection n={5} title="공개 일정" need>
          <div className="yp-radio-row">{([["private", "비공개"], ["unlisted", "일부 공개"]] as const).map(([value, text]) => <label key={value} className={`yp-radio${form.privacy === value ? " yp-on" : ""}`}>
            <input type="radio" name="yp-privacy" checked={form.privacy === value} disabled={!editable} onChange={() => edit({ privacy: value }, true)} />{text}</label>)}
            {["바로 공개", "예약 공개"].map(text => <label key={text} className="yp-radio yp-dis-look" title="관리자 결정 대기"><input type="radio" disabled />{text}</label>)}</div>
          <p className="yp-hint">바로 공개 · 예약 공개는 구글 앱 검수 확인 뒤 열어요(관리자 결정 대기). 지금은 비공개나 일부 공개로 올린 뒤 스튜디오에서 공개해요.</p>
          {channels.length > 1 ? <label className="yp-lbl">올릴 채널<select className="yp-in" value={owner} onChange={event => setOwner(event.target.value)}>{channels.map(row => <option key={row.ownerId} value={row.ownerId}>{row.accountName}{row.teamShared ? " · 팀 공유" : " · 나만"}</option>)}</select></label> : null}
          <div style={{ marginTop: 12 }}>{channels.length ? <span className="yp-chan"><Youtube size={15} aria-hidden="true" /> 유튜브 채널 연결됨 · {channels.find(row => row.ownerId === owner)?.accountName}</span>
            : page.demo ? <span className="yp-hint">데모에서는 채널 연결이 없어요</span> : <span className="yp-hint">유튜브 채널이 연결되지 않았어요. <Link className="yp-lnk" href="/settings/account">내 계정 › 채널 연결</Link>에서 연결해요.</span>}</div>
        </YpSection>
        <section className="yp-upgo"><div className="yp-upgo-l"><b>올라갈 영상</b><span>{last ? `v${last.v} · ${last.source === "myin" ? "OS 자동 제작" : last.name} · 최종 검수에서 마지막 버전 (자동)` : "최종본이 없어요"}</span>
          {handouts.deck || handouts.summary ? <span style={{ fontSize: 12 }}>{handouts.deck ? <a className="yp-lnk" href={handouts.deck} target="_blank" rel="noreferrer">덱 PDF</a> : null}{handouts.deck && handouts.summary ? " · " : ""}{handouts.summary ? <a className="yp-lnk" href={handouts.summary} target="_blank" rel="noreferrer">한 장 정리 이미지</a> : null} — 설명란 · 고정 댓글 링크용 (공개 링크는 따로 만들어요)</span> : null}
          <span className="yp-muted" style={{ fontSize: 12 }}>[업로드]를 누르면 위 내용 그대로 유튜브에 올라가요. 컨펌된 제목 A{make.aTitle ? "(바꾼 제목)" : ""}와 썸네일 A가 들어가요. 화면을 닫으면 멈춰요.</span></div>
          <div className="yp-upgo-r">{done ? <><button type="button" className="yp-btn yp-lg" disabled><Check size={16} /> 업로드</button><small className="yp-upok">✓ 유튜브 업로드 완료</small></>
            : <><button type="button" className="yp-btn yp-pri yp-lg" disabled={Boolean(reason) || progress !== null || !editable} onClick={() => void go()}><Upload size={16} /> {progress !== null ? `${step} ${progress ? `${progress}%` : ""}` : "업로드"}</button>
              {reason ? <small className="yp-muted">{reason}</small> : null}</>}</div></section>
      </div>
      <aside className="yp-rside"><section className="yp-card"><div className="yp-card-h">제목 · 썸네일 테스트</div><div className="yp-card-b">
        {SLOTS.filter(slot => confirmed?.[slot]).map(slot => <div key={slot} className="yp-tst" style={{ marginBottom: 12 }}><div className="yp-abc-h" style={{ marginBottom: 6 }}><span className={`yp-ltag${slot === "C" ? " yp-c" : ""}`}>{slot}</span>{slot === "A" && make.aTitle ? <span className="yp-tag yp-warn">컨펌본과 다름</span> : null}</div>
          <YtCard page={page} thumb={confirmed?.[slot]?.thumb} path={make.thumbs[slot]?.path} title={slot === "A" && make.aTitle ? make.aTitle : confirmed?.[slot]?.title ?? ""} /></div>)}
        <p className="yp-hint">유튜브의 제목 · 썸네일 A/B 테스트는 API가 없어 스튜디오(컴퓨터)에서 해요. 위 시안을 그대로 넣어요. 제목 A는 최종 검수 전 <Link className="yp-lnk" href={stepHref(3, project.id)}>제작 › 최종 썸네일</Link>에서 바꿀 수 있어요.</p>
      </div></section></aside></div>
      <SendDialog page={page} task="kit" open={send} onClose={() => setSend(false)} job={job} />
    </div> : null}
  </YpFrame>;
}
