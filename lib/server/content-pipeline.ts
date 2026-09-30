import { createHash } from "node:crypto";
import type { z } from "zod";
import { ApiError } from "@/lib/http";
import { hasCurrentApproval, pickedPackaging, planningSelectionReady, pipelineArtifacts, pipelineMissing, type PipelineReview, type PipelineRun } from "@/lib/content-pipeline";
import { SCRIPT_REVIEW_SCHEMA_VERSION, SCRIPT_REVIEW_STEPS, scriptReviewStepLabel, scriptReviewWorkflowOf, type ScriptReviewDecision, type ScriptReviewState, type ScriptReviewStep } from "@/lib/content-script-review";
import { WRITING_WORKFLOW_SCHEMA_VERSION, WRITING_WORKFLOW_STEPS, writingStepLabel, writingWorkflowOf, type WritingPreparationStep, type WritingWorkflowReview, type WritingWorkflowState, type WritingWorkflowStep } from "@/lib/content-writing-workflow";
import type { OsRecord } from "@/lib/record-types";
import type { RequestActor } from "./auth";
import { executeGeneration, generationProcedureRevision, generationSchema } from "./content-generation";

function digest(value: unknown) { return createHash("sha256").update(JSON.stringify(value)).digest("hex"); }
function sourceInput(source: OsRecord) {
  return { title: source.title, description: source.description, sourceUrl: source.source_url,
    audience: source.metadata.audience, evidence: source.metadata.evidence, experience: source.metadata.experience, coreMessage: source.metadata.coreMessage,
    researchBrief: source.metadata.researchBrief, pickedCandidate: source.metadata.pickedCandidate,
    planningPackageId: source.metadata.planningPackageId, planningPackageVersion: source.metadata.planningPackageVersion };
}
function reference(record: OsRecord | null) { return record ? [record.id, record.version] : null; }
function candidateText(candidate: Record<string, unknown> | null) {
  return String(candidate?.text ?? candidate?.title ?? "").trim();
}

