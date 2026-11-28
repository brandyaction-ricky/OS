"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { useSearchParams } from "next/navigation";
import { ArrowDownToLine, Film, Image as ImageIcon, Sparkles, Upload, X } from "lucide-react";
import { apiRequest } from "@/lib/api-client";
import {
  AD_REFERENCE_MAX, AD_SOURCE_SIZES, adScriptScenes, adSourceInputSchema, adSourcePlan, adSourceTitle,
  type AdSourceAspect, type AdSourceBundle, type AdSourceInput, type AdSourceMode, type AdSourceRow,
} from "@/lib/ad-source-studio";
import { useSession } from "./session-provider";
import "./ad-source-studio.css";

const endpoint = "/api/v1/content/ad-sources";
function ReferencePreview({ file, remove }: { file: File; remove: () => void }) {
  const [url, setUrl] = useState("");
  useEffect(() => { const next = URL.createObjectURL(file); setUrl(next); return () => URL.revokeObjectURL(next); }, [file]);
  return <div className="ad-studio-reference">
    {/* Local uploaded images and private signed URLs cannot use the public Next image optimizer. */}
    {/* eslint-disable-next-line @next/next/no-img-element */}
    {url && <img src={url} alt={`참고 이미지: ${file.name}`} />}
    <span>{file.name}</span><button type="button" aria-label={`${file.name} 빼기`} onClick={remove}><X size={14} /></button>
  </div>;
}
function saveDownload(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob), link = document.createElement("a");
  link.href = url; link.download = name; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
}

