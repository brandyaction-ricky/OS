"use client";

import { useState } from "react";
import Link from "next/link";
import { apiRequest, ApiRequestError } from "@/lib/api-client";
import { CREATIVE_SIZES, IMAGE_FORMAT_IDS, IMAGE_FORMATS, isImageFormat, isWarehouseFormat, type ImageFormatId } from "@/lib/image-creative/formats";
import { activeImageWinner, imageExperimentSummary, latestImageExperimentBatch, approveImageFormat, createImageBatch, selectedImageResults, startImageCopyBatch, imageBriefProblems, type FormatRecommendation, type ImageBatchRequest, type ImageBrief, type ImageFormatPlan } from "@/lib/image-creative/model";
import type { ImageAdProduct } from "@/lib/image-creative/products";
import { ReferenceImageCreation } from "./reference-image-creation";
import { ImageProductFields } from "./image-product-fields";
import { WinnerArtwork } from "./image-approval-batch";
import { ImageFormatPicker } from "./image-format-choice";
import type { ImageProjectBundle, ImageProjectRow } from "./image-creative-workspace";

export type ImagePreviewProduct = ImageAdProduct & { appealPreview?: FormatRecommendation["appeals"] };
export type GuidedImageProps = {
  bundle: ImageProjectBundle | null; brief: ImageBrief; setBrief: (brief: ImageBrief) => void;
  previewProducts?: ImagePreviewProduct[]; localDirectionPlanner?: boolean; demo: boolean; busy: boolean; receive: (next: ImageProjectBundle) => void;
  projects: ImageProjectRow[]; listReady:boolean; experimentList:boolean; reloadList:()=>void; openProject:(id:string)=>void;
  createProject: (name: string, brief: ImageBrief, experiment?:true) => Promise<ImageProjectBundle>;
  patch: (body: Record<string, unknown>, current: ImageProjectBundle) => Promise<ImageProjectBundle>;
  run: (fn: () => Promise<void>) => Promise<void>; refresh: () => void;
  assetPaths: string[]; setAssetPaths: (paths: string[]) => void; upload: (file: File | null) => void;
  leave: () => void; openTools: () => void;
};
const single: ImageFormatPlan = {mode:"standalone",count:1,size:"portrait",referenceFirst:true};
const appeals: ImageFormatPlan = {mode:"appeal",count:5,size:"portrait",appealFirst:true,referenceFirst:true};
const modeName = (mode: ImageBatchRequest["mode"]) => ({standalone:"광고 한 장",initial:"포맷",appeal:"소구점",copy:"카피",image:"이미지"})[mode];

type Direction = NonNullable<FormatRecommendation["direction"]>;
const mediumNames: Record<Direction["medium"],string> = {photo:"인물·상황 사진",character:"캐릭터·일러스트",product:"실제 상품·화면"};

function DirectionFields({concepts, value, busy, onPlan, onCancel}: {
  concepts: string[]; value?: Direction; busy: boolean; onPlan:(direction:Direction)=>void; onCancel?:()=>void;
}) {
  const [custom,setCustom] = useState(Boolean(value && !concepts.includes(value.concept)));
  const [concept,setConcept] = useState(value?.concept ?? "");
  const [medium,setMedium] = useState<Direction["medium"] | "">(value?.medium ?? "");
  return <form className="ic-direction-form" onSubmit={event=>{
    event.preventDefault();
    if (concept.trim() && medium) onPlan({concept:concept.trim(),medium});
  }}>
    <fieldset className="ic-checks ic-direction-concepts" disabled={busy}><legend>광고 컨셉</legend>
      {concepts.map(item=><label className="ic-check" key={item}><input type="radio" name="guided-concept"
        checked={!custom && concept===item} onChange={()=>{setCustom(false);setConcept(item);}}/>{item}</label>)}
      <label className="ic-check"><input type="radio" name="guided-concept" checked={custom}
        onChange={()=>{setCustom(true);setConcept("");}}/>직접 입력</label>
      {custom && <label className="ic-field">내 광고 컨셉<textarea className="field" required maxLength={300} rows={2} value={concept}
        onChange={event=>setConcept(event.target.value)} placeholder="고객이 광고를 보며 어떤 생각을 떠올리면 좋을까요?"/></label>}
    </fieldset>
    <fieldset className="ic-checks" disabled={busy}><legend>표현 방식</legend>
      {(Object.keys(mediumNames) as Direction["medium"][]).map(id=><label className="ic-check" key={id}><input type="radio"
        name="guided-medium" checked={medium===id} onChange={()=>setMedium(id)}/>{mediumNames[id]}</label>)}
    </fieldset>
    <div className="ic-row"><button type="submit" className="primary-button" disabled={busy || !concept.trim() || !medium}>
      장면·포맷 기획하기</button>{onCancel && <button type="button" className="secondary-button" disabled={busy} onClick={onCancel}>돌아가기</button>}</div>
  </form>;
}