export function writingWorkflowState(source: OsRecord, packaging: OsRecord | null, planningApproved: boolean): WritingWorkflowState {
  const workflow = writingWorkflowOf(source.metadata.writingWorkflow);
  const picked = pickedPackaging(packaging);
  const packageTitle = candidateText(picked.title);
  const packageCopy = candidateText(picked.copy);
  const packageReady = Boolean(packaging && picked.ready && packageTitle && packageCopy);
  const currentPackage = Boolean(packaging && workflow.packageId === packaging.id && workflow.packageVersion === packaging.version);
  const signatures: Record<WritingWorkflowStep, string> = {
    package: digest(["writing-package-v1", reference(packaging), picked.title, picked.copy]),
    materials: "",
    axis: "",
    design: "",
  };
  signatures.materials = digest(["writing-materials-v1", signatures.package, workflow.materials]);
  signatures.axis = digest(["writing-axis-v1", signatures.materials, workflow.axis]);
  signatures.design = digest(["writing-design-v1", signatures.axis, workflow.design]);
  const lastReview = (step: WritingWorkflowStep) => workflow.reviews.filter((review) => review.step === step).at(-1) ?? null;
  const approved: Record<WritingWorkflowStep, boolean> = { package: false, materials: false, axis: false, design: false };
  for (const step of WRITING_WORKFLOW_STEPS) {
    const priorApproved = step === "package" ? planningApproved : approved[WRITING_WORKFLOW_STEPS[WRITING_WORKFLOW_STEPS.indexOf(step) - 1]];
    const latest = lastReview(step);
    approved[step] = Boolean(priorApproved && currentPackage && latest?.approved === true && latest.signature === signatures[step]);
  }
  const contents: Record<WritingWorkflowStep, string> = {
    package: [packageTitle, packageCopy].filter(Boolean).join("\n"),
    materials: workflow.materials,
    axis: workflow.axis,
    design: workflow.design,
  };
  const blockers: Record<WritingWorkflowStep, string> = {
    package: !packageReady ? "제목과 썸네일 카피를 각각 한 개 채택해 주세요." : !planningApproved ? "현재 기획·근거를 먼저 승인해 주세요." : "",
    materials: !approved.package ? "현재 패키징을 먼저 확정해 주세요." : !workflow.materials ? "출처·핵심 사실·한계를 적어 주세요." : "",
    axis: !approved.materials ? "자료 탐색 결과를 먼저 승인해 주세요." : !workflow.axis ? "한 문장 핵심 메시지와 포함·제외 범위를 적어 주세요." : "",
    design: !approved.axis ? "핵심 축을 먼저 승인해 주세요." : !workflow.design ? "도입·본문·마무리 순서와 표현 방식을 적어 주세요." : "",
  };
  const steps = WRITING_WORKFLOW_STEPS.map((step, index) => {
    const priorApproved = index === 0 || approved[WRITING_WORKFLOW_STEPS[index - 1]];
    const canEdit = step !== "package" && currentPackage && priorApproved;
    const canApprove = !blockers[step] && (step === "package" ? planningApproved && packageReady : canEdit && Boolean(contents[step]));
    return { key: step, label: writingStepLabel(step), content: contents[step], signature: signatures[step], approved: approved[step], canEdit, canApprove, blocker: blockers[step], lastReview: lastReview(step) };
  });
  const next = steps.find((step) => !step.approved);
  const nextAction = !next ? "원고 생성 또는 직접 작성"
    : next.canApprove ? `${next.label} 승인`
      : next.key === "package" ? `${next.label} 준비`
        : !next.content ? `${next.label} 작성` : `${next.label} 확인`;
  return {
    packageId: packaging?.id ?? null,
    packageVersion: packaging?.version ?? null,
    packageTitle,
    packageCopy,
    packageReady,
    currentPackage,
    steps,
    ready: approved.design,
    nextAction,
    blocker: next?.blocker ?? "",
  };
}

export function scriptReviewWorkflowState(source: OsRecord, script: OsRecord | null, writingReady: boolean): ScriptReviewState {
  const workflow = scriptReviewWorkflowOf(source.metadata.scriptReviewWorkflow);
  const currentScript = Boolean(script && workflow.scriptId === script.id && workflow.scriptVersion === script.version);
  const contents = Object.fromEntries(SCRIPT_REVIEW_STEPS.map((step) => [step, workflow[step]])) as Record<ScriptReviewStep, string>;
  const lastReview = (step: ScriptReviewStep) => workflow.reviews.filter((review) => review.step === step).at(-1) ?? null;
  const steps = SCRIPT_REVIEW_STEPS.map((step) => {
    const signature = digest(["script-review-v1", reference(script), source.metadata.writingWorkflow, step, contents[step]]);
    const latest = lastReview(step);
    const blocker = !script?.description.trim() ? "검수할 원고를 먼저 작성해 주세요."
      : !writingReady ? "현재 패키징·자료·축·영상 설계를 먼저 승인해 주세요."
        : !contents[step] ? `${scriptReviewStepLabel(step)} 검수 결과와 수정 내용을 적어 주세요.`
          : !currentScript ? "원고가 변경되었습니다. 현재 버전으로 검수 메모를 다시 저장해 주세요." : "";
    const canEdit = Boolean(script?.description.trim() && writingReady);
    const canApprove = canEdit && currentScript && Boolean(contents[step]);
    const approved = Boolean(canApprove && latest?.approved === true && latest.signature === signature);
    return { key: step, label: scriptReviewStepLabel(step), content: contents[step], signature, approved, canEdit, canApprove, blocker, lastReview: latest };
  });
  const next = steps.find((step) => !step.approved);
  const changed = Boolean(script && workflow.scriptId && !currentScript);
  const blocker = !script?.description.trim() ? "검수할 원고가 없습니다."
    : !writingReady ? "원고 전 작업의 현재 승인이 필요합니다."
      : changed ? "원고가 변경되어 네 검수 항목을 다시 확인해야 합니다."
        : next?.blocker ?? "";
  return {
    scriptId: script?.id ?? null,
    scriptVersion: script?.version ?? null,
    scriptTitle: script?.title ?? "",
    currentScript,
    steps,
    ready: steps.length > 0 && steps.every((step) => step.approved),
    nextAction: next ? (!next.content || !currentScript ? `${next.label} 검수 메모 저장` : `${next.label} 검수 승인`) : "콘텐츠 제작·편집 준비",
    blocker,
  };
}

