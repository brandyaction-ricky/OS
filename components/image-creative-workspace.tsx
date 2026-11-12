"use client";
import "./image-creative-workspace.css";
import { useEffect, useMemo, useRef, useState } from "react";
import { useSession } from "./session-provider";
import { apiRequest } from "@/lib/api-client";
import { CREATIVE_SIZES, IMAGE_FORMATS, IMAGE_FORMAT_IDS, WAREHOUSE_FORMAT_IDS, isImageFormat, isWarehouseFormat, recommendImageFormats, type ImageFormatId } from "@/lib/image-creative/formats";
import { activeImageWinner, imageExperimentCandidateIds, imageExperimentSummary, latestImageExperimentBatch, recordImageWinner, approveImageFormat, formatApprovalKey, startImageCopyBatch, reviewImageBatch, returnImageReview, canSaveImageBrief, createImageBatch, reviseImageDesign, type ImageDesign, emptyImageCreative, productionBrief, imageCreativePrompt, imageBriefProblems, type ImageBatchRequest, type ImageCreativeState, type CreativeVariant, type ImageAsset } from "@/lib/image-creative/model";
import { LocalConnect, useLocalRender } from "./myin-local-render";
import { GuidedImageCreative, type ImagePreviewProduct } from "./guided-image-creative";
import { ImageReferenceSteps } from "./reference-image-creation";
import { photoSubjectBox } from "@/lib/image-creative/subject-box";
import { ImageFormatSample } from "./image-format-choice";
import { ImageFormatLibrary } from "./image-format-library";
import { FormatBoard, ImageApprovalBatch, targetNames, type MachineRender, type RenderTarget, type ReviewStep } from "./image-approval-batch";
import { ImageDesignEditor, LegacyPreview } from "./image-design-editor";
import { downloadWarehouseSelection } from "@/lib/image-creative/warehouse-output";

type Asset = ImageAsset & { url:string };
export type ImageProjectRow = { id:string; title:string; version:number; updatedAt?:string; experiment?: ReturnType<typeof imageExperimentSummary> };
type Project = ImageProjectRow;
export type ImageProjectBundle = {
  project: Project; state: ImageCreativeState; assets: Asset[];
  jobs: { phase?: "formats" | "copy"; currentInput?: boolean; id: string; status: string; target?: RenderTarget; model?: string; failReason?: string }[];
  renders?: MachineRender[]; rendered?: Record<string, string>; reviewable?: Record<string,string>;
};
const jobLabels: Record<string, string> = { backlog: "AI 작업 대기", active: "AI 작업 중", done: "시안 준비 완료", blocked: "AI 작업 중단" };
type Mode = ImageBatchRequest["mode"];
const modes: { id: Mode; title: string; hint: string }[] = [
  { id: "initial", title: "포맷부터 시작", hint: "포맷 추천과 첫 시안" },
  { id: "appeal", title: "소구점 비교", hint: "포맷·이미지 고정" },
  { id: "copy", title: "카피 비교", hint: "선택한 소구점 고정" },
  { id: "image", title: "이미지 비교", hint: "포맷·소구·카피 고정" },
  { id: "standalone", title: "독립 제작", hint: "다른 시안과 연결 없이" },
];
const fields = [
  ["brand", "브랜드명", "광고에 표시할 브랜드 이름"],
  ["objective", "소재 목표", "예: 무료 진단 시작"], ["funnel", "퍼널", "예: 무료 진단 유입"],
  ["audience", "대상", "예: 일에 맞는 강점을 찾는 직장인"], ["product", "상품", "예: 강점 진단"],
  ["offer", "제공 내용", "고객이 실제 받는 내용"],
  ["facts", "확인된 내용", "상품과 고객에 대해 확인한 내용"],
] as const;
const key = "os-image-creatives-demo-v1";
function loadDemo(): ImageProjectBundle[] { try { const saved: unknown = JSON.parse(localStorage.getItem(key) || "[]"); return Array.isArray(saved) ? saved as ImageProjectBundle[] : []; } catch { return []; } }
const projectRow = (bundle: ImageProjectBundle): Project => ({...bundle.project, experiment:imageExperimentSummary(bundle.state)});
const blankCopy = { appeal: "", headline: "", body: "", cta: "" };