export function GuidedImageCreative({projects,listReady,experimentList,reloadList,openProject,bundle,brief,setBrief,previewProducts,localDirectionPlanner,demo,busy,createProject,patch,receive,run,refresh,
  assetPaths,setAssetPaths,upload,leave,openTools}:GuidedImageProps) {
  const [draft, setDraft] = useState<ImageFormatPlan | null>(null);
  const [projectName,setProjectName] = useState("");
  const [selection, setSelection] = useState<{ id: ImageFormatId; proposal: string } | null>(null);
  const [generatePhotoFor, setGeneratePhotoFor] = useState<string>();
  const [copiedJob, setCopiedJob] = useState<string>();
  const [editing, setEditing] = useState(false);
  const [formatStepFor, setFormatStepFor] = useState<string>();
  const [editingDirectionFor,setEditingDirectionFor] = useState<string>();
  const [catalogRevision, setCatalogRevision] = useState(0);
  const [followupKey, setFollowupKey] = useState<string>();
  const [nextCount, setNextCount] = useState(5);
  const [copyField, setCopyField] = useState<"headline"|"body"|"cta">("headline");
  const state = bundle?.state;
  const recommendation = state?.formatRecommendation;
  const proposal = JSON.stringify([bundle?.project.id, state?.brief, recommendation]);
  const picked = selection?.proposal === proposal ? selection.id : null;
  const approved = state?.formatApproval?.request;
  const experiment = state && imageExperimentSummary(state);
  const plan = (editing ? draft : recommendation) ?? draft ?? (experiment && !recommendation ? appeals : null);
  const newest = experiment && state ? latestImageExperimentBatch(state) : state?.batches.at(-1);
  const measured = newest && activeImageWinner(newest,state);
  const winner = state?.variants.find(row => row.id === (experiment ? measured?.variantId : state.selectedId));
  const origin = experiment ? newest : state?.batches.find(row => winner && row.variantIds.includes(winner.id));
  const nextMode = origin?.review?.final
    ? origin.mode === "appeal" ? "copy" : origin.mode === "copy" ? "image"
      : !experiment && (origin.mode === "initial" || origin.mode === "standalone") ? "appeal" : null
    : null;
  const winnerKey = newest && winner ? JSON.stringify([newest.id,winner.id]) : undefined;
  const followup = winnerKey && followupKey === winnerKey ? nextMode : null;
  const chosenPhoto = assetPaths.at(-1);
  function restart() {
    setDraft(null); setSelection(null); setEditing(false); setFollowupKey(undefined); leave();
  }
  function recommend(nextBrief?: ImageBrief) {
    if (!plan) return;
    const input = {...(nextBrief ?? (!editing && state?.formatRecommendation ? state.brief : brief))};
    if (plan.appealFirst) delete input.mainMessage;
    void run(async () => {
      if (!plan.appealFirst && !input.mainMessage?.trim()) throw new Error("광고에서 전할 메인 메시지를 적어 주세요.");
      if (!Number.isInteger(plan.count) || plan.count < 1 || plan.count > 20) throw new Error("후보 수는 1~20개로 정해 주세요.");
      const issue = imageBriefProblems(input,plan.appealFirst)[0];
      if (issue) throw new Error(issue);
      const {mode,count,size,appealFirst} = plan;
      const request = {mode,count,size,...(appealFirst ? {appealFirst} : {}),
        ...(appealFirst && (!demo || localDirectionPlanner) ? {conceptFirst:true as const} : {})};
      try {
        const fallbackTitle = mode === "appeal" ? `${input.product} · A/B 테스트` : `${input.product} · 광고 한 장`;
        const current = bundle ?? await createProject((projectName.trim() || fallbackTitle).slice(0,120),input,appealFirst);
        const ref = input.productSource;
        const example = demo && !localDirectionPlanner && appealFirst && ref ? previewProducts?.find(row=>
          row.id === ref.productId && row.source.id === ref.source.id && row.source.version === ref.source.version &&
          row.audienceSource?.id === ref.audienceSource?.id && row.audienceSource?.version === ref.audienceSource?.version &&
          row.product === input.product && row.audience === input.audience && row.offer === input.offer &&
          row.brand === input.brand && (row.objective ?? "") === input.objective && (row.funnel ?? "") === input.funnel &&
          row.appealPreview?.length === count) : undefined;
        const proposals = demo && localDirectionPlanner && appealFirst
          ? await apiRequest<Pick<FormatRecommendation,"appeals"|"concepts">>("/api/dev/image-ad-direction",{
            method:"POST",body:JSON.stringify({phase:"concepts",brief:input,count}),
          }) : undefined;
        if (demo && localDirectionPlanner && appealFirst && (proposals?.appeals?.length!==count || !proposals?.concepts?.length))
          throw new Error("소구점과 컨셉 제안을 받지 못했어요.");
        const next = demo
          ? {...current, project:{...current.project,version:current.project.version+1}, state:{...current.state,brief:input,formatRecommendation:{
              ...request,...(proposals ?? {items:[],...(example ? {appeals:example.appealPreview} : {})})}}}
          : await patch({action:"recommend-formats",brief:input,...request},current);
        setEditing(false); setSelection(null); setFormatStepFor(undefined); receive(next);
      } catch (error) {
        if (error instanceof ApiRequestError && error.code === "IMAGE_PRODUCT_CHANGED") {
          setDraft({...plan}); setEditing(true); setCatalogRevision(n=>n+1);
        }
        throw error;
      }
    });
  }
  function planScene(direction:Direction, replan=false) {
    if (!bundle || !recommendation?.conceptFirst || !recommendation.appeals?.length) return;
    void run(async()=>{
      let next: ImageProjectBundle;
      if (demo) {
        if (!localDirectionPlanner) throw new Error("새 장면을 기획하려면 구독 AI가 연결된 OS에서 이 단계를 진행해 주세요.");
        const previousScenes = [...(recommendation.previousScenes ?? []), ...(recommendation.scene ? [recommendation.scene] : [])].slice(-8);
        const result = await apiRequest<Pick<FormatRecommendation,"scene"|"items">>("/api/dev/image-ad-direction",{
          method:"POST",body:JSON.stringify({brief:bundle.state.brief,appeals:recommendation.appeals,direction,
            previousScenes,size:recommendation.size}),
        });
        if (!result?.scene || !result.items?.length) throw new Error("장면과 추천 포맷을 받지 못했어요.");
        next={...bundle,project:{...bundle.project,version:bundle.project.version+1},
          state:{...bundle.state,formatRecommendation:{...recommendation,direction,previousScenes,scene:result.scene,items:result.items}}};
      } else next=await patch({action:"plan-scene",direction,...(replan ? {replan:true} : {})},bundle);
      setEditingDirectionFor(undefined);setSelection(null);setAssetPaths([]);setGeneratePhotoFor(undefined);receive(next);
    });
  }
  function approve(request: ImageBatchRequest) {
    if (!bundle) return;
    void run(async () => {
      let next;
      if (demo) {
        const now = new Date().toISOString(), by = "브라우저 체험";
        let nextState = approveImageFormat(bundle.state,request,{by,at:now});
        if (experiment && request.mode === "image" && request.assetPaths?.length === request.count) {
          const photos = request.assetPaths.map(path=>{
            const photo = bundle.assets.find(row=>row.path === path);
            if (!photo) throw new Error("이 프로젝트에 등록한 사진을 선택해 주세요.");
            return photo;
          });
          const base = bundle.state.variants.find(v=>v.id===request.baseId);
          const original = bundle.assets.find(a=>a.path===base?.asset?.path);
          // Demo assets contain data URLs. Compare their bytes, including the control, as the server compares stored hashes.
          const urls = photos.map(p=>p.url.split(",").at(-1));
          if (new Set(urls).size !== urls.length || (original && urls.includes(original.url.split(",").at(-1))))
            throw new Error("기준 사진과 다른 파일을 한 번씩 골라 주세요.");
          const result = selectedImageResults(photos,request.assetPaths);
          const batch = createImageBatch(nextState,request,result,{now,by,newId:()=>crypto.randomUUID(),assets:bundle.assets});
          nextState = startImageCopyBatch(nextState,batch,request);
        }
        next = {...bundle,project:{...bundle.project,version:bundle.project.version+1},state:nextState};
      } else next = await patch({action:"approve-and-generate",request},bundle);
      setFollowupKey(undefined); receive(next);
    });
  }
  function editPlan() {
    if (!plan) return;
    if (state) setBrief(state.brief);
    setEditing(true); setDraft({...plan});
  }
  const job = (phase:"formats"|"copy") => bundle?.jobs.find(row => row.currentInput !== false && (row.phase ?? "copy") === phase);
  function jobPanel(phase:"formats"|"copy") {
    const current = job(phase);
    const working = current && ["backlog","active"].includes(current.status);
    const imagePhase = phase === "copy" && approved?.mode === "image";
    const direction = recommendation?.direction;
    const newPhoto = phase === "copy" && Boolean(approved && !approved.baseId && !approved.assetPaths?.length &&
      (direction ? direction.medium !== "product" : approved.formatIds?.includes("thumbnail_subject")));
    const imageName = direction?.medium==="character" ? "일러스트" : "사진";
    const photoRequest = current && `OS 이미지 광고 작업 ${current.id}을 받아 공통 ${imageName} 한 장과 카피를 만들어 줘.`;
    const productionName = direction?.medium==="character" ? "일러스트와 카피" : "사진과 카피";
    const [subject,activeTitle] = phase === "copy"
      ? imagePhase ? ["이미지 후보","AI가 이미지 후보를 준비하고 있어요"]
        : newPhoto ? [productionName,`AI가 ${productionName}를 만들고 있어요`] : ["카피","AI가 카피를 쓰고 있어요"]
      : direction ? ["장면·포맷 기획","AI가 장면과 포맷을 기획하고 있어요"]
        : plan?.appealFirst ? ["소구점 제안","AI가 소구점을 제안하고 있어요"] : ["추천 포맷","AI가 포맷을 고르고 있어요"];
    return <section className="panel panel-pad-lg ic-panel" aria-live="polite">
      <h2>{working ? (current.status === "active" ? activeTitle : `${subject} 요청이 대기 중이에요`) : `${subject} 요청을 확인해 주세요`}</h2>
      {phase==="formats" && direction && <p>{direction.concept} · {mediumNames[direction.medium]}</p>}
      {working ? <p>{current.status==="backlog" ? "연결된 개인 AI가 요청을 받으면 시작합니다. " : ""}완료되면 이 작업에 표시됩니다.</p>
        : <p>{current?.failReason || "연결된 개인 AI에서 작업을 이어갈 수 있습니다."}</p>}
      {working ? <button className="secondary-button" disabled={busy} onClick={refresh}>상태 새로고침</button>
        : <button className="primary-button" disabled={busy} onClick={()=> {
          if (phase === "formats" && direction) planScene(direction);
          else if (phase === "formats") recommend();
          else if (imagePhase && experiment && approved && approved.assetPaths?.length === approved.count) approve(approved);
          else if (approved && bundle) void run(async()=>receive(await patch({action:"generate",request:approved,guided:true},bundle)));
        }}>{subject} 다시 요청하기</button>}
      {newPhoto && current && current.status === "backlog" && <div>
        <p>원본을 만들려면 OS에 연결한 Codex 채팅에 아래 문장을 보내세요.</p>
        <pre><code>{photoRequest}</code></pre>
        <button type="button" className="secondary-button" disabled={busy} onClick={()=>void run(async()=>{
          await navigator.clipboard.writeText(photoRequest!); setCopiedJob(current.id);
        })}>{copiedJob === current.id ? "요청문 복사됨" : "요청문 복사"}</button>
      </div>}
      {current?.status !== "active" && <details className="ic-details"><summary>AI 연결 확인</summary>
        {!newPhoto && <p>연결한 Claude나 Codex에 “OS의 내 이미지 광고 작업을 처리해 줘”라고 요청할 수 있어요.</p>}
        <Link href="/settings/access">내 AI 연결 설정</Link>
        {!newPhoto && <><p>Claude Code에 구독으로 로그인한 Mac에서 자동 수신하려면 실행 파일을 다운로드 폴더에 받고 터미널에서 아래 명령을 실행해 두세요.</p>
        <a href="/myin-local/image-ad-subscription.mjs" download>자동 수신 실행 파일 받기</a>
        <pre><code>node ~/Downloads/image-ad-subscription.mjs</code></pre></>}</details>}
    </section>;
  }
  function chooseImages(multiple:boolean, allowNewPhoto = false) {
    if (!bundle) return null;
    const medium = !multiple ? recommendation?.direction?.medium : undefined;
    const name = medium==="product" ? "상품 원본" : medium==="character" ? "일러스트" : "사진";
    return <fieldset className="ic-checks ic-actions"><legend>{multiple?"테스트할 사진":`광고에 사용할 ${name}`}</legend>
      {allowNewPhoto && <label className="ic-check"><input type="radio" name="guided-photo" disabled={busy}
        checked={!chosenPhoto && generatePhotoFor === proposal} onChange={()=>{setAssetPaths([]);setGeneratePhotoFor(proposal);}}/>
        구독 AI로 {plan?.appealFirst ? "공통 " : ""}{name} 한 장 만들기</label>}
      {bundle.assets.map((asset,index)=><label className="ic-check" key={asset.path}>
        <input type={multiple?"checkbox":"radio"} name="guided-photo" checked={multiple ? assetPaths.includes(asset.path) : chosenPhoto === asset.path}
          disabled={busy || (multiple && asset.path === winner?.asset?.path)} onChange={e=>setAssetPaths(multiple ? e.target.checked?[...assetPaths,asset.path]:assetPaths.filter(path=>path!==asset.path) : [asset.path])}/>
        {/* eslint-disable-next-line @next/next/no-img-element -- private signed project image */}
        <img src={asset.url} width={52} height={52} alt={`${name} ${index+1}`}/>{multiple && asset.path === winner?.asset?.path && "기준 사진"}
      </label>)}
      <label className="secondary-button">{name} 올리기<input className="ic-sr" type="file" accept="image/png,image/jpeg" disabled={busy}
        onChange={e=>{upload(e.target.files?.[0] ?? null);e.target.value="";}}/></label>
    </fieldset>;
  }
  const listHref = "/content/images?view=tests";
  const statusLabel = (summary:NonNullable<ImageProjectRow["experiment"]>) => {
    const stage = `${modeName(summary.stage)} 테스트`;
    const status = {preparing:"준비 중",review:"시안 검토 중",awaiting_result:"집행 결과 대기",winner_recorded:"승리 소재 기록됨",complete:"완료"}[summary.status];
    return `${stage} · ${status}`;
  };
  const projectTitle = bundle && <header className="ic-row ic-guided-actions">
    <div><strong>{bundle.project.title}</strong>{experiment && <p className="ic-muted">{statusLabel(experiment)}</p>}</div>
    {experiment ? <a href={listHref} className="secondary-button" role="button">프로젝트 목록</a>
      : <button type="button" className="secondary-button" disabled={busy} onClick={restart}>다른 작업</button>}
  </header>;
  const firstBatch = state?.batches[0];
  if ((recommendation?.referenceFirst || (!recommendation && plan?.referenceFirst)) &&
      (!firstBatch || (state?.batches.length === 1 && !firstBatch.review?.copy && !firstBatch.review?.history.some(h=>h.step==="copy" && h.decision==="approved") && !approved?.baseId))) {
    return <>{projectTitle}<ReferenceImageCreation plan={plan!} brief={brief} setBrief={setBrief} bundle={bundle}
      previewProducts={previewProducts} localDirectionPlanner={localDirectionPlanner} demo={demo} busy={busy}
      createProject={createProject} patch={patch} receive={receive} run={run} refresh={refresh}
      assetPaths={assetPaths} setAssetPaths={setAssetPaths} upload={upload} leave={restart}/></>;
  }
  if (approved && bundle) return <>{projectTitle}{demo ? <section className="panel panel-pad-lg ic-panel"><h2>포맷을 승인했어요</h2>
    <p>체험 모드에서는 카피를 직접 가져와서 다음 단계를 확인할 수 있어요.</p><button className="secondary-button" onClick={openTools}>카피 직접 가져오기</button></section> : jobPanel("copy")}</>;
  if (newest && (!newest.review?.final || !followup)) return <>{projectTitle}{newest.review?.final && <section className="panel panel-pad-lg ic-panel">
    {experiment && !winner && <><h2>집행 결과 대기</h2><p>광고 결과를 확인한 뒤 아래 시안에서 승리 소재를 지정하세요.</p></>}
    {winner && <><h2>{experiment ? `${modeName(newest.mode)} 테스트 승리 소재` : "선택한 시안으로 다음 테스트"}</h2>
      <p><strong>{winner.copy.headline}</strong> · {winner.appeal.meaning}</p>
      {measured?.note && <p className="ic-muted">결과 메모 · {measured.note}</p>}
      {nextMode && <button className="primary-button" disabled={busy} onClick={()=>{setFollowupKey(winnerKey);setNextCount(5);setCopyField("headline");setAssetPaths([]);}}>
        {modeName(nextMode)} 테스트 시작</button>}</>}
  </section>}</>;
  if (followup && winner && bundle && followup===nextMode) {
    const imageCount = followup === "image" ? assetPaths.length : nextCount;
    return <>{projectTitle}<section className="panel panel-pad-lg ic-panel">
      <h2>{modeName(followup)} 테스트</h2><p>기준 시안 · <strong>{winner.copy.headline}</strong></p>
      {experiment && <div className="ic-winner-thumb"><WinnerArtwork variant={winner} projectId={bundle.project.id} url={bundle.rendered?.[winner.id]}
        demo={demo} photo={bundle.assets.find(a=>a.path===winner.asset?.path)?.url}/></div>}
      {experiment && <p className="ic-muted">{followup==="copy" ? "승리한 소구점과 이미지를 유지하고 선택한 문구를 바꿉니다." : "승리한 소구점과 카피를 유지하고 사진을 바꿉니다."}</p>}
      {followup === "image" ? chooseImages(true) : <label className="ic-field">후보 수<input className="field" type="number" min={1} max={20}
        value={nextCount} onChange={e=>setNextCount(Math.max(1,Math.min(20,Number(e.target.value)||1)))}/></label>}
      {followup === "copy" && <label className="ic-field">바꿀 문구<select className="field" value={copyField}
        onChange={e=>setCopyField(e.target.value as typeof copyField)}><option value="headline">제목</option><option value="body">본문</option>
        {IMAGE_FORMATS[winner.formatId].version !== 2 && <option value="cta">버튼</option>}</select></label>}
      <p>{IMAGE_FORMATS[winner.formatId].name} · {CREATIVE_SIZES[winner.size].label}</p>
      <div className="ic-row"><button className="primary-button" disabled={busy || !imageCount || imageCount>20} onClick={()=>approve({mode:followup,count:imageCount,
        baseId:winner.id,...(followup==="copy"?{copyFields:[copyField]}:{}),...(followup==="image"?{assetPaths}:{})})}>{followup === "image" ? `이미지 후보 ${imageCount}개 만들기` : `포맷 승인 · 후보 ${imageCount}개 만들기`}</button>
        <button className="secondary-button" disabled={busy} onClick={()=>setFollowupKey(undefined)}>취소</button></div>
    </section></>;
  }
  if (!plan && !bundle && experimentList) {
    const tests = projects.filter(row=>row.experiment);
    return <section className="panel panel-pad-lg ic-panel" aria-labelledby="experiment-list-title">
      <div className="ic-row ic-project-heading"><h2 id="experiment-list-title">A/B 테스트 프로젝트</h2>
        <button type="button" className="primary-button" onClick={()=>setDraft({...appeals})}>새 테스트 프로젝트</button></div>
      {!!tests.length && <ul className="ic-experiment-list">{tests.map(row=>
        <li key={row.id}><a href={`/content/images?project=${encodeURIComponent(row.id)}`}><strong>{row.title}</strong>
          <span>{statusLabel(row.experiment!)}</span>{row.updatedAt && <time dateTime={row.updatedAt}>{new Date(row.updatedAt).toLocaleString("ko-KR",{dateStyle:"short",timeStyle:"short"})}</time>}</a></li>)}</ul>}
      {!tests.length && <p className="ic-muted">{listReady ? "아직 A/B 테스트 프로젝트가 없습니다." : "프로젝트 목록을 불러오는 중이에요."}</p>}
      {!listReady && <button type="button" className="secondary-button" disabled={busy} onClick={reloadList}>목록 다시 불러오기</button>}
      {/* eslint-disable-next-line @next/next/no-html-link-for-pages -- the workspace restores the project view from the URL on entry. */}
      <a className="secondary-button" href="/content/images" role="button">이미지 광고 홈</a>
    </section>;
  }
  if (!plan) return <>{projectTitle}<section className="ic-guided-start" aria-labelledby="guided-choice"><h2 id="guided-choice">무엇을 만들까요?</h2>
    <div className="ic-guided-intents">
      <button type="button" className="ic-guided-intent" aria-label="광고 한 장 만들기" disabled={busy}
        onClick={()=>setDraft({...single})}><strong>광고 한 장 만들기</strong><span>메시지 하나를 담은 이미지 광고</span></button>
      <a className="ic-guided-intent" href={listHref} role="button" aria-label="여러 안 테스트하기">
        <strong>여러 안 테스트하기</strong><span>프로젝트별 소구점 · 카피 · 이미지 테스트</span></a>
    </div>
    {!bundle && projects.some(row=>!row.experiment) && <label className="ic-field ic-actions">이전 작업 이어하기
      <select className="field" disabled={busy} value="" onChange={e=>{if(e.target.value)openProject(e.target.value);}}>
        <option value="">작업 선택</option>{projects.filter(row=>!row.experiment).map(row=><option key={row.id} value={row.id}>{row.title}</option>)}
      </select></label>}
  </section></>;
  if (!recommendation || editing) {
    const settings = <details className="ic-details"><summary>{plan.mode === "appeal" ? `테스트 설정 · 소구점 ${plan.count}개` : "광고 크기 변경"}</summary>
      {plan.mode === "appeal" && <label className="ic-field">소구점 수<input className="field" type="number" min={1} max={20} required disabled={busy} value={plan.count || ""}
        onChange={e=>setDraft({...plan,count:Number(e.target.value)})}/></label>}
      <label className="ic-field">광고 크기<select className="field" disabled={busy} value={plan.size} onChange={e=>setDraft({...plan,size:e.target.value as ImageFormatPlan["size"]})}>
        {Object.entries(CREATIVE_SIZES).map(([id,format])=><option value={id} key={id}>{format.label}</option>)}</select></label>
    </details>;
    return <>{projectTitle}<form className="panel panel-pad-lg ic-panel ic-guided-brief" onSubmit={event=>{event.preventDefault();recommend(brief);}}>
      <h2>{plan.mode === "standalone" ? "광고 한 장 만들기" : "소구점 테스트"}</h2>
      {plan.appealFirst && !bundle && <label className="ic-field">프로젝트 이름 (선택)<input className="field" value={projectName} maxLength={120} onChange={e=>setProjectName(e.target.value)} placeholder="예: 무료 진단 · 11월 신규 고객"/></label>}
      {plan.appealFirst && <><p>상품을 고르면 AI가 타겟과 제공 내용을 보고 서로 다른 소구점을 제안합니다.</p>{settings}</>}
      {demo && localDirectionPlanner && plan.appealFirst && busy && <p role="status">구독 AI가 이 상품의 소구점과 컨셉을 기획하고 있어요.</p>}
      <ImageProductFields brief={brief} setBrief={setBrief} previewProducts={previewProducts} revision={catalogRevision} disabled={busy}
        onProductChosen={plan.appealFirst ? recommend : undefined}/>
      {!plan.appealFirst && <><label className="ic-field">메인 메시지<textarea className="field" required rows={2} maxLength={2000} value={brief.mainMessage ?? ""}
        onChange={e=>setBrief({...brief,mainMessage:e.target.value})} placeholder="고객에게 꼭 전하고 싶은 한 가지를 적어 주세요."/></label>{settings}</>}
      <div className="ic-row ic-guided-actions">{(!plan.appealFirst || brief.product || brief.audience || brief.offer) && <button className="primary-button" disabled={busy} type="submit">
        {plan.appealFirst ? `소구점 ${plan.count}개 제안받기` : demo?"기획 저장 · 포맷 보기":"AI 포맷 추천받기"}</button>}
        <button className="secondary-button" disabled={busy} type="button" onClick={()=>{
          if (editing && recommendation) {setEditing(false); if (state) setBrief(state.brief);} else restart();
        }}>뒤로</button></div>
    </form></>;
  }
  if (demo && recommendation.appealFirst && !recommendation.appeals?.length) return <>{projectTitle}<section className="panel panel-pad-lg ic-panel">
    <h2>직원 AI 연결이 필요해요</h2><p>이 상품과 개수에 맞는 저장된 제안이 없습니다. 로그인한 OS에서 상품을 고르면 내 AI가 소구점을 제안합니다.</p>
    <button type="button" className="secondary-button" onClick={editPlan}>기획 수정</button></section></>;
  const directed = recommendation.conceptFirst === true;
  const direction = recommendation.direction;
  const showDirection = directed && Boolean(recommendation.appeals?.length) && (!direction || editingDirectionFor===proposal);
  if (!recommendation.items && !showDirection) return <>{projectTitle}{jobPanel("formats")}
    {directed && direction && <button type="button" className="secondary-button ic-actions" disabled={busy}
      onClick={()=>setEditingDirectionFor(proposal)}>컨셉·표현 방식 수정</button>}</>;
  if (showDirection || (!directed && recommendation.appealFirst && formatStepFor !== proposal)) return <>{projectTitle}<section className="panel panel-pad-lg ic-panel" aria-live="polite">
    <div className="ic-row"><h2>{demo && !localDirectionPlanner ? "저장된 AI 제안 예시" : "AI 소구점 제안"} {recommendation.appeals?.length}개</h2>
      <button type="button" className="secondary-button" disabled={busy} onClick={editPlan}>기획 수정</button></div>
    <ol className="ic-appeal-list">{recommendation.appeals?.map(item=><li key={item.id}>{item.meaning}</li>)}</ol>
    <details className="ic-details"><summary>제안에 사용한 상품 정보</summary><dl className="ic-copy-lines">
      <dt>상품</dt><dd>{state?.brief.product}</dd><dt>타겟</dt><dd>{state?.brief.audience}</dd><dt>제공 내용</dt><dd>{state?.brief.offer}</dd></dl></details>
    {showDirection ? <>
      <h2 className="ic-direction-title">컨셉과 표현 방식</h2>
      <p className="ic-muted">컨셉과 표현 방식을 고르면 구독 AI가 공통 장면을 새로 기획하고 포맷을 추천합니다.</p>
      <DirectionFields key={proposal} concepts={recommendation.concepts ?? []} value={direction} busy={busy}
        onPlan={next=>planScene(next, Boolean(recommendation.scene && next.concept===direction?.concept && next.medium===direction.medium))}
        onCancel={direction ? ()=>setEditingDirectionFor(undefined) : undefined}/>
      {demo && busy && <p role="status">구독 AI가 선택한 컨셉으로 장면을 기획하고 있어요.</p>}
    </> : <button type="button" className="primary-button ic-guided-actions" disabled={busy || !recommendation.appeals?.length} onClick={()=>setFormatStepFor(proposal)}>공통 포맷 선택하기</button>}
  </section></>;
  const spec = picked ? IMAGE_FORMATS[picked] : null;
  const photo = spec?.supportsAsset && chosenPhoto ? [chosenPhoto] : [];
  const allowNewPhoto = !demo && (direction ? Boolean(spec?.assetRequired && direction.medium!=="product") : picked === "thumbnail_subject");
  const makePhoto = allowNewPhoto && !photo.length && generatePhotoFor === proposal;
  const needsPhoto = spec?.assetRequired && !photo.length && !makePhoto;
  const note = !picked ? "사용할 디자인을 한 가지 선택해 주세요." : needsPhoto
    ? (direction?.medium==="product" ? "이 광고에 사용할 실제 상품 원본을 올리거나 선택하세요."
      : allowNewPhoto ? "원본을 고르거나 구독 AI로 만들기를 선택하세요." : "이 포맷에 사용할 원본 한 장을 올리거나 선택해 주세요.") : "";
  const items = recommendation.items ?? [];
  const assetHint = direction && {photo:"공통 사진 사용",character:"공통 일러스트 사용",product:"실제 상품 원본 사용"}[direction.medium];
  return <>{projectTitle}<section className="panel panel-pad-lg ic-panel"><div className="ic-row"><h2>{direction ? "장면과 추천 포맷" : "제작할 포맷 선택"}</h2>
    {recommendation.appealFirst
      ? (direction ? <button type="button" className="secondary-button" disabled={busy} onClick={()=>setEditingDirectionFor(proposal)}>컨셉·표현 방식 수정</button>
        : <button className="secondary-button" disabled={busy} onClick={()=>setFormatStepFor(undefined)}>소구점 다시 보기</button>)
      : <button className="secondary-button" disabled={busy} onClick={editPlan}>기획 수정</button>}</div>
    {direction && <div className="ic-direction-scene"><p className="ic-muted">{direction.concept} · {mediumNames[direction.medium]}</p>
      <h3>이번에 보여줄 장면</h3><p>{recommendation.scene}</p>
      <button type="button" className="secondary-button" disabled={busy} onClick={()=>planScene(direction,true)}>같은 컨셉으로 새 장면 기획</button>
      {demo && busy && <p role="status">다른 장면과 추천 포맷을 기획하고 있어요.</p>}</div>}
    {state?.brief.mainMessage && <p>{state.brief.mainMessage}</p>}
    <p className="ic-muted">{direction
      ? `아래 이미지는 포맷의 배치 예시입니다. 소구점 ${plan.count}개는 같은 포맷과 ${direction.medium === "character" ? "이번 장면의 일러스트" : direction.medium === "product" ? "실제 상품 원본" : "이번 장면의 사진"}, 같은 버튼 문구로 비교합니다.`
      : recommendation.appealFirst ? `소구점 ${plan.count}개를 비교할 디자인 한 가지를 선택하세요. 포맷·사진·버튼 문구는 모든 안에서 같게 유지합니다.` : "아래 이미지는 디자인 예시예요. 포맷을 고르면 입력한 메시지로 광고 문구를 만듭니다."}</p>
    <ImageFormatPicker recommendations={items.filter(row=>isImageFormat(row.id))} assetHint={assetHint}
      size={plan.size} availableIds={direction ? items.map(row=>row.id) : state?.brief.brand?.trim() ? IMAGE_FORMAT_IDS : IMAGE_FORMAT_IDS.filter(id=>!isWarehouseFormat(id))} selected={picked?[picked]:[]} onSelect={id=>setSelection({id,proposal})} disabled={busy}/>
    {spec?.supportsAsset && chooseImages(false, allowNewPhoto)}
    {demo && !direction && picked === "thumbnail_subject" && !photo.length && <a href="/image-format-test/thumbnail-subject.jpg" download="썸네일-예시-원본.jpg">예시 사진 내려받기</a>}
    {note && <p className="ic-muted" id="guided-approve-hint">{note}</p>}
    <button className="primary-button ic-guided-actions" disabled={Boolean(note)||busy}
      aria-describedby={note?"guided-approve-hint":undefined}
      onClick={()=>picked && approve({mode:plan.mode,count:plan.count,size:plan.size,formatIds:[picked],assetPaths:photo})}>
      포맷 승인 · {makePhoto ? (direction?.medium==="character" ? "일러스트 1장과 " : "사진 1장과 ") : ""}카피 {plan.count}개 만들기</button>
  </section></>;
}