export function gateSignature(source: OsRecord, records: OsRecord[], gate: number) {
  const artifacts = pipelineArtifacts(records);
  return digest([sourceInput(source), reference(artifacts.appeals), reference(artifacts.research), ...(gate >= 2 ? [reference(artifacts.script), reference(artifacts.packaging)] : []),
    ...(gate >= 2 ? [source.metadata.writingWorkflow, source.metadata.scriptReviewWorkflow] : []),
    ...(gate >= 3 ? [reference(artifacts.kit), artifacts.clips.map(reference).sort(), source.metadata.finalVideoUrl, source.metadata.transcriptSrt, source.metadata.shortsStyle] : [])]);
}

export async function readPipeline(actor: RequestActor, id: string) {
  const { data: source, error } = await actor.supabase.from("os_records").select("*").eq("id", id).eq("record_type", "content_topic").is("archived_at", null).maybeSingle();
  if (error || !source) throw new ApiError(404, "CONTENT_SOURCE_NOT_FOUND", "기준 콘텐츠를 찾지 못했습니다.");
  const records: OsRecord[] = [];
  for (let offset = 0; ; offset += 200) {
    const { data, error: childError } = await actor.supabase.from("os_records").select("*").eq("parent_id", id).is("archived_at", null).order("id").range(offset, offset + 199);
    if (childError) throw new ApiError(500, "PIPELINE_READ_FAILED", "공정 산출물을 읽지 못했습니다.");
    records.push(...(data ?? [])); if (!data || data.length < 200) break;
  }
  const reviews = (Array.isArray(source.metadata.pipelineReviews) ? source.metadata.pipelineReviews : []) as PipelineReview[];
  const signatures = [1, 2, 3].map((gate) => gateSignature(source, records, gate));
  const matches = signatures.map((signature, index) => hasCurrentApproval(reviews, index + 1, signature));
  const approved = matches.map((_, index) => matches.slice(0, index + 1).every(Boolean));
  const artifacts = pipelineArtifacts(records);
  const writing = writingWorkflowState(source as OsRecord, artifacts.packaging, approved[0]);
  const scriptReview = scriptReviewWorkflowState(source as OsRecord, artifacts.script, writing.ready);
  return { source: source as OsRecord, records, reviews, signatures, approved, writing, scriptReview, missing: [1, 2, 3].map((gate) => pipelineMissing(source, records, gate, writing, scriptReview)) };
}

async function saveMetadata(actor: RequestActor, source: OsRecord, changes: Record<string, unknown>) {
  const { data, error } = await actor.supabase.from("os_records").update({ metadata: { ...source.metadata, ...changes }, updated_by: actor.id })
    .eq("id", source.id).eq("version", source.version).is("archived_at", null).select("*").maybeSingle();
  if (error) throw new ApiError(500, "PIPELINE_SAVE_FAILED", "공정 이력을 저장하지 못했습니다.");
  if (!data) throw new ApiError(409, "PIPELINE_CHANGED", "다른 작업이 먼저 변경했습니다. 새로 불러와 주세요.");
  return data as OsRecord;
}

function assertExpectedVersion(source: OsRecord, expectedVersion: number) {
  if (source.version !== expectedVersion) throw new ApiError(409, "PIPELINE_CHANGED", "다른 작업이 먼저 변경했습니다. 새로 불러와 주세요.");
}