export function ImageCreativeWorkspace({previewProducts, localDirectionPlanner=false}: {previewProducts?:ImagePreviewProduct[];localDirectionPlanner?:boolean} = {}) {
  const { demo, accessToken } = useSession();
  const linkedProject = useRef("");
  const [showTools, setShowTools] = useState(false);
  const [experimentList,setExperimentList] = useState(false);
  const [listReady,setListReady] = useState(false);
  const [wizardEpoch, setWizardEpoch] = useState(0);
  const [editingId, setEditingId] = useState("");
  const [showSafeZone, setShowSafeZone] = useState(false);
  const previewBlobs = useRef(new Map<string, Blob>());
  const [manual, setManual] = useState(blankCopy);
  const [fixFormatInputs, setFixFormatInputs] = useState(false);
  const [projects,setProjects] = useState<Project[]>([]); const [bundle,setBundle] = useState<ImageProjectBundle|null>(null);
  const [target, setTarget] = useState<RenderTarget>("render-pc");
  const [showConnect, setShowConnect] = useState(false);
  const local = useLocalRender(accessToken, Boolean(bundle && !demo && target === "local"));
  const [title,setTitle] = useState(""); const [brief,setBrief] = useState(emptyImageCreative().brief);
  const [mode,setMode] = useState<Mode>("initial"); const [count,setCount] = useState(5); const [formatIds,setFormatIds] = useState<ImageFormatId[]>([]);
  const [copyFields,setCopyFields] = useState<Array<"headline"|"body"|"cta">>(["headline"]);
  const [result,setResult] = useState(""); const [message,setMessage] = useState(""); const [error,setError] = useState(""); const [busy,setBusy] = useState(false);
  const [assetPaths,setAssetPaths] = useState<string[]>([]); const [size,setSize] = useState<CreativeVariant["size"]>("portrait");
  const saved = bundle?.state; const editing = saved?.variants.find(v => v.id === editingId);
  const refFlow = !showTools && saved?.formatRecommendation?.referenceFirst;
  const firstDraft = refFlow && saved?.batches.length === 1 && !saved.batches[0].review?.copy &&
    !saved.batches[0].review?.history.some(h=>h.step==="copy" && h.decision==="approved");
  const refReview = refFlow && saved?.batches.at(-1)?.review;
  const baselineId = saved?.experiment ? saved.formatApproval?.request.baseId ?? activeImageWinner(latestImageExperimentBatch(saved),saved)?.variantId ?? saved.selectedId : saved?.selectedId;
  const selected = saved?.variants.find(v=>v.id===baselineId);
  const experiment = saved && imageExperimentSummary(saved);
  const currentRound = saved && latestImageExperimentBatch(saved);
  const recommendations = useMemo(()=>recommendImageFormats(brief, assetPaths.length > 0, size),[brief,assetPaths,size]);
  const displayedFormats=[...recommendations.filter(r=>!isWarehouseFormat(r.id)),...formatIds.filter(id=>!isWarehouseFormat(id)&&!recommendations.some(r=>r.id===id)).map(id=>({id,name:IMAGE_FORMATS[id].name,reason:IMAGE_FORMATS[id].when,needsAsset:IMAGE_FORMATS[id].assetRequired,status:IMAGE_FORMATS[id].status,score:0}))];
  const canCompareFormats = ["initial","standalone"].includes(mode) && formatIds.length > 1 && formatIds.every(isWarehouseFormat);
  const compareFormats = canCompareFormats && fixFormatInputs;
  const formatCountProblem = !compareFormats && ["initial", "standalone"].includes(mode) && formatIds.length > count ? `선택한 포맷 ${formatIds.length}개마다 최소 1장씩 필요해요. 후보 수를 ${formatIds.length}개 이상으로 늘려 주세요.` : "";
  const freshAppeal = mode === "appeal" && !saved?.variants.length && Boolean(saved?.formatRecommendation);
  const isNew = mode === "initial" || mode === "standalone" || freshAppeal;
  const request: ImageBatchRequest = { mode, count: compareFormats ? formatIds.length : count, ...(compareFormats ? { compareFormats: true as const } : {}), ...(isNew?{assetPaths,size}:mode==="image"?{assetPaths}:{}), ...(selected && !isNew?{baseId:selected.id}:{}), ...(isNew?{formatIds}:{}), ...(mode==="copy"?{copyFields: selected && isWarehouseFormat(selected.formatId) ? copyFields.filter(field=>field!=="cta") : copyFields}:{}) };
  const prompt = useMemo(()=>{ try { return saved ? imageCreativePrompt(saved,request) : ""; } catch { return ""; } },[saved,mode,count,selected,formatIds,copyFields,assetPaths,size,compareFormats]); // eslint-disable-line react-hooks/exhaustive-deps
  const selectedReviewed = selected && saved?.batches.some(b=>b.variantIds.includes(selected.id) && b.review?.final);
  const boardFormats = isNew ? formatIds : (selected ? [selected.formatId] : []);
  let approvalKey = "";
  if (saved && (isNew || selectedReviewed) && boardFormats.length && imageBriefProblems(saved.brief,saved.formatRecommendation?.appealFirst).length===0 && JSON.stringify(brief) === JSON.stringify(saved.brief)) {
    try { approvalKey = formatApprovalKey(saved, request); } catch { /* The input form reports incomplete requests. */ }
  }
  const approved = Boolean(approvalKey && saved?.formatApproval?.key === approvalKey);
  const directPossible = approved && isNew && boardFormats.every(isWarehouseFormat) && request.count === boardFormats.length &&
    (boardFormats.length === 1 || request.compareFormats === true);
  const readList = async (signal?:AbortSignal) => {
    if (!demo && !accessToken) return;
    const list = new URLSearchParams(window.location.search).get("view") === "tests" ? "?experiment=true" : "";
    const rows = demo ? loadDemo().map(projectRow) : (await apiRequest<{projects:Project[]}>("/api/v1/content/image-creatives"+list,{token:accessToken,signal})).projects;
    if (signal?.aborted) return;
    setProjects(rows);
    setListReady(true);
  };
  useEffect(()=>{
    const controller = new AbortController();
    setListReady(false);
    setProjects([]);
    void readList(controller.signal).catch(e=>{
      if (!controller.signal.aborted) setError(e instanceof Error?e.message:"목록을 불러오지 못했어요.");
    });
    return ()=>controller.abort();
  },[demo,accessToken]); // eslint-disable-line react-hooks/exhaustive-deps
  const toggleFormat = (id: ImageFormatId) => {
    if (isWarehouseFormat(id)) setSize("portrait");
    if (mode !== "standalone" && mode !== "initial") setMode("initial");
    const ids = formatIds.includes(id) ? formatIds.filter(item => item !== id) : [...formatIds,id];
    setFormatIds(ids);
    if (ids.length && ids.every(isWarehouseFormat)) { setFixFormatInputs(ids.length > 1); setCount(ids.length); }
  };
  const applyBundle=(next:ImageProjectBundle)=>{
    if (next.project.id !== bundle?.project.id) {
      rememberProject(next.project.id);
      setTarget("render-pc"); setShowConnect(false); setFormatIds([]); setMode("initial"); setSize("portrait"); setCount(5); setResult("");
      setEditingId(""); setShowSafeZone(false); setManual(blankCopy); setFixFormatInputs(false); setCopyFields(["headline"]); setAssetPaths([]); previewBlobs.current.clear();
      const pending = next.state.formatApproval?.request;
      if (pending) {
        setMode(pending.mode); setFormatIds((pending.formatIds || []).filter(isImageFormat)); setCount(pending.count); setSize(pending.size || "portrait");
        setFixFormatInputs(Boolean(pending.compareFormats)); setAssetPaths(pending.assetPaths || []); setCopyFields(pending.copyFields || ["headline"]);
      }
    }
    if (demo) {
      const stored = loadDemo();
      const previous = stored.find(item=>item.project.id===next.project.id);
      if (!previous || previous.project.version!==next.project.version || previous.assets.length!==next.assets.length) {
        next = {...next,project:{...next.project,updatedAt:new Date().toISOString()}};
      }
      const all = [next,...stored.filter(item=>item.project.id!==next.project.id)];
      try { localStorage.setItem(key,JSON.stringify(all)); }
      catch { throw new Error("브라우저 저장 공간이 부족해요. 더 작은 이미지를 사용해 주세요."); }
      setProjects(all.map(projectRow));
    }
    setBundle(next);
    setBrief(next.state.brief);
    setAssetPaths(old=>old.filter(path=>next.assets.some(asset=>asset.path===path)));
  };
  const inFlight = useRef(false);
  const run=async(fn:()=>Promise<void>)=>{if(inFlight.current)return;inFlight.current=true;setBusy(true);setError("");setMessage("");try{await fn();}catch(e){setError(e instanceof Error?e.message:"작업을 완료하지 못했어요.");}finally{inFlight.current=false;setBusy(false);}};
  function rememberProject(id: string) {
    const url = new URL(window.location.href);
    if (id) url.searchParams.set("project", id);
    else { url.searchParams.delete("project"); url.hash = ""; }
    linkedProject.current = id;
    window.history.replaceState(window.history.state, "", url);
  }
  function leaveProject() {
    rememberProject("");
    setBundle(null); setBrief(emptyImageCreative().brief); setAssetPaths([]); setFormatIds([]);
    setWizardEpoch(n => n + 1); setMessage(""); setError("");
  }
  async function createProject(name: string, input: ImageCreativeState["brief"], experiment?: true) {
    const next = demo
      ? {project:{id:crypto.randomUUID(),title:name,version:1},state:{...emptyImageCreative(),brief:input,...(experiment && {experiment})},assets:[],jobs:[]}
      : await apiRequest<ImageProjectBundle>("/api/v1/content/image-creatives",{
        method:"POST",token:accessToken,body:JSON.stringify({title:name,brief:input,...(experiment && {experiment})}),
      });
    applyBundle(next);
    if (!demo) setProjects(old => [next.project, ...old.filter(row => row.id !== next.project.id)]);
    return next;
  }
  const create = () => void run(async () => {
    const name = title.trim();
    if (!name) throw new Error("작업 이름을 입력해 주세요.");
    await createProject(name, bundle ? emptyImageCreative().brief : brief);
    setTitle("");
  });
  const open=(id:string)=>void run(async()=>{if(demo){const found=loadDemo().find(x=>x.project.id===id);if(!found)throw new Error("작업을 찾을 수 없어요.");applyBundle(found);return;}applyBundle(await apiRequest<ImageProjectBundle>(`/api/v1/content/image-creatives/${encodeURIComponent(id)}`,{token:accessToken}));});
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    setExperimentList(params.get("view") === "tests");
    const id = params.get("project");
    if (!id || linkedProject.current === id || (!demo && !accessToken)) return;
    linkedProject.current = id;
    open(id);
  }, [demo,accessToken]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (bundle?.project.id === linkedProject.current && window.location.hash === "#image-creative-results")
      document.getElementById("image-creative-results")?.scrollIntoView();
  }, [bundle?.project.id]);
  const projectId = bundle?.project.id;
  const waiting = bundle?.jobs.some(job => (showTools || job.currentInput !== false) && ["backlog", "active"].includes(job.status)) ||
    bundle?.renders?.some(render => ["queued", "active"].includes(render.status));
  useEffect(() => {
    if (demo || !accessToken || !projectId || !waiting) return;
    const controller = new AbortController();
    let pending = false;
    const timer = window.setInterval(async () => {
      if (pending) return;
      pending = true;
      try {
        const next = await apiRequest<ImageProjectBundle>(`/api/v1/content/image-creatives/${encodeURIComponent(projectId)}`, { token: accessToken, signal: controller.signal });
        if (!controller.signal.aborted) setBundle(current =>
          current?.project.id === projectId && current.project.version <= next.project.version ? next : current);
      } catch { /* The manual refresh reports failures; the next poll will retry. */ }
      finally { pending = false; }
    }, 15_000);
    return () => { controller.abort(); window.clearInterval(timer); };
  }, [demo, accessToken, projectId, waiting]);
  const refresh=()=>void run(async()=>{if(!bundle)return;if(demo){setBundle(loadDemo().find(x=>x.project.id===bundle.project.id)||bundle);return;}const next=await apiRequest<ImageProjectBundle>(`/api/v1/content/image-creatives/${encodeURIComponent(bundle.project.id)}`,{token:accessToken});setBundle(current=>current?.project.id===next.project.id && current.project.version<=next.project.version ? next : current);});
  const outputNote = " 전체 문구를 확인하고 카피를 승인해 주세요.";
  const patch=async(body:Record<string,unknown>, current=bundle)=>{
    if (!current) throw new Error("먼저 작업을 만들어 주세요.");
    return apiRequest<ImageProjectBundle>(`/api/v1/content/image-creatives/${encodeURIComponent(current.project.id)}`,{
      method:"PATCH",token:accessToken,body:JSON.stringify({version:current.project.version,...body}),
    });
  };
  async function guidedPatch(body: Record<string,unknown>, current: ImageProjectBundle) {
    try { return await patch(body,current); }
    catch (error) {
      // A request can save the human's decision before the subscription queue becomes available.
      try {
        const next = await apiRequest<ImageProjectBundle>(`/api/v1/content/image-creatives/${encodeURIComponent(current.project.id)}`, {token:accessToken});
        if (next.project.version > current.project.version) applyBundle(next);
        else if (next.project.version === current.project.version) setBundle(old =>
          old?.project.id === next.project.id && old.project.version === next.project.version ? next : old);
      } catch { /* Keep the original error and the editable draft. */ }
      throw error;
    }
  }
  function toggleTools() {
    const pending = bundle?.state.formatApproval?.request;
    if (!showTools && pending) {
      setMode(pending.mode); setFormatIds((pending.formatIds || []).filter(isImageFormat)); setCount(pending.count);
      setSize(pending.size || "portrait"); setAssetPaths(pending.assetPaths || []);
      setCopyFields(pending.copyFields || ["headline"]); setFixFormatInputs(Boolean(pending.compareFormats));
    }
    setShowTools(!showTools);
  }
  function updateDemo(state: ImageCreativeState, renders = bundle?.renders) {
    if (!bundle) return;
    applyBundle({...bundle, state, renders, project:{...bundle.project,version:bundle.project.version+1}});
  }
  const demoStamp = () => ({by:"브라우저 체험",at:new Date().toISOString()});
  function approveRequest() {
    void run(async () => {
      if (!bundle || !approvalKey) throw new Error("포맷과 제작 조건을 확인해 주세요.");
      if (demo) updateDemo(approveImageFormat(bundle.state,request,demoStamp()));
      else applyBundle(await patch({action:"approve-format",request}));
      setMessage("포맷을 승인했어요. 이 조건으로 카피를 준비할 수 있습니다.");
    });
  }
  function reviewBatch(batchId:string,step:ReviewStep,runId?:string) {
    void run(async () => {
      if (!bundle) return;
      const actions={format:"approve-format",copy:"approve-copy",preview:"confirm-preview",final:"approve-final"} as const;
      if (demo) {
        const batch=bundle.state.batches.find(b=>b.id===batchId);
        if (!batch) throw new Error("시안 묶음을 확인해 주세요.");
        let renders=bundle.renders;
        let output;
        if (step==="preview") {
          if (!batch.variantIds.every(id=>previewBlobs.current.has(id))) throw new Error("미리보기를 모두 확인해 주세요.");
          output={runId:crypto.randomUUID(),target};
          renders=[...(renders || []),{id:output.runId,target,status:"done",variantIds:batch.variantIds}];
        } else if (step==="final") {
          const completed=renders?.find(row=>row.id===runId && row.status==="done");
          if (!completed) throw new Error("체험 출력본을 확인해 주세요.");
          output={runId:completed.id,target:completed.target};
        }
        updateDemo(reviewImageBatch(bundle.state,batchId,step,demoStamp(),output),renders);
      } else applyBundle(await patch({action:actions[step],batchId,...(step==="preview"?{target}:{}),...(step==="final"?{runId}:{})}));
      setMessage(({format:"포맷을 승인했습니다.",copy:"카피를 승인했습니다. 미리보기를 확인해 주세요.",
        preview:demo?"브라우저 체험 출력본을 최종 검수해 주세요.":`${targetNames[target]}에 최종 PNG 출력을 요청했습니다.`,final:"최종 검수를 완료했습니다."})[step]);
    });
  }
  function sendBack(batchId:string,step:"copy"|"preview"|"final",reason:string) {
    void run(async () => {
      if (!bundle) return;
      if (demo) updateDemo(returnImageReview(bundle.state,batchId,step,reason,demoStamp()));
      else applyBundle(await patch({action:"return-review",batchId,stage:step,reason}));
      setMessage("수정 사유를 기록했습니다.");
    });
  }
  const saveBrief=()=>void run(async()=>{if(!bundle)return;if(demo){if(!canSaveImageBrief(bundle.state,brief))throw new Error("시안이 있는 작업의 조건은 바꿀 수 없어요. 새 작업을 만들어 주세요.");applyBundle({...bundle,project:{...bundle.project,version:bundle.project.version+1},state:{...bundle.state,brief}});return;}applyBundle(await patch({action:"save-brief",brief}));setMessage("입력 내용을 저장했어요.");});
  function registerWinner(batchId:string, variantId:string, note:string) {
    void run(async () => {
      if (!bundle) return;
      if (demo) updateDemo(recordImageWinner(bundle.state, batchId, variantId, note, demoStamp()));
      else applyBundle(await guidedPatch({action:"record-winner",batchId,variantId,note},bundle));
    });
  }
  const select=(variantId:string)=>void run(async()=>{if(!bundle)return;if(demo){applyBundle({...bundle,project:{...bundle.project,version:bundle.project.version+1},state:{...bundle.state,selectedId:variantId}});return;}applyBundle(await patch({action:"select",variantId}));});
  async function saveDesign(baseId: string, id: string, design: ImageDesign) {
    if (!bundle) throw new Error("먼저 작업을 선택해 주세요.");
    setBusy(true);
    try {
      if (demo) {
        const state = reviseImageDesign(bundle.state, baseId, id, design, { now: new Date().toISOString(), by: "브라우저 체험" });
        applyBundle({ ...bundle, project: { ...bundle.project, version: bundle.project.version + 1 }, state });
      } else {
        applyBundle(await patch({ action: "revise-design", baseId, id, design }));
      }
      setEditingId(""); setMessage(refFlow ? "디자인 수정본을 저장했습니다. 미리보기를 확인해 주세요." : "수정본을 새 묶음으로 저장했습니다. 포맷부터 확인해 주세요.");
    } finally { setBusy(false); }
  }
  async function saveVariants(batchRequest: ImageBatchRequest, result: Parameters<typeof createImageBatch>[2]) {
    if (!bundle) throw new Error("먼저 작업을 선택해 주세요.");
    if (!approved || formatApprovalKey(bundle.state,batchRequest)!==bundle.state.formatApproval?.key) throw new Error("현재 제작 조건으로 먼저 포맷을 승인해 주세요.");
    if (!demo) { applyBundle(await patch({ action: "import", request: batchRequest, result })); return; }
    if (Array.isArray(result?.variants)) for (const row of result.variants) {
      if (!row || typeof row !== "object" || !("asset" in row)) continue;
      const asset = (row as { asset?: {path?: string; w?: number; h?: number} }).asset;
      if (asset && !bundle.assets.some(a=>a.path===asset.path && a.w===asset.w && a.h===asset.h))
        throw new Error("이 작업에 등록된 이미지와 크기를 사용해 주세요.");
    }
    const state = createImageBatch(bundle.state,batchRequest,result,{now:new Date().toISOString(),by:"demo",newId:()=>crypto.randomUUID(),assets:bundle.assets});
    updateDemo(startImageCopyBatch(bundle.state,state,batchRequest));
  }
  const importResult = () => void run(async () => {
    let parsed;
    try { parsed = JSON.parse(result); } catch { throw new Error("결과 JSON 형식을 확인해 주세요."); }
    await saveVariants(request, parsed); setResult(""); setMessage("카피 후보를 저장했어요." + outputNote);
  });
  const makeWarehouse = () => void run(async () => {
    if (!bundle || !formatIds.length || !formatIds.every(isWarehouseFormat) || !["initial","standalone"].includes(mode))
      throw new Error("제작할 창고 포맷을 골라 주세요.");
    if (JSON.stringify(brief) !== JSON.stringify(bundle.state.brief)) throw new Error("작업 입력을 먼저 저장해 주세요.");
    if (!bundle.state.brief.brand?.trim()) throw new Error("광고에 표시할 브랜드명을 입력하고 저장해 주세요.");
    const source = bundle.assets.find(item => item.path === assetPaths[0]);
    if (!source || assetPaths.length !== 1) throw new Error("이 작업에서 사용할 사진 한 장을 선택해 주세요.");
    const { appeal, ...copy } = manual;
    if (!appeal.trim() || Object.values(copy).some(value => !value.trim())) throw new Error("공통 소구와 문구를 모두 입력해 주세요.");
    const asset = { path: source.path, w: source.w, h: source.h };
    const variants = formatIds.map(formatId => ({
      formatId, formatVersion: IMAGE_FORMATS[formatId].version, size: "portrait", asset, appeal: { id: "shared", meaning: appeal }, copy,
    }));
    await saveVariants({ ...request, count: variants.length, size: "portrait", assetPaths: [source.path], ...(variants.length>1?{compareFormats:true}:{}) }, { variants });
    setMessage(`시안 ${variants.length}장을 작업에 저장했어요.` + outputNote);
  });
  const queue=()=>void run(async()=>{if(!bundle)return;if(demo)throw new Error("체험 모드에서는 실제 AI 작업을 보내지 않아요. 요청문을 복사하고 결과를 가져와 주세요.");applyBundle(await patch({action:"generate",request}));setMessage("구독 AI에 카피 후보를 요청했어요. 도착하면 전체 문구를 검토해 주세요.");});
  const upload = (file: File | null) => void run(async () => {
    if (!bundle || !file) return;
    if (!["image/png","image/jpeg"].includes(file.type)) throw new Error("PNG 또는 JPG 이미지를 선택해 주세요.");
    if (file.size > 5*1024*1024) throw new Error("5MB 이하 이미지를 선택해 주세요.");
    if (demo) {
      const bitmap = await createImageBitmap(file);
      try {
        const {width:w,height:h} = bitmap;
        if (w > 8192 || h > 8192 || w*h > 20_000_000) throw new Error("사진 크기를 줄여 주세요.");
        const canvas = document.createElement("canvas");
        canvas.width = w; canvas.height = h;
        const ctx = canvas.getContext("2d");
        if (!ctx) throw new Error("사진을 열 수 없어요.");
        ctx.drawImage(bitmap,0,0);
        const subjectBox = photoSubjectBox(ctx.getImageData(0,0,w,h).data,w,h);
        const url = await new Promise<string>((resolve,reject)=>{
          const reader = new FileReader();
          reader.onload = ()=>resolve(String(reader.result));
          reader.onerror = ()=>reject(new Error("파일을 읽지 못했어요."));
          reader.readAsDataURL(file);
        });
        const path = `youtube/${bundle.project.id}/image-creative/${crypto.randomUUID()}.${file.type === "image/png" ? "png" : "jpg"}`;
        applyBundle({...bundle,assets:[...bundle.assets,{path,w,h,url,subjectBox}]});
        setAssetPaths(old=>[...old,path]);
      } finally { bitmap.close(); }
      return;
    }
    const path = `/api/v1/content/image-creatives/${encodeURIComponent(bundle.project.id)}/assets`;
    const prepared = await apiRequest<{path:string;signedUrl:string;receipt:string}>(path,{method:"POST",token:accessToken,
      body:JSON.stringify({action:"prepare",mimeType:file.type,fileSize:file.size})});
    const sent = await fetch(prepared.signedUrl,{method:"PUT",headers:{"content-type":file.type},body:file});
    if (!sent.ok) throw new Error("이미지 업로드에 실패했어요. 다시 시도해 주세요.");
    const next = await apiRequest<ImageProjectBundle>(path,{method:"POST",token:accessToken,
      body:JSON.stringify({action:"commit",path:prepared.path,receipt:prepared.receipt})});
    applyBundle(next);
    const uploaded = next.assets.find(asset=>asset.path===prepared.path);
    if (!uploaded) throw new Error("등록된 이미지를 확인하지 못했어요. 작업을 새로고침해 주세요.");
    setAssetPaths(old=>old.includes(uploaded.path)?old:[...old,uploaded.path]);
  });
  async function storedExport(id: string, kind: "variant" | "batch") {
    if (!bundle || !accessToken) throw new Error("로그인 후 내보낼 수 있어요.");
    const address = `/api/v1/content/image-creatives/${encodeURIComponent(bundle.project.id)}/export?${kind === "variant" ? "variantId" : "batchId"}=${encodeURIComponent(id)}`;
    const result = await apiRequest<{url:string;name:string}>(address, {token:accessToken});
    const url = new URL(result.url);
    if (url.protocol !== "https:") throw new Error("다운로드 주소를 확인할 수 없어요.");
    return { url: url.href, name: result.name };
  }
  const download = (id:string, kind:"variant"|"batch"="variant") => void run(async () => {
    if (!bundle) return;
    const ids = kind === "variant" ? [id] : bundle.state.batches.find(batch=>batch.id===id)?.variantIds || [];
    const variants = ids.map(key=>bundle.state.variants.find(row=>row.id===key)).filter((v): v is CreativeVariant => Boolean(v));
    if (variants.length !== ids.length || !variants.length) throw new Error("저장된 시안을 확인해 주세요.");
    const reviewed = bundle.state.batches.find(batch=>variants.every(v=>batch.variantIds.includes(v.id)));
    const complete = bundle.renders?.find(r=>r.id===reviewed?.review?.final?.runId && r.status==="done");
    if (!complete || complete.id!==reviewed?.review?.preview?.runId) throw new Error("출력본의 최종 검수를 먼저 완료해 주세요.");
    if (demo) {
      await downloadWarehouseSelection(variants, v=>previewBlobs.current.get(v.id), async v => {
        const visible = previewBlobs.current.get(v.id);
        if (visible) return visible;
        throw new Error("체험 출력본을 확인한 뒤 다시 시도해 주세요.");
      }, kind === "variant" ? id + ".png" : id + ".zip", kind, { brief: productionBrief(bundle.state.brief), batch: bundle.state.batches.find(batch=>batch.id===id) });
      return;
    }
    const file = await storedExport(id,kind);
    const anchor = document.createElement("a"); anchor.href=file.url; anchor.download=file.name; anchor.rel="noopener noreferrer"; anchor.click();
  });
  function startFormatComparison() {
    if (!bundle) { setError("먼저 작업 이름을 입력해 새 작업을 만들어 주세요."); return; }
    setMode("initial"); setSize("portrait"); setFormatIds([...WAREHOUSE_FORMAT_IDS]); setCount(WAREHOUSE_FORMAT_IDS.length);
    setFixFormatInputs(true); setMessage("비교할 다섯 포맷을 선택했습니다. 사진 한 장을 선택한 뒤 포맷을 승인해 주세요.");
    document.getElementById("image-format-start")?.scrollIntoView({block:"start"});
  }
  const copyPrompt=()=>void run(async()=>{if(!approved || !prompt)throw new Error("먼저 현재 조건의 포맷을 승인해 주세요.");const extra=`\n선택 크기: ${size}\n사용 가능한 업로드 이미지: ${JSON.stringify(bundle?.assets.map(({path,w,h})=>({path,w,h})) || [])}\n선택한 이미지 경로: ${(["appeal","copy"].includes(mode) ? selected?.asset?.path : assetPaths.join(", ")) || "없음"}`;await navigator.clipboard.writeText(prompt+extra);setMessage("요청문을 복사했어요. 구독 중인 AI에 전달한 뒤 JSON을 가져와 주세요.");});
  const machinePicker = (
<section className="panel panel-pad-lg ic-panel" aria-label="PNG 출력 설정">
        <label className="ic-field">이미지를 출력할 컴퓨터
          <select className="field" value={target} onChange={event => { setTarget(event.target.value as RenderTarget); setShowConnect(false); }}>
            <option value="render-pc">{targetNames["render-pc"]}</option>
            <option value="local">{targetNames.local}</option>
          </select>
        </label>
        {target === "local" && !demo && <div className="ic-actions">
          <p className="ic-muted">{local.status?.state === "online" ? "내 Mac이 연결되어 있어요." : "영상 제작용 연결 프로그램을 내 Mac에서 켜면 대기 중인 출력을 가져갑니다."}</p>
          {local.status?.state !== "online" && <button type="button" className="secondary-button" aria-expanded={showConnect} onClick={() => setShowConnect(!showConnect)}>내 Mac 연결 방법</button>}
          {showConnect && <LocalConnect token={accessToken} onDone={() => void local.reload()} />}
        </div>}
      </section>
  );
  return <div className="ic-page">
    <h1>이미지 광고</h1>
    {demo&&<p className="os-callout" data-tone="info">{localDirectionPlanner
      ? "개발 화면 · 작업은 이 브라우저에 저장됩니다."
      : "체험 모드 · 시안과 PNG를 이 브라우저에서 만듭니다. 실제 AI와 Mac 작업은 연결된 OS에서 실행됩니다."}</p>}
    {error&&<p role="alert" className="os-callout" data-tone="danger">{error}</p>}{message&&<p role="status" className="os-callout" data-tone="info">{message}</p>}
    {!showTools && <>
      <GuidedImageCreative projects={projects} listReady={listReady} experimentList={experimentList}
        reloadList={()=>void run(readList)} openProject={open} previewProducts={demo ? previewProducts : undefined} localDirectionPlanner={localDirectionPlanner} key={wizardEpoch} bundle={bundle} brief={brief} setBrief={setBrief} demo={demo} busy={busy}
        createProject={createProject} patch={guidedPatch} receive={applyBundle} run={run} refresh={refresh}
        assetPaths={assetPaths} setAssetPaths={setAssetPaths} upload={upload} leave={leaveProject}
        openTools={toggleTools} />
    </>}
    {showTools && <>
    <section className="panel panel-pad-lg ic-panel"><h2>작업 선택</h2><div className="ic-row"><label className="ic-field">기존 작업<select className="field" aria-label="기존 작업" disabled={busy} value={bundle?.project.id||""} onChange={e=>{if(e.target.value)open(e.target.value);}}><option value="">작업을 선택하세요</option>{projects.map(p=><option key={p.id} value={p.id}>{p.title}</option>)}</select></label><label className="ic-field">새 작업 이름<input className="field" value={title} onChange={e=>setTitle(e.target.value)} placeholder="예: 무료 진단 첫 소재" /></label><button className="primary-button" disabled={busy} onClick={create}>새 작업 만들기</button></div></section>
    <ImageFormatLibrary selected={formatIds} onSelect={bundle ? toggleFormat : undefined} />
    <div id="image-format-compare" className="ic-actions"><button className="secondary-button" onClick={startFormatComparison}>포맷만 비교하기</button></div>
    {saved?.formatTests?.length ? <details className="ic-details"><summary>이전에 저장한 포맷 비교</summary>
      {saved.formatTests.map((item,index)=><section key={item.id}><h3>{index+1}번째 비교 · {item.copy.headline}</h3>
        <p>{item.copy.brand} · {item.appeal} · {item.copy.support} · {item.copy.cta}</p>
        {item.followup && <p>{IMAGE_FORMATS[item.followup.formatId].name} · {modes.find(m=>m.id===item.followup?.mode)?.title}</p>}
      </section>)}</details> : null}
    <section className="panel panel-pad-lg ic-panel"><h2>1. 무엇을 만들까요?</h2><p className="ic-muted">{saved?.variants.length ? "시안이 만들어진 작업의 조건은 보존됩니다. 조건을 바꾸려면 새 작업을 만드세요." : "추천과 작업 요청에 쓸 내용을 입력해 주세요."}</p><div className="ic-grid">{fields.map(([name,label,placeholder])=><label className="ic-field" key={name}>{label}{name==="facts"?<textarea className="field is-prose" rows={3} disabled={Boolean(saved?.variants.length)} value={brief[name] ?? ""} placeholder={placeholder} onChange={e=>setBrief({...brief,[name]:e.target.value})}/>:<input className="field" disabled={Boolean(saved?.variants.length) && (name !== "brand" || Boolean(saved?.brief.brand?.trim()))} value={brief[name] ?? ""} placeholder={placeholder} onChange={e=>setBrief({...brief,[name]:e.target.value,...(["product","brand","audience","offer"].includes(name) ? {productSource:undefined} : {})})}/>}</label>)}</div><div className="ic-row ic-actions"><button className="secondary-button" disabled={!bundle||busy} onClick={saveBrief}>입력 저장</button></div></section>
    {bundle&&<>
      <section id="image-format-start" className="panel panel-pad-lg ic-panel"><h2>2. 제작 방식</h2><div className="ic-modes">{modes.map(m=><div className="ic-mode" key={m.id}><button type="button" className="secondary-button" aria-pressed={mode===m.id} onClick={()=>{setMode(m.id);if(m.id==="image")setAssetPaths([]);}}>{m.title}</button><p className="ic-mode-hint">{m.hint}</p></div>)}</div>{!["initial","standalone"].includes(mode)&&<p className="os-callout" data-tone="info">{selected?`기준 시안: ${selected.copy.headline || selected.id}`:"아래 결과에서 기준 시안을 먼저 선택하세요."} 승리 여부는 직접 확인하고 선택합니다.</p>}</section>
      {["initial","standalone"].includes(mode)&&<section className="panel panel-pad-lg ic-panel"><h2>3. 포맷 고르기</h2><p className="ic-muted">입력 내용에 맞춘 구조 추천이에요. 광고 성과를 예측한 결과는 아닙니다.</p><fieldset className="ic-checks"><legend>창고 디자인 · 피드 4:5</legend>
        {WAREHOUSE_FORMAT_IDS.map(id=><label key={id} className="ic-check"><input type="checkbox" checked={formatIds.includes(id)} onChange={()=>toggleFormat(id)}/>{IMAGE_FORMATS[id].name}{recommendations.some(row=>row.id===id) ? " · 추천" : ""}</label>)}
      </fieldset><div className="ic-preview-grid">{displayedFormats.map(item=>{const f=IMAGE_FORMATS[item.id];const example:CreativeVariant={id:"format-preview",formatId:item.id,formatVersion:1,size,appeal:{id:"preview",meaning:"구성 확인"},copy:{headline:"여기에 제목이 들어갑니다",body:"짧은 설명을 넣어 주세요",cta:"자세히 보기"},at:"",by:"preview"};return <article key={item.id} className={`ic-card ${formatIds.includes(item.id)?"ic-selected":""}`}>{item.id === "thumbnail_subject" ? <ImageFormatSample id={item.id} size={size}/> : <LegacyPreview variant={example}/>}<div className="ic-card-body"><h3>{item.name}</h3><p className="ic-muted">{item.reason}</p>{f.assetRequired&&<p className="ic-muted">이미지 필요</p>}<button className="secondary-button" type="button" aria-pressed={formatIds.includes(item.id)} onClick={()=>setFormatIds(old=>old.includes(item.id)?old.filter(x=>x!==item.id):[...old,item.id])}>{formatIds.includes(item.id)?"선택됨":"이 포맷 선택"}</button></div></article>;})}</div><details className="ic-details"><summary>다른 포맷 보기</summary><div className="ic-row ic-actions">{IMAGE_FORMAT_IDS.filter(id=>!isWarehouseFormat(id)&&!recommendations.some(r=>r.id===id)).map(id=><button className="secondary-button" aria-pressed={formatIds.includes(id)} key={id} onClick={()=>setFormatIds(old=>old.includes(id)?old.filter(x=>x!==id):[...old,id])}>{IMAGE_FORMATS[id].name}</button>)}</div></details></section>}
      <section className="panel panel-pad-lg ic-panel"><h2>이미지 준비</h2><p className="ic-muted">공개 가능한 이미지만 올려 주세요. 시안이 이미지를 요구하면 업로드한 파일을 선택합니다.</p>{formatIds.some(isWarehouseFormat) && <details className="ic-details"><summary>선택한 디자인에 맞는 사진 구도</summary><ul>{formatIds.filter(isWarehouseFormat).map(id=><li key={id}><strong>{IMAGE_FORMATS[id].name}</strong> · {IMAGE_FORMATS[id].photoGuide}</li>)}</ul></details>}<div className="ic-row"><label className="secondary-button">이미지 올리기<input className="ic-sr" type="file" accept="image/png,image/jpeg" onChange={e=>{upload(e.target.files?.[0]||null);e.target.value="";}} /></label><fieldset className="ic-checks"><legend>사용할 이미지</legend>{bundle.assets.length ? bundle.assets.map((a,i)=><label key={a.path} className="ic-check"><input type="checkbox" checked={assetPaths.includes(a.path)} onChange={e=>setAssetPaths(old=>e.target.checked?[...old,a.path]:old.filter(p=>p!==a.path))} /> 이미지 {i+1} · {a.w}×{a.h}</label>):<span className="ic-muted">아직 올린 이미지가 없어요.</span>}</fieldset>{["initial","standalone"].includes(mode)&&<label className="ic-field">광고 크기<select className="field" value={size} disabled={formatIds.some(isWarehouseFormat)} onChange={e=>setSize(e.target.value as CreativeVariant["size"])}>{Object.entries(CREATIVE_SIZES).map(([id,s])=><option value={id} key={id}>{s.label}</option>)}</select></label>}</div></section>
      <section className="panel panel-pad-lg ic-panel"><h2>포맷 승인</h2><div className="ic-row"><label className="ic-field">후보 수<input className="field" type="number" min={1} max={20} value={compareFormats ? formatIds.length : count} disabled={compareFormats} onChange={e=>setCount(Math.min(20,Math.max(1,Number(e.target.value)||1)))} /></label>{canCompareFormats && <label className="ic-check"><input type="checkbox" checked={fixFormatInputs} onChange={event=>setFixFormatInputs(event.target.checked)}/>공통 소구·카피·사진으로 포맷만 비교</label>}{mode==="copy"&&<fieldset className="ic-checks"><legend>바꿀 카피</legend>{(["headline","body","cta"] as const).map(field=><label key={field} className="ic-check"><input type="checkbox" disabled={field==="cta" && Boolean(selected && isWarehouseFormat(selected.formatId))} checked={copyFields.includes(field) && !(field==="cta" && selected && isWarehouseFormat(selected.formatId))} onChange={e=>setCopyFields(old=>e.target.checked?[...old,field]:old.filter(x=>x!==field))}/>{({headline:"제목",body:"본문",cta:"버튼"})[field]}</label>)}</fieldset>}</div>{["initial","standalone"].includes(mode)&&<p className="ic-muted">선택한 포맷마다 최소 1장씩 만듭니다{formatIds.length ? ` · 현재 ${formatIds.length}개 선택` : ""}.</p>}{formatCountProblem&&<p className="os-callout" data-tone="danger" role="alert">{formatCountProblem}</p>}{boardFormats.length > 0 && <div className="ic-preview-grid ic-actions">{boardFormats.map(id=>
        <FormatBoard key={id} id={id} size={isNew ? size : selected?.size || size}/>)}</div>}
        <button type="button" className="primary-button ic-actions" onClick={approveRequest} disabled={busy || !approvalKey || approved}>{approved?"포맷 승인됨":"포맷 승인"}</button>
      </section>
      {directPossible && <section className="panel panel-pad-lg ic-panel" aria-label="창고 디자인 제작">
        <h2>공통 카피 입력</h2>
        <div className="ic-grid">{([["appeal","공통 소구",160],["headline","광고 제목",IMAGE_FORMATS[formatIds[0]].limits.headline],["body","광고 본문",IMAGE_FORMATS[formatIds[0]].limits.body],["cta","광고 버튼 문구",IMAGE_FORMATS[formatIds[0]].limits.cta]] as const).map(([field,name,max])=>
          <label key={field} className="ic-field">{name}<input className="field" maxLength={max} value={manual[field]} onChange={e=>setManual({...manual,[field]:e.target.value})}/></label>
        )}</div>
        <button type="button" className="primary-button ic-actions" disabled={busy} onClick={makeWarehouse}>선택한 포맷 {formatIds.length}장 카피 저장</button>
      </section>}
      <section className="panel panel-pad-lg ic-panel"><h2>카피 준비</h2>
        {!approved && <p className="ic-muted">포맷과 작업 입력을 저장·승인하면 카피 후보를 준비할 수 있습니다.</p>}
      <div className="ic-row"><button className="primary-button" disabled={busy||!approved} onClick={queue}>내 AI에게 맡기기</button><button className="secondary-button" disabled={busy||!approved} onClick={copyPrompt}>요청문 복사</button></div><details className="ic-details"><summary>구독 AI 결과 직접 가져오기</summary><p className="ic-muted">요청문을 구독 중인 AI에 전달하고 받은 JSON을 붙여 넣으세요. 업로드한 이미지는 요청문에 적힌 경로로 사용합니다.</p><label className="ic-field">결과 JSON<textarea disabled={!approved} className="field is-prose" rows={8} value={result} onChange={e=>setResult(e.target.value)} placeholder={'{"variants": [...]}'}/></label><button className="secondary-button" disabled={busy||!approved||!result.trim()} onClick={importResult}>결과 가져오기</button></details>{(bundle.jobs.length > 0 || Boolean(bundle.renders?.length)) && <div className="ic-jobs"><div className="ic-row"><h3>맡긴 일</h3><button className="secondary-button" disabled={busy} onClick={refresh}>상태 새로고침</button></div>
        {bundle.jobs.map(job => <p key={job.id} className="ic-muted">{jobLabels[job.status] || job.status}{job.model && ` · ${job.model}`}{job.target && ` · 출력할 곳 ${targetNames[job.target]}`}{job.failReason && ` · ${job.failReason}`}</p>)}
      </div>}</section>
    </>}
    </>}
    {bundle && !firstDraft && (showTools || Boolean(saved?.batches.length)) && <>
      {refReview && <ImageReferenceSteps current={refReview.preview ? 5 : refReview.copy ? 4 : 3}/>}
      {(!demo || !refFlow) && (showTools || saved?.batches.some(batch=>batch.review?.copy && !batch.review.final && (!batch.review.preview || bundle.renders?.some(row=>row.id===batch.review?.preview?.runId && row.status==="failed")))) && machinePicker}
      <section id="image-creative-results" className="panel panel-pad-lg ic-panel" aria-labelledby="creative-results-title"><h2 id="creative-results-title">{showTools ? "4. 시안 비교·선택" : refReview ? refReview.preview ? "확정" : refReview.copy ? "디자인 수정" : "카피 작성" : "광고 시안 검토"}</h2>
        {editing && <ImageDesignEditor key={editing.id} projectId={bundle.project.id} base={editing}
          assetUrl={bundle.assets.find(a => a.path === editing.asset?.path)?.url}
          onSave={saveDesign} onClose={() => setEditingId("")}/>}
        {saved?.batches.some(batch=>batch.review?.copy) && <label className="ic-check ic-guide-switch"><input type="checkbox" checked={showSafeZone}
          onChange={event => setShowSafeZone(event.target.checked)}/> 결과에 세이프 존 표시</label>}
        {saved?.batches.length ? saved.batches.map((batch,index)=>{const review = <ImageApprovalBatch key={[batch.id,batch.review?.copy?.at,batch.review?.preview?.runId,batch.review?.final?.runId].join("-")} batch={batch} index={index}
          variants={batch.variantIds.map(id=>saved.variants.find(v=>v.id===id)!).filter(Boolean)} assets={bundle.assets}
          projectId={bundle.project.id} target={target} render={bundle.renders?.find(row=>row.id===batch.review?.preview?.runId)}
          demo={demo} guided={!showTools} busy={busy} showGuide={showSafeZone} selectedId={saved.selectedId} rendered={bundle.rendered} reviewable={bundle.reviewable}
          experimentRound={Boolean(experiment && !batch.designRevision && ["appeal","copy","image"].includes(batch.mode))}
          registerWinner={currentRound?.id===batch.id && !saved.formatApproval ? registerWinner : undefined}
          winner={activeImageWinner(batch,saved)} control={saved.variants.find(v=>v.id===batch.baseId)}
          revisions={experiment && !batch.designRevision ? imageExperimentCandidateIds(saved,batch)
            .filter(id=>id !== batch.baseId && !batch.variantIds.includes(id)).flatMap(id=>saved.variants.find(v=>v.id===id) ?? []) : []}
          review={reviewBatch} returnReview={sendBack} edit={setEditingId} select={select} download={download}
          keepBlob={(id,blob)=>{if(blob)previewBlobs.current.set(id,blob);else previewBlobs.current.delete(id);}}/>;
          return showTools || index===saved.batches.length-1 || currentRound?.id===batch.id ? review :
            <details key={batch.id} className="ic-details"><summary>이전 시안 · {index+1}번째 묶음 ({batch.count}장){experiment && batch.winner ? " · 승리 소재 기록됨" : ""}</summary>{review}</details>;
        }) :
          <p className="ic-muted">포맷을 승인하고 첫 카피 후보를 만들어 주세요.</p>}
      </section>
    </>}
    {(!experimentList || bundle) && <button type="button" className="secondary-button ic-actions" disabled={busy} onClick={toggleTools}>{showTools?"단계별 제작으로 돌아가기":"작업 도구"}</button>}
  </div>;
}