export function AdSourceStudio() {
  const { demo, accessToken } = useSession();
  const search = useSearchParams();
  const sourceId = search.get("source");
  const [mode, setMode] = useState<AdSourceMode>("image");
  const [aspect, setAspect] = useState<AdSourceAspect>("4:5");
  const [message, setMessage] = useState(""), [appeal, setAppeal] = useState(""), [audience, setAudience] = useState("");
  const [count, setCount] = useState(3), [script, setScript] = useState(""), [style, setStyle] = useState("");
  const [visuals, setVisuals] = useState<string[]>([]), [files, setFiles] = useState<File[]>([]);
  const [project, setProject] = useState<AdSourceBundle | null>(null), [recent, setRecent] = useState<AdSourceRow[]>([]);
  const [busy, setBusy] = useState(false), [opening, setOpening] = useState(false), [downloading, setDownloading] = useState(false);
  const [error, setError] = useState(""), [listError, setListError] = useState(""), [status, setStatus] = useState("");
  const [listRevision, setListRevision] = useState(0), [readRevision, setReadRevision] = useState(0);
  const [stopping, setStopping] = useState(false);
  const running = useRef(false), stop = useRef(false), mounted = useRef(true), current = useRef(project);
  const resultHeading = useRef<HTMLHeadingElement>(null);
  current.current = project;
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; stop.current = true; }; }, []);
  useEffect(() => {
    if (demo || !accessToken) return;
    const abort = new AbortController();
    void apiRequest<{ projects: AdSourceRow[] }>(endpoint, { token: accessToken, signal: abort.signal })
      .then(result => { if (!abort.signal.aborted) { setRecent(result.projects); setListError(""); } })
      .catch(e => { if (!abort.signal.aborted) setListError(e.message); });
    return () => abort.abort();
  }, [demo, accessToken, listRevision]);
  useEffect(() => {
    if (!sourceId || demo || !accessToken || current.current?.id === sourceId && !readRevision) return;
    const abort = new AbortController();
    setOpening(true); setError("");
    void apiRequest<AdSourceBundle>(`${endpoint}/${sourceId}`, { token: accessToken, signal: abort.signal })
      .then(result => { if (!abort.signal.aborted) { current.current = result; setProject(result); } })
      .catch(e => { if (!abort.signal.aborted) setError(e.message); })
      .finally(() => { if (!abort.signal.aborted) setOpening(false); });
    return () => abort.abort();
  }, [sourceId, demo, accessToken, readRevision]);
  // Recover a request that continued on the server after navigation or a network interruption.
  const active = Boolean(project?.activeUntil);
  const projectId = project?.id;
  useEffect(() => {
    if (!projectId) return;
    resultHeading.current?.focus({ preventScroll: true });
    resultHeading.current?.scrollIntoView({ block: "start" });
  }, [projectId]);
  useEffect(() => {
    if (!active || busy || demo || !accessToken || !projectId) return;
    let disposed = false;
    let timer: ReturnType<typeof setTimeout>;
    const id = projectId;
    async function poll() {
      try {
        const next = await apiRequest<AdSourceBundle>(`${endpoint}/${id}`, { token: accessToken });
        if (disposed) return;
        current.current = next; setProject(next); setError("");
        if (!next.activeUntil) { setListRevision(n => n + 1); return; }
      } catch { if (!disposed) setError("진행 상태를 확인하지 못했어요. 연결을 확인하거나 다시 불러와 주세요."); }
      if (!disposed) timer = setTimeout(poll, 4000);
    }
    timer = setTimeout(poll, 3000);
    return () => { disposed = true; clearTimeout(timer); };
  }, [active, busy, demo, accessToken, projectId]);

  const scenes = adScriptScenes(script);
  function selectMode(next: AdSourceMode) { setMode(next); setAspect(next === "video" ? "9:16" : "4:5"); setError(""); }
  function setLocation(id: string | null) {
    const url = new URL(window.location.href);
    if (id) url.searchParams.set("source", id); else url.searchParams.delete("source");
    // This is client-only selection. Persist it before generation so an immediate
    // refresh resumes the saved request without waiting for a server navigation.
    window.history.replaceState(null, "", `${url.pathname}${url.search}${url.hash}`);
  }
  function remember(next: AdSourceBundle | null) { current.current = next; if (mounted.current) setProject(next); }
  function chooseFiles(picked: FileList | null, limit = 3) {
    if (!picked) return;
    const values = Array.from(picked);
    if (values.some(file => !["image/png", "image/jpeg"].includes(file.type) || file.size < 1 || file.size > AD_REFERENCE_MAX)) {
      setError("참고 이미지는 한 장에 3MB 이하인 PNG 또는 JPG로 선택해 주세요."); return;
    }
    if (files.length + values.length > limit) { setError(`참고 이미지는 ${limit}장까지 선택할 수 있어요.`); return; }
    setError(""); setFiles(previous => [...previous, ...values]);
  }
  function buildInput(): AdSourceInput {
    return adSourceInputSchema.parse(mode === "image"
      ? { mode, aspect, audience, message, appeal, count, referenceCount: files.length }
      : { mode, aspect, audience, script, style, visuals: scenes.map((_, i) => visuals[i] || ""), referenceCount: files.length });
  }
  async function uploadReferences(start: AdSourceBundle, selected: File[]) {
    let next = start;
    for (const file of selected) {
      setStatus(`참고 이미지 올리는 중 · ${next.references.length + 1}/${next.input.referenceCount}`);
      const form = new FormData(); form.set("file", file); form.set("version", String(next.version));
      next = await apiRequest<AdSourceBundle>(`${endpoint}/${next.id}/references`, { method: "POST", token: accessToken, body: form });
      remember(next);
      setFiles(previous => previous.filter(value => value !== file));
    }
    return next;
  }
  async function generateRemaining(start: AdSourceBundle, only?: string) {
    let next = start;
    for (const item of start.items.filter(row => row.status !== "done" && (!only || row.id === only))) {
      if (stop.current || !mounted.current) break;
      if (item.attempts >= 3) continue;
      setStatus(`${item.label} 만드는 중 · ${next.items.filter(row => row.status === "done").length}/${next.items.length} 완료`);
      remember({ ...next, activeUntil: Date.now() + 6 * 60_000,
        items: next.items.map(row => row.id === item.id ? { ...row, status: "generating", error: undefined } : row) });
      next = await apiRequest<AdSourceBundle>(`${endpoint}/${next.id}/generate`, { method: "POST", token: accessToken,
        body: JSON.stringify({ version: next.version, itemId: item.id }) });
      remember(next);
    }
    setStatus(stop.current ? "현재 요청까지 저장했어요. 남은 소재는 이어서 만들 수 있어요." : "요청한 소재를 저장했어요.");
  }
  async function run(task: () => Promise<void>) {
    if (running.current) return;
    running.current = true; stop.current = false; setStopping(false); setBusy(true); setError("");
    try { await task(); }
    catch (e) {
      setError(e instanceof Error ? e.message : "소재를 만들지 못했어요."); setStatus("완료된 소재는 보관했어요. 상태를 확인한 뒤 이어서 만들어 주세요.");
      if (current.current && !demo) {
        try { remember(await apiRequest<AdSourceBundle>(`${endpoint}/${current.current.id}`, { token: accessToken })); }
        catch { setError("작업 상태를 확인하지 못했어요. 다시 불러온 뒤 이어서 만들어 주세요."); }
      }
    } finally { running.current = false; if (mounted.current) { setBusy(false); setListRevision(n => n + 1); } }
  }
  function submit(event: FormEvent) {
    event.preventDefault();
    let input: AdSourceInput;
    try { input = buildInput(); }
    catch { setError(mode === "image" ? "메시지와 소구를 입력하고 소재 수를 확인해 주세요." : "스크립트를 한 줄에 한 장면씩, 최대 12장면으로 입력해 주세요."); return; }
    if (demo) {
      remember({ id: "demo", title: adSourceTitle(input), input, version: 1, references: [], items: adSourcePlan(input), activeUntil: null, updatedAt: new Date().toISOString() });
      setStatus("데모에서는 구성만 확인할 수 있어요. 실제 이미지는 로그인 및 이미지 생성 연결 후 만들어집니다."); return;
    }
    void run(async () => {
      setStatus("제작 요청을 저장하고 있어요.");
      const created = await apiRequest<AdSourceBundle>(endpoint, { method: "POST", token: accessToken, body: JSON.stringify(input) });
      remember(created); setLocation(created.id);
      await generateRemaining(await uploadReferences(created, files));
    });
  }
  function fresh(copy = false) {
    if (project && copy) {
      const input = project.input;
      setMode(input.mode); setAspect(input.aspect); setAudience(input.audience);
      if (input.mode === "image") { setMessage(input.message); setAppeal(input.appeal); setCount(input.count); }
      else { setScript(input.script); setStyle(input.style); setVisuals(input.visuals); }
    } else {
      setMode("image"); setAspect("4:5"); setAudience(""); setMessage(""); setAppeal(""); setCount(3); setScript(""); setStyle(""); setVisuals([]);
    }
    setFiles([]); remember(null); setLocation(null); setError(""); setStatus(copy && project?.references.length ? "참고 이미지는 다시 선택해 주세요." : ""); setReadRevision(0);
  }
  async function download(itemId?: string) {
    if (!project || downloading) return;
    setDownloading(true); setError("");
    try {
      // Refresh short-lived URLs before download, even when the editor has been open for hours.
      const latest = await apiRequest<AdSourceBundle>(`${endpoint}/${project.id}`, { token: accessToken });
      remember(latest);
      const done = latest.items.filter(item => item.status === "done" && item.asset?.url && (!itemId || item.id === itemId));
      const images = await Promise.all(done.map(async item => {
        const response = await fetch(item.asset!.url!);
        if (!response.ok) throw new Error("이미지를 내려받지 못했어요. 다시 시도해 주세요.");
        return { name: `${item.id}.png`, blob: await response.blob() };
      }));
      if (itemId && images[0]) saveDownload(images[0].blob, images[0].name);
      else if (images.length) {
        const { default: JSZip } = await import("jszip"), zip = new JSZip();
        for (const image of images) zip.file(image.name, image.blob);
        zip.file("scene-guide.txt", latest.items.map(item => `${item.label}\n${item.narration}\n화면: ${item.direction}\n파일: ${item.status === "done" ? item.id + ".png" : "미완료"}`).join("\n\n"));
        saveDownload(await zip.generateAsync({ type: "blob" }), latest.input.mode === "video" ? "video-scene-sources.zip" : "ad-image-drafts.zip");
      }
    } catch (e) { setError((e as Error).message); }
    finally { setDownloading(false); }
  }
  const working = busy || opening || active;
  const completed = project?.items.filter(item => item.status === "done").length ?? 0;
  const missingRefs = project ? project.input.referenceCount - project.references.length : 0;
  const retryable = project?.items.some(item => item.status !== "done" && item.attempts < 3);
  return <section className="ad-studio" aria-label="광고 소재 만들기">
    <div className="ad-studio-heading"><div><span className="ad-studio-eyebrow">광고 소재 만들기</span><h2 ref={resultHeading} tabIndex={project ? -1 : undefined}>{project ? demo ? "소재 구성 확인" : "만든 소재 확인하기" : "어떤 소재가 필요한가요?"}</h2>
      <p>{project ? demo ? "장면과 제작 방향을 확인하세요. 실제 이미지는 아직 생성되지 않았습니다." : "저장된 결과를 비교하고 필요한 소재를 내려받으세요." : "참고 이미지와 전달할 내용을 넣으면, 바로 제작을 시작할 수 있어요."}</p></div>
      {project && <button className="yp-btn" disabled={working} onClick={() => fresh()}>새 소재 만들기</button>}
    </div>
    {demo && <p className="ad-studio-notice">데모 화면 · 입력과 장면 구성을 확인할 수 있어요. 실제 AI 이미지는 생성되지 않습니다.</p>}
    {opening && <p role="status">저장된 소재를 불러오고 있어요.</p>}
    {error && <div className="ad-studio-error" role="alert">{error}{sourceId && <button type="button" className="yp-btn yp-sm" disabled={busy} onClick={() => setReadRevision(n => n + 1)}>다시 불러오기</button>}</div>}
    {status && <p role="status" className="ad-studio-status">{status}</p>}
    {!project && <>
      <div className="ad-studio-modes" role="group" aria-label="만들 소재 선택">
        <button type="button" aria-pressed={mode === "image"} onClick={() => selectMode("image")} disabled={working}><ImageIcon size={23} /><span><strong>이미지 소재</strong><small>메시지·소구를 넣고 여러 시안 만들기</small></span></button>
        <button type="button" aria-pressed={mode === "video"} onClick={() => selectMode("video")} disabled={working}><Film size={23} /><span><strong>영상 소스</strong><small>스크립트에 맞는 장면 이미지 만들기</small></span></button>
      </div>
      <form onSubmit={submit} className="ad-studio-form">
        <fieldset disabled={working}>
          <legend className="sr-only">소재 제작 내용</legend>
          <div className="ad-studio-inputs"><div className="ad-studio-main-input">
            {mode === "image" ? <>
              <label>광고에 넣을 메시지·내용 <span>필수</span><textarea required maxLength={1500} rows={4} value={message} onChange={e => setMessage(e.target.value)} placeholder="고객에게 보여줄 문구를 적어 주세요." /></label>
              <label>강조할 소구 <span>필수</span><textarea required maxLength={1000} rows={3} value={appeal} onChange={e => setAppeal(e.target.value)} placeholder="고객이 이 상품을 선택해야 하는 이유는 무엇인가요?" /></label>
            </> : <>
              <label>영상 스크립트 <span>필수</span><textarea required maxLength={8000} rows={7} value={script} onChange={e => {
                const next = e.target.value, nextScenes = adScriptScenes(next);
                setVisuals(previous => nextScenes.map((line, i) => line === scenes[i] ? previous[i] || "" : "")); setScript(next);
              }} placeholder={"한 줄에 한 장면씩 입력해 주세요.\n줄을 바꾸면 다음 장면이 됩니다."} /></label>
              <p className="ad-studio-help">최대 12장면 · 장면마다 이미지 1장을 만듭니다. 자막·음성·영상 편집은 포함하지 않습니다.</p>
              <label>전체 영상 분위기 <span>선택</span><input maxLength={1000} value={style} onChange={e => setStyle(e.target.value)} placeholder="예: 자연광, 차분한 색감, 실사 사진" /></label>
            </>}
            <label>누구에게 보여줄 광고인가요? <span>선택</span><input maxLength={300} value={audience} onChange={e => setAudience(e.target.value)} placeholder="고객의 상황이나 관심사를 적어 주세요." /></label>
          </div><div className="ad-studio-side-input">
            <div><strong>참고 이미지 <span className="ad-studio-help">선택 · 최대 3장</span></strong><p className="ad-studio-help">원하는 분위기의 광고나 제품 사진을 넣어 주세요.</p>
              <label className="ad-studio-upload"><Upload size={20} /><span>이미지 선택</span><small>PNG, JPG · 한 장당 3MB 이하</small><input aria-label="참고 이미지 선택" type="file" accept="image/png,image/jpeg" multiple onChange={e => { chooseFiles(e.target.files); e.target.value = ""; }} /></label>
              <div className="ad-studio-references">{files.map((file, i) => <ReferencePreview key={`${file.name}-${i}`} file={file} remove={() => setFiles(previous => previous.filter((_, index) => index !== i))} />)}</div>
            </div>
            <label>소재 비율<select value={aspect} onChange={e => setAspect(e.target.value as AdSourceAspect)}>{Object.entries(AD_SOURCE_SIZES).map(([key, size]) => <option key={key} value={key}>{size.label}</option>)}</select></label>
            {mode === "image" && <label>몇 개를 만들까요?<select value={count} onChange={e => setCount(Number(e.target.value))}>{[1, 2, 3, 4, 5, 6].map(n => <option key={n} value={n}>{n}개 시안</option>)}</select></label>}
            <div className="ad-studio-outcome"><strong>이렇게 나와요</strong><p>{mode === "image" ? `같은 메시지·소구로 구성을 달리한 광고 이미지 ${count}개` : "대사와 화면 설명이 함께 정리된 장면별 이미지"}</p><small>PNG 개별 저장 · 전체 ZIP 다운로드</small></div>
          </div></div>
          {mode === "video" && scenes.length > 0 && <div className="ad-studio-scenes"><h3>장면 구성 확인 <span>{scenes.length}/12</span></h3><p className="ad-studio-help">대사는 그대로 사용해요. 원하는 화면이 있다면 장면별로 적어 주세요.</p>
            {scenes.length > 12 ? <p role="alert">한 번에 최대 12장면까지 만들 수 있어요. 스크립트를 나누어 주세요.</p> : scenes.map((line, i) => <div className="ad-studio-scene" key={i}><span>{String(i + 1).padStart(2, "0")}</span><div><p>{line}</p><input aria-label={`장면 ${i + 1} 화면 설명`} maxLength={600} value={visuals[i] || ""} onChange={e => setVisuals(previous => scenes.map((_, index) => index === i ? e.target.value : previous[index] || ""))} placeholder="화면 설명 (선택) · 비워두면 대사에 맞게 만들어요." /></div></div>)}
          </div>}
          <div className="ad-studio-submit"><p>{mode === "image" ? "입력한 메시지는 유지하고 시각적 구성을 달리합니다." : "편집에 사용할 장면 이미지를 만듭니다."}</p><button className="yp-btn yp-pri" type="submit" disabled={working || !demo && !accessToken || mode === "video" && (!scenes.length || scenes.length > 12)}><Sparkles size={17} />{busy ? "제작 시작 중…" : demo ? "소재 구성 미리보기" : mode === "image" ? `이미지 소재 ${count}개 만들기` : `장면 이미지 ${scenes.length}개 만들기`}</button></div>
        </fieldset>
      </form>
    </>}
    {project && <div className="ad-studio-results">
      <div className="ad-studio-result-head"><div><strong>{project.input.mode === "image" ? "이미지 소재" : "영상용 장면 이미지"} · {completed}/{project.items.length}개 완료</strong><p className="ad-studio-help">{AD_SOURCE_SIZES[project.input.aspect].label} · {demo ? "구성 미리보기" : "AI 생성 초안 · 문구·제품 표현을 확인한 뒤 사용하세요."}</p></div>
        <div className="ad-studio-actions"><button className="yp-btn" onClick={() => fresh(true)} disabled={working}>입력 바꿔 새로 만들기</button><button className="yp-btn" disabled={!completed || downloading} onClick={() => void download()}><ArrowDownToLine size={16} />{downloading ? "다운로드 준비 중…" : `완료된 ${completed}개 ZIP`}</button></div>
      </div>
      {project.references.length > 0 && <details className="ad-studio-saved-refs"><summary>사용한 참고 이미지 {project.references.length}장</summary><div>{project.references.map((ref, i) => <img key={ref.path} src={ref.url} alt={`사용한 참고 이미지 ${i + 1}`} /> /* eslint-disable-line @next/next/no-img-element */)}</div></details>}
      {!demo && missingRefs > 0 && <div className="ad-studio-notice"><p>참고 이미지 {missingRefs}장을 더 올려야 제작을 시작할 수 있어요. 선택한 파일은 아래 버튼으로 다시 올릴 수 있어요.</p><input aria-label="누락된 참고 이미지 선택" type="file" accept="image/png,image/jpeg" multiple disabled={working} onChange={e => { chooseFiles(e.target.files, missingRefs); e.target.value = ""; }} />
        <div className="ad-studio-references">{files.map((file, i) => <ReferencePreview key={`${file.name}-${i}`} file={file} remove={() => setFiles(previous => previous.filter((_, index) => index !== i))} />)}</div>
        <button className="yp-btn" disabled={working || !files.length || files.length > missingRefs} onClick={() => void run(async () => { await uploadReferences(project, files); setStatus("참고 이미지를 저장했어요. 이어서 만들어 주세요."); })}>선택한 참고 이미지 올리기</button>
      </div>}
      {(busy || active) && <div className="ad-studio-progress" role="status"><progress max={project.items.length} value={completed} /><span>{busy ? "화면을 열어두면 차례로 만들어요." : "요청한 소재를 만들고 있어요. 완료되면 상태를 갱신합니다."}</span>{busy && <button className="yp-btn yp-sm" disabled={stopping} onClick={() => { stop.current = true; setStopping(true); }}>{stopping ? "현재 소재 저장 후 멈춥니다" : "현재 소재까지만 만들기"}</button>}</div>}
      <div className="ad-studio-grid">{project.items.map(item => <article className="ad-studio-output" key={item.id}>
        <div className="ad-studio-canvas" data-aspect={project.input.aspect}>{item.asset?.url ? <img src={item.asset.url} alt={`${item.label} 생성 결과`} /> /* eslint-disable-line @next/next/no-img-element */ : <div><ImageIcon size={26} /><span>{demo ? "이미지 생성 전 · 구성 확인" : item.status === "failed" ? "생성 실패" : item.status === "generating" && active ? "만드는 중…" : "아직 만들지 않았어요"}</span></div>}</div>
        <div className="ad-studio-output-copy"><strong>{item.label}</strong><p>{item.narration}</p><small>{item.direction}</small>{item.error && <p className="ad-studio-item-error">{item.error}</p>}
          {item.status === "done" ? <button className="yp-btn yp-sm" disabled={downloading} onClick={() => void download(item.id)}>PNG 다운로드</button> : item.attempts >= 3 ? <small>시도 횟수에 도달했어요. 입력을 바꿔 새로 만들어 주세요.</small> : item.status === "failed" && <button className="yp-btn yp-sm" disabled={working || demo} onClick={() => void run(() => generateRemaining(project, item.id))}>이 소재 다시 만들기</button>}
        </div>
      </article>)}</div>
      {!demo && retryable && <div className="ad-studio-submit"><p>완료된 소재는 유지하고 남은 소재만 만듭니다. 재시도 시 생성 비용이 다시 발생할 수 있어요.</p><button className="yp-btn yp-pri" disabled={working || missingRefs > 0} onClick={() => void run(() => generateRemaining(project))}>남은 소재 이어 만들기</button></div>}
    </div>}
    {!demo && <div className="ad-studio-recent"><h3>최근 소재 작업 <small>최근 50개</small></h3>{listError && <p role="alert">{listError} <button className="yp-btn yp-sm" onClick={() => setListRevision(n => n + 1)}>목록 다시 불러오기</button></p>}
      {!listError && !recent.length && <p className="ad-studio-help">만든 소재가 여기에 저장됩니다. 다시 열어 이어서 만들 수 있어요.</p>}
      <div>{recent.map(row => <button type="button" key={row.id} disabled={working} className={project?.id === row.id ? "ad-studio-recent-active" : ""} onClick={() => { setFiles([]); setStatus(""); setError(""); setLocation(row.id); setReadRevision(n => n + 1); }}><span>{row.mode === "image" ? "이미지" : "영상 소스"}</span><strong>{row.title}</strong><small>{row.done}/{row.total}개 완료</small></button>)}</div>
    </div>}
  </section>;
}