export async function saveWritingPreparation(actor: RequestActor, id: string, expectedVersion: number, step: WritingPreparationStep, content: string) {
  const state = await readPipeline(actor, id);
  assertExpectedVersion(state.source, expectedVersion);
  const stepState = state.writing.steps.find((item) => item.key === step);
  if (!stepState?.canEdit) throw new ApiError(409, "WRITING_STEP_BLOCKED", stepState?.blocker || "이전 단계를 먼저 완료해 주세요.");
  const cleaned = content.trim();
  if (!cleaned) throw new ApiError(400, "WRITING_CONTENT_REQUIRED", `${stepState.label} 내용을 입력해 주세요.`);
  const workflow = writingWorkflowOf(state.source.metadata.writingWorkflow);
  return saveMetadata(actor, state.source, { writingWorkflow: {
    ...workflow,
    schemaVersion: WRITING_WORKFLOW_SCHEMA_VERSION,
    packageId: state.writing.packageId,
    packageVersion: state.writing.packageVersion,
    [step]: cleaned,
  } });
}

export async function reviewWritingPreparation(actor: RequestActor, id: string, expectedVersion: number, step: WritingWorkflowStep, approved: boolean, note: string) {
  const state = await readPipeline(actor, id);
  assertExpectedVersion(state.source, expectedVersion);
  const stepState = state.writing.steps.find((item) => item.key === step);
  if (!stepState) throw new ApiError(400, "WRITING_STEP_INVALID", "작업 단계를 확인해 주세요.");
  if (approved && !stepState.canApprove) throw new ApiError(409, "WRITING_STEP_BLOCKED", stepState.blocker || "승인 전 내용을 저장해 주세요.");
  if (!approved && !note.trim()) throw new ApiError(400, "REVIEW_REASON_REQUIRED", "수정 요청 사유를 입력해 주세요.");
  if (!approved && step !== "package" && !stepState.content) throw new ApiError(409, "WRITING_CONTENT_REQUIRED", "수정할 내용을 먼저 저장해 주세요.");
  const workflow = writingWorkflowOf(state.source.metadata.writingWorkflow);
  const review: WritingWorkflowReview = { step, signature: stepState.signature, approved, actorId: actor.id, at: new Date().toISOString(), note: note.trim() };
  return saveMetadata(actor, state.source, { writingWorkflow: {
    ...workflow,
    schemaVersion: WRITING_WORKFLOW_SCHEMA_VERSION,
    packageId: state.writing.packageId,
    packageVersion: state.writing.packageVersion,
    reviews: [...workflow.reviews, review],
  } });
}

export async function saveScriptReview(actor: RequestActor, id: string, expectedVersion: number, step: ScriptReviewStep, content: string) {
  const state = await readPipeline(actor, id);
  assertExpectedVersion(state.source, expectedVersion);
  const stepState = state.scriptReview.steps.find((item) => item.key === step);
  if (!stepState?.canEdit) throw new ApiError(409, "SCRIPT_REVIEW_BLOCKED", stepState?.blocker || "검수할 원고를 먼저 준비해 주세요.");
  const cleaned = content.trim();
  if (!cleaned) throw new ApiError(400, "SCRIPT_REVIEW_CONTENT_REQUIRED", `${stepState.label} 검수 내용을 입력해 주세요.`);
  const workflow = scriptReviewWorkflowOf(state.source.metadata.scriptReviewWorkflow);
  return saveMetadata(actor, state.source, { scriptReviewWorkflow: {
    ...workflow,
    schemaVersion: SCRIPT_REVIEW_SCHEMA_VERSION,
    scriptId: state.scriptReview.scriptId,
    scriptVersion: state.scriptReview.scriptVersion,
    [step]: cleaned,
  } });
}

export async function reviewScript(actor: RequestActor, id: string, expectedVersion: number, step: ScriptReviewStep, approved: boolean, note: string) {
  const state = await readPipeline(actor, id);
  assertExpectedVersion(state.source, expectedVersion);
  const stepState = state.scriptReview.steps.find((item) => item.key === step);
  if (!stepState) throw new ApiError(400, "SCRIPT_REVIEW_STEP_INVALID", "검수 항목을 확인해 주세요.");
  if (approved && !stepState.canApprove) throw new ApiError(409, "SCRIPT_REVIEW_BLOCKED", stepState.blocker || "검수 내용을 먼저 저장해 주세요.");
  if (!approved && !note.trim()) throw new ApiError(400, "REVIEW_REASON_REQUIRED", "수정 요청 사유를 입력해 주세요.");
  if (!approved && !stepState.content) throw new ApiError(409, "SCRIPT_REVIEW_CONTENT_REQUIRED", "수정할 검수 내용을 먼저 저장해 주세요.");
  const workflow = scriptReviewWorkflowOf(state.source.metadata.scriptReviewWorkflow);
  const review: ScriptReviewDecision = { step, signature: stepState.signature, approved, actorId: actor.id, at: new Date().toISOString(), note: note.trim() };
  return saveMetadata(actor, state.source, { scriptReviewWorkflow: {
    ...workflow,
    schemaVersion: SCRIPT_REVIEW_SCHEMA_VERSION,
    scriptId: state.scriptReview.scriptId,
    scriptVersion: state.scriptReview.scriptVersion,
    reviews: [...workflow.reviews, review],
  } });
}

export async function reviewPipeline(actor: RequestActor, id: string, gate: number, signature: string, approved: boolean, note: string) {
  const state = await readPipeline(actor, id);
  if (state.source.metadata.pipelineEnabled !== true) throw new ApiError(409, "PIPELINE_NOT_ENABLED", "공정을 먼저 시작해 주세요.");
  if (state.signatures[gate - 1] !== signature) throw new ApiError(409, "PIPELINE_CHANGED", "검토 중 자료가 변경되었습니다. 최신 산출물을 확인해 주세요.");
  if (approved && (state.missing[gate - 1].length || state.approved.slice(0, gate - 1).some((value) => !value)))
    throw new ApiError(409, "PIPELINE_NEEDS_INPUT", `승인 전 확인 필요: ${state.missing[gate - 1].join(", ") || "이전 단계 승인"}`);
  if (!approved && !note.trim()) throw new ApiError(400, "REVIEW_REASON_REQUIRED", "수정 요청 사유를 입력해 주세요.");
  const review: PipelineReview = { gate, signature, approved, actorId: actor.id, at: new Date().toISOString(), note };
  return saveMetadata(actor, state.source, { pipelineReviews: [...state.reviews, review] });
}

export async function runPipelineGeneration(actor: RequestActor, input: z.infer<typeof generationSchema>) {
  const state = await readPipeline(actor, input.sourceId);
  const neededGate = ({ appeal_candidates: 0, topic_plan: 0, script_draft: 1, title_package: 1, shorts_proposal: 2, youtube_kit: 2, derivatives: 2 })[input.action];
  if (state.approved.slice(0, neededGate).some((approved) => !approved)) throw new ApiError(409, "PIPELINE_APPROVAL_REQUIRED", "이전 단계의 현재 자료를 승인한 뒤 실행해 주세요. 수정된 자료는 재승인이 필요합니다.");
  if (input.action === "topic_plan") {
    const missing = pipelineMissing(state.source, state.records, 1).filter((name) => !["기획 브리핑", "채택한 기획 방향"].includes(name));
    if (missing.length) throw new ApiError(409, "PIPELINE_NEEDS_INPUT", `자료 보완 필요: ${missing.join(", ")}`);
  }
  const artifacts = pipelineArtifacts(state.records);
  if (input.action === "title_package" && !planningSelectionReady(state.source, artifacts.research))
    throw new ApiError(409, "PIPELINE_NEEDS_INPUT", "기획 방향을 한 개 채택하고 현재 기획 버전으로 연결해 주세요.");
  if (input.action === "script_draft" && !pickedPackaging(artifacts.packaging).ready)
    throw new ApiError(409, "PIPELINE_NEEDS_INPUT", "제목과 썸네일 카피를 각각 한 개 채택한 뒤 원고를 작성해 주세요.");
  if (input.action === "script_draft" && !state.writing.ready)
    throw new ApiError(409, "WRITING_WORKFLOW_REQUIRED", `원고 전 작업을 순서대로 완료해 주세요: ${state.writing.nextAction}${state.writing.blocker ? ` · ${state.writing.blocker}` : ""}`);
  const procedureRevision = await generationProcedureRevision(actor, input.action);
  const key = digest([procedureRevision, input.action, sourceInput(state.source), input.count, input.platforms, input.marketEvidence,
    ...(["appeal_candidates", "topic_plan"].includes(input.action) ? [] : [reference(artifacts.research)]),
    ...(["script_draft", "shorts_proposal", "youtube_kit", "derivatives"].includes(input.action) ? [reference(artifacts.packaging)] : []),
    ...(input.action === "script_draft" ? [state.source.metadata.writingWorkflow] : []),
    ...(["shorts_proposal", "youtube_kit", "derivatives"].includes(input.action) ? [reference(artifacts.script)] : []),
    ...(["shorts_proposal", "youtube_kit"].includes(input.action) ? [state.source.metadata.transcriptSrt] : [])]);
  const runs = (Array.isArray(state.source.metadata.pipelineRuns) ? state.source.metadata.pipelineRuns : []) as PipelineRun[];
  const prior = runs.findLast((run) => run.key === key);
  if (prior?.state === "succeeded") return { configured: true, queued: false, reused: true, records: state.records.filter((record) => prior.recordIds?.includes(record.id)) };
  if (runs.some((run) => run.state === "running" && Date.now() - Date.parse(run.at) < 180_000)) throw new ApiError(409, "PIPELINE_RUNNING", "콘텐츠 생성이 진행 중입니다. 잠시 후 새로 불러와 주세요.");
  const run: PipelineRun = { key, action: input.action, state: "running", at: new Date().toISOString() };
  // A compare-and-swap on the shared source serializes runs. Expired attempts remain in history.
  await saveMetadata(actor, state.source, { pipelineRuns: [...runs.map((item) => item.state === "running" ? { ...item, state: "failed" as const, error: "실행 시간 초과" } : item), run] });
  const finish = async (changes: Partial<PipelineRun>) => {
    for (let attempt = 0; attempt < 3; attempt++) {
      const latest = await readPipeline(actor, input.sourceId);
      const currentRuns = latest.source.metadata.pipelineRuns as PipelineRun[];
      try { await saveMetadata(actor, latest.source, { pipelineRuns: currentRuns.map((item) => item.key === key && item.at === run.at ? { ...item, ...changes, finishedAt: new Date().toISOString() } : item) }); return; }
      catch (error) { if (!(error instanceof ApiError) || error.code !== "PIPELINE_CHANGED" || attempt === 2) throw error; }
    }
  };
  try {
    // Recover artifacts saved before an interrupted completion write without generating twice.
    const recovered = state.records.filter((record) => record.metadata.generationRequestKey === key);
    const result = recovered.length ? { queued: false, configured: true, records: recovered } : await executeGeneration(actor, input, key);
    await finish({ state: result.queued ? "needs_input" : "succeeded", recordIds: result.records.map((record) => record.id), ...(result.queued ? { error: "Claude 연결 필요" } : {}) });
    return result;
  } catch (error) {
    await finish({ state: error instanceof ApiError && [409, 503].includes(error.status) ? "needs_input" : "failed", error: error instanceof Error ? error.message : "생성 실패" });
    throw error;
  }
}
