import { randomUUID, timingSafeEqual } from "node:crypto";
import { authorizationContext } from "./session-auth.mjs";

const DEFAULT_REPOSITORY = "brandyaction-ricky/OS";
const DEFAULT_BRANCH = "main";
const PIPELINE_ID = "multichannel-repurposing-v1";
const CONTENT_ID_PATTERN = /^BA-\d{4}$/;
const ACTOR_PATTERN = /^[a-z][a-z0-9_-]{1,40}$/;
const MAX_INPUT_LENGTH = 160_000;
const MAX_OUTPUT_LENGTH = 1_500_000;

export const REPURPOSING_STAGES = [
  { id: "content_dna", provider: "openai", humanGate: false, dependsOn: [] },
  { id: "atom_extract", provider: "openai", humanGate: true, dependsOn: ["content_dna"] },
  { id: "shorts_plan", provider: "openai", humanGate: true, dependsOn: ["atom_extract"] },
  { id: "shorts_render", provider: "render_worker", humanGate: false, dependsOn: ["shorts_plan"] },
  { id: "shorts_approve", provider: "human", humanGate: false, dependsOn: ["shorts_render"] },
  { id: "shorts_publish", provider: "social_publish_worker", humanGate: false, dependsOn: ["shorts_approve"] },
  { id: "carousel_plan", provider: "openai", humanGate: true, dependsOn: ["atom_extract"] },
  { id: "carousel_render", provider: "design_worker", humanGate: false, dependsOn: ["carousel_plan"] },
  { id: "carousel_approve", provider: "human", humanGate: false, dependsOn: ["carousel_render"] },
  { id: "carousel_publish", provider: "instagram", humanGate: false, dependsOn: ["carousel_approve"] },
  { id: "threads_draft", provider: "openai", humanGate: true, dependsOn: ["atom_extract"] },
  { id: "threads_approve", provider: "human", humanGate: false, dependsOn: ["threads_draft"] },
  { id: "threads_publish", provider: "threads", humanGate: false, dependsOn: ["threads_approve"] },
  { id: "multichannel_metrics", provider: "metrics_worker", humanGate: false, dependsOn: ["shorts_publish", "carousel_publish", "threads_publish"] },
  { id: "multichannel_learn", provider: "openai", humanGate: false, dependsOn: ["multichannel_metrics"] },
];

const STAGE_BY_ID = new Map(REPURPOSING_STAGES.map((stage) => [stage.id, stage]));
const RESULT_ROOT = "10_repurposing/results";

const STAGE_LABELS = {
  content_dna: "Content DNA 생성",
  atom_extract: "Atom 추출·채널 배정",
  shorts_plan: "숏츠 3개 구간 기획",
  shorts_render: "9:16 자동 렌더",
  shorts_approve: "숏츠·Reels 미리보기",
  shorts_publish: "Shorts·Reels 동시 발행",
  carousel_plan: "카드뉴스 9장 기획",
  carousel_render: "디자인 자동 렌더",
  carousel_approve: "카드뉴스 미리보기",
  carousel_publish: "Instagram 카드뉴스 발행",
  threads_draft: "Threads 3개 생성",
  threads_approve: "Threads 문구 확정",
  threads_publish: "Threads 예약 발행",
  multichannel_metrics: "채널별 성과 수집",
  multichannel_learn: "성과 학습 반영",
};

const OPENAI_INSTRUCTIONS = {
  content_dna: `당신은 브랜디액션 콘텐츠 전략가입니다. 제공된 최종 대본·SRT·Wiki에서 확인되는 내용만 사용해 재가공 정본을 만드세요. 반드시 ## 핵심 약속, ## 타깃 문제, ## 핵심 주장, ## 근거, ## 훅 후보, ## CTA, ## 위험 표현, ## 확인 필요 순서의 Markdown을 반환하세요. 근거가 없는 내용을 새로 만들지 마세요.`,
  atom_extract: `당신은 멀티채널 콘텐츠 에디터입니다. Content DNA와 원본 맥락에서 서로 겹치지 않는 재사용 Atom을 추출하세요. 각 Atom에 원본 타임코드 또는 근거 문장, 핵심 메시지, 훅, 적합 채널, 시각화 가능성, CTA를 기록하세요. Shorts/Reels 3개, 카드뉴스 1개, Threads 3개를 만들 수 있도록 배정하고 마지막에 ## 확인 필요를 두세요.`,
  shorts_plan: `당신은 숏폼 편집 디렉터입니다. 승인된 Atom만 사용해 서로 다른 훅의 숏폼 3개를 설계하세요. 각 영상마다 시작·종료 타임코드, 첫 2초 훅, 편집 문장, 자막 강조, CTA, YouTube Shorts 문안, Instagram Reels 문안을 작성하세요. 문장 중간 절단과 같은 메시지 반복을 금지하고 마지막에 ## 확인 필요를 두세요.`,
  carousel_plan: `당신은 Instagram 카드뉴스 기획자입니다. 승인된 Atom으로 1080×1350 카드뉴스 9장을 설계하세요. 1장은 표지 훅, 2~8장은 한 장 한 메시지, 9장은 CTA입니다. 각 장에 헤드라인, 본문, 시각화 지시, 출처 근거를 작성하고 마지막에 ## 확인 필요를 두세요.`,
  threads_draft: `당신은 브랜디액션 Threads 에디터입니다. 승인된 Atom으로 단문 2개와 연속형 1개를 서로 다른 관점으로 작성하세요. 사실을 과장하지 말고 Threads에 맞는 대화체를 사용하며 각 콘텐츠의 훅, 본문, CTA, 발행 순서를 적고 마지막에 ## 확인 필요를 두세요.`,
  multichannel_learn: `당신은 멀티채널 성과 분석가입니다. 제공된 실제 성과만 비교해 채널별 성공 훅, 구조, CTA와 실패 가설을 정리하세요. 표본이 적으면 단정하지 말고 다음 Content DNA에 적용할 실험 규칙을 Markdown으로 반환하세요. 마지막에 ## 확인 필요를 두세요.`,
};

function json(payload, status = 200, nodeResponse = null) {
  if (nodeResponse?.status) return nodeResponse.status(status).json(payload);
  return new Response(JSON.stringify(payload), { status, headers: { "content-type": "application/json; charset=utf-8" } });
}

async function requestBody(request) {
  if (request.body && typeof request.body === "object" && !request.body.getReader) return request.body;
  if (typeof request.json === "function") return request.json();
  let raw = "";
  for await (const chunk of request) raw += chunk;
  return JSON.parse(raw || "{}");
}

function safeEqual(left, right) {
  const a = Buffer.from(String(left || ""));
  const b = Buffer.from(String(right || ""));
  return a.length === b.length && timingSafeEqual(a, b);
}

export function repurposingConnectorStatus(env = process.env) {
  const githubReady = Boolean(env.GITHUB_TOKEN);
  return {
    github: { ready: githubReady, label: "상태·정본 저장", mode: "GitHub" },
    session: { ready: Boolean(env.OS_PUSH_SECRET), label: "팀 작업 권한", mode: "HttpOnly Session" },
    openai: { ready: Boolean(githubReady && env.OPENAI_API_KEY), label: "AI 기획·카피", mode: "OpenAI Responses API" },
    render: { ready: Boolean(githubReady && env.VIDEO_WORKER_WEBHOOK_URL && env.VIDEO_WORKER_SECRET && env.VIDEO_CALLBACK_SECRET), label: "숏폼 렌더", mode: "FFmpeg Worker" },
    design: { ready: Boolean(githubReady && env.DESIGN_WORKER_WEBHOOK_URL && env.DESIGN_WORKER_SECRET && env.DESIGN_CALLBACK_SECRET), label: "카드뉴스 렌더", mode: "Design Worker" },
    publish: { ready: Boolean(githubReady && env.SOCIAL_PUBLISH_WORKER_URL && env.SOCIAL_PUBLISH_WORKER_SECRET && env.SOCIAL_PUBLISH_CALLBACK_SECRET), label: "채널 동시 발행", mode: "YouTube·Meta API" },
    metrics: { ready: Boolean(githubReady && env.MULTICHANNEL_METRICS_WORKER_URL && env.MULTICHANNEL_METRICS_WORKER_SECRET && env.MULTICHANNEL_METRICS_CALLBACK_SECRET), label: "성과 회수", mode: "Channel Analytics API" },
  };
}

function connectorKey(provider) {
  return ({ openai: "openai", render_worker: "render", design_worker: "design", social_publish_worker: "publish", instagram: "publish", threads: "publish", metrics_worker: "metrics", human: "human" })[provider] || "human";
}

function connectorFor(stage, env = process.env) {
  if (stage.provider === "human") return { ready: true, label: "사람 확인", mode: "현재 화면" };
  return repurposingConnectorStatus(env)[connectorKey(stage.provider)];
}

function stateTemplate() {
  return { status: "locked", attempt: 0, jobId: null, outputPath: null, assetUrl: null, error: null, updatedAt: null };
}

export function normalizeRepurposingState(source, contentId, { triggerReady = false } = {}) {
  const state = source && typeof source === "object" ? structuredClone(source) : {};
  state.schemaVersion = "1.0";
  state.contentId = contentId;
  state.pipelineId = PIPELINE_ID;
  state.sourceReady = Boolean(state.sourceReady || triggerReady);
  state.sourceAssetUrl ||= null;
  state.sourceContextPath ||= null;
  state.currentStageId ||= "content_dna";
  state.status ||= state.sourceReady ? "ready" : "waiting_source";
  state.stages ||= {};
  state.jobs = Array.isArray(state.jobs) ? state.jobs : [];
  for (const stage of REPURPOSING_STAGES) state.stages[stage.id] = { ...stateTemplate(), ...(state.stages[stage.id] || {}) };
  return unlockRepurposingStages(state);
}

export function unlockRepurposingStages(state) {
  if (!state.sourceReady) {
    state.currentStageId = "content_dna";
    state.status = "waiting_source";
    return state;
  }
  if (state.sourceReady && state.stages.content_dna.status === "locked") state.stages.content_dna.status = "ready";
  for (const stage of REPURPOSING_STAGES) {
    if (state.stages[stage.id].status !== "locked") continue;
    if (stage.dependsOn.every((dependency) => state.stages[dependency]?.status === "completed")) state.stages[stage.id].status = "ready";
  }
  const active = REPURPOSING_STAGES.find((stage) => ["needs_decision", "needs_input", "failed", "blocked", "queued", "running", "ready"].includes(state.stages[stage.id].status));
  state.currentStageId = active?.id || REPURPOSING_STAGES.at(-1).id;
  state.status = active ? state.stages[active.id].status : (state.sourceReady ? "completed" : "waiting_source");
  return state;
}

export function displayRepurposingStages(state, env = process.env) {
  return REPURPOSING_STAGES.map((stage) => {
    const saved = state.stages[stage.id];
    const connector = connectorFor(stage, env);
    let displayStatus = saved.status;
    if (saved.status === "locked") displayStatus = stage.id === "content_dna" && !state.sourceReady ? "waiting_source" : "waiting_dependency";
    if (saved.status === "ready" && !connector.ready) displayStatus = "needs_setup";
    return { ...stage, ...saved, label: STAGE_LABELS[stage.id], connectorKey: connectorKey(stage.provider), connector, displayStatus };
  });
}

function validateAssetReference(value) {
  const text = String(value || "").trim();
  if (!text) return null;
  if (/^asset:\/\/[a-z0-9][a-z0-9._/-]{2,500}$/i.test(text)) return text;
  let url;
  try { url = new URL(text); } catch { throw new Error("완료본 URL 또는 asset:// ID 형식이 올바르지 않습니다."); }
  if (url.protocol !== "https:") throw new Error("완료본은 HTTPS URL 또는 asset:// ID만 사용할 수 있습니다.");
  return url.href;
}

async function github(path, options = {}) {
  const { allow404 = false, ...fetchOptions } = options;
  const response = await fetch(`https://api.github.com${path}`, {
    ...fetchOptions,
    headers: { accept: "application/vnd.github+json", authorization: `Bearer ${process.env.GITHUB_TOKEN}`, "x-github-api-version": "2022-11-28", "content-type": "application/json", ...(fetchOptions.headers || {}) },
  });
  if (response.status === 404 && allow404) return null;
  const body = await response.json().catch(() => ({}));
  if (!response.ok) { const error = new Error(body.message || `GitHub API ${response.status}`); error.status = response.status; throw error; }
  return body;
}

async function repositoryFile(repository, path, ref, allow404 = false) {
  const result = await github(`/repos/${repository}/contents/${path}?ref=${encodeURIComponent(ref)}`, { allow404 });
  return result ? Buffer.from(result.content, "base64").toString("utf8") : null;
}

function frontmatter(markdown) {
  const lines = String(markdown || "").replace(/\r\n/g, "\n").split("\n");
  if (lines[0] !== "---") return {};
  const end = lines.indexOf("---", 1);
  const result = {};
  for (const line of lines.slice(1, end < 0 ? 1 : end)) {
    const match = line.match(/^([A-Za-z0-9_]+):\s*(.*)$/);
    if (match) result[match[1]] = match[2].replace(/^"(.*)"$/, "$1");
  }
  return result;
}

async function loadSnapshot(contentId) {
  if (!process.env.GITHUB_TOKEN) throw new Error("GitHub 저장 연결이 필요합니다.");
  const repository = process.env.GITHUB_REPOSITORY || DEFAULT_REPOSITORY;
  const branch = process.env.GITHUB_BRANCH || DEFAULT_BRANCH;
  const ref = await github(`/repos/${repository}/git/ref/heads/${branch}`);
  const headSha = ref.object.sha;
  const commit = await github(`/repos/${repository}/git/commits/${headSha}`);
  const contentPath = `05_contents/${contentId}/CONTENT.md`;
  const contentSource = await repositoryFile(repository, contentPath, headSha);
  const metadata = frontmatter(contentSource);
  if (metadata.id !== contentId || metadata.type !== "longform") throw new Error("Longform Content Run을 찾지 못했습니다.");
  const youtubeStatePath = `05_contents/${contentId}/05_edit/automation/state.json`;
  const youtubeSource = await repositoryFile(repository, youtubeStatePath, headSha, true);
  const youtubeState = youtubeSource ? JSON.parse(youtubeSource) : {};
  const triggerReady = ["master_validation", "youtube_assets"].every((id) => youtubeState.stages?.[id]?.status === "completed");
  const statePath = `05_contents/${contentId}/10_repurposing/state.json`;
  const stateSource = await repositoryFile(repository, statePath, headSha, true);
  const state = normalizeRepurposingState(stateSource ? JSON.parse(stateSource) : null, contentId, { triggerReady });
  return { repository, branch, headSha, treeSha: commit.tree.sha, contentPath, contentSource, metadata, statePath, state, triggerReady };
}

async function commitFiles(snapshot, files, message) {
  const stateFile = { path: snapshot.statePath, content: `${JSON.stringify(snapshot.state, null, 2)}\n` };
  const effective = [...files.filter((file) => file.path !== snapshot.statePath), stateFile];
  const blobs = await Promise.all(effective.map(async (file) => {
    const blob = await github(`/repos/${snapshot.repository}/git/blobs`, { method: "POST", body: JSON.stringify({ content: file.content, encoding: "utf-8" }) });
    return { path: file.path, mode: "100644", type: "blob", sha: blob.sha };
  }));
  const tree = await github(`/repos/${snapshot.repository}/git/trees`, { method: "POST", body: JSON.stringify({ base_tree: snapshot.treeSha, tree: blobs }) });
  const commit = await github(`/repos/${snapshot.repository}/git/commits`, { method: "POST", body: JSON.stringify({ message, tree: tree.sha, parents: [snapshot.headSha] }) });
  try {
    await github(`/repos/${snapshot.repository}/git/refs/heads/${snapshot.branch}`, { method: "PATCH", body: JSON.stringify({ sha: commit.sha, force: false }) });
  } catch (error) {
    if (error.status === 422) { const conflict = new Error("다른 작업이 먼저 반영됐습니다. 최신 상태를 불러와 다시 실행해주세요."); conflict.status = 409; throw conflict; }
    throw error;
  }
  return commit.sha;
}

function responseText(result) {
  if (typeof result?.output_text === "string") return result.output_text.trim();
  return (result?.output || []).flatMap((item) => item.content || []).filter((item) => item.type === "output_text").map((item) => item.text).join("\n").trim();
}

async function runOpenAI(stageId, input) {
  if (!process.env.OPENAI_API_KEY) throw new Error("OpenAI API 연결이 필요합니다.");
  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    signal: AbortSignal.timeout(55_000),
    headers: { authorization: `Bearer ${process.env.OPENAI_API_KEY}`, "content-type": "application/json" },
    body: JSON.stringify({
      model: process.env.OPENAI_REPURPOSING_MODEL || process.env.OPENAI_AUTOMATION_MODEL || "gpt-5.6",
      instructions: `${OPENAI_INSTRUCTIONS[stageId]}\n\n공통 규칙: 결과 마지막에 반드시 ## 확인 필요를 두고 질문이 없으면 - 없음이라고 쓰세요.`,
      input,
      max_output_tokens: 6000,
    }),
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(result.error?.message || `OpenAI Responses API ${response.status}`);
  const output = responseText(result).replace(/^```(?:markdown)?\s*/i, "").replace(/\s*```$/, "").trim();
  if (!output) throw new Error("AI 결과가 비어 있습니다.");
  return output;
}

export function repurposingResultMarkdown({ contentId, stage, actor, output, version, assetUrl, status }) {
  const now = new Date().toISOString();
  return `---\nschema_version: "1.0"\nid: ${contentId}-${stage.id}-run-${version}\nentity_type: automation_result\ncontent_id: ${contentId}\npipeline_id: ${PIPELINE_ID}\nstage_id: ${stage.id}\nstatus: ${status}\nowner: ${actor}\nprovider: ${stage.provider}\nversion: ${version}\nasset_url: ${assetUrl ? JSON.stringify(assetUrl) : "null"}\ncreated_at: ${now}\nupdated_at: ${now}\nupdated_by: ${actor}\n---\n\n# ${STAGE_LABELS[stage.id]}\n\n${String(output || "결과 본문 없음").trim()}\n`;
}

async function dependencyInput(snapshot, stage, directInput) {
  const chunks = [];
  if (snapshot.state.sourceContextPath) {
    const source = await repositoryFile(snapshot.repository, snapshot.state.sourceContextPath, snapshot.headSha, true);
    if (source) chunks.push(`# 원본 맥락\n\n${source}`);
  }
  for (const id of stage.dependsOn) {
    const path = snapshot.state.stages[id]?.outputPath;
    if (!path) continue;
    const source = await repositoryFile(snapshot.repository, path, snapshot.headSha, true);
    if (source) chunks.push(`# 선행 결과 · ${STAGE_LABELS[id]}\n\n${source}`);
  }
  if (String(directInput || "").trim()) chunks.push(`# 작업자 추가 지시\n\n${String(directInput).trim()}`);
  if (!chunks.length) chunks.push(`# Content Run\n\n- id: ${snapshot.state.contentId}\n- title: ${snapshot.metadata.title || "-"}\n- source_asset: ${snapshot.state.sourceAssetUrl || "-"}`);
  return chunks.join("\n\n---\n\n").slice(0, MAX_INPUT_LENGTH);
}

function completeStage(state, stageId, { outputPath = null, assetUrl = null, actor = "system", now = new Date().toISOString() } = {}) {
  const target = state.stages[stageId];
  target.status = "completed";
  target.outputPath = outputPath || target.outputPath;
  target.assetUrl = assetUrl || target.assetUrl;
  target.error = null;
  target.updatedAt = now;
  state.updatedAt = now;
  state.updatedBy = actor;
  return unlockRepurposingStages(state);
}

async function saveResult(snapshot, payload, { output, status, assetUrl = null }) {
  const stage = STAGE_BY_ID.get(payload.stageId);
  const target = snapshot.state.stages[payload.stageId];
  const version = Number(target.attempt || 0) + 1;
  const outputPath = `05_contents/${payload.contentId}/${RESULT_ROOT}/${payload.stageId}_v${version}.md`;
  const now = new Date().toISOString();
  target.attempt = version;
  target.status = status;
  target.outputPath = outputPath;
  target.assetUrl = assetUrl || target.assetUrl;
  target.error = null;
  target.updatedAt = now;
  snapshot.state.updatedAt = now;
  snapshot.state.updatedBy = payload.actor;
  if (status === "completed") completeStage(snapshot.state, payload.stageId, { outputPath, assetUrl, actor: payload.actor, now });
  else { snapshot.state.currentStageId = payload.stageId; snapshot.state.status = status; }
  const markdown = repurposingResultMarkdown({ contentId: payload.contentId, stage, actor: payload.actor, output, version, assetUrl, status });
  const commitSha = await commitFiles(snapshot, [{ path: outputPath, content: markdown }], `repurposing(${payload.contentId}): ${payload.stageId} ${status}`);
  return { commitSha, state: snapshot.state, output, outputPath };
}

function workerConfig(provider, env = process.env) {
  if (provider === "render_worker") return { url: env.VIDEO_WORKER_WEBHOOK_URL, secret: env.VIDEO_WORKER_SECRET, callbackSecret: env.VIDEO_CALLBACK_SECRET };
  if (provider === "design_worker") return { url: env.DESIGN_WORKER_WEBHOOK_URL, secret: env.DESIGN_WORKER_SECRET, callbackSecret: env.DESIGN_CALLBACK_SECRET };
  if (["social_publish_worker", "instagram", "threads"].includes(provider)) return { url: env.SOCIAL_PUBLISH_WORKER_URL, secret: env.SOCIAL_PUBLISH_WORKER_SECRET, callbackSecret: env.SOCIAL_PUBLISH_CALLBACK_SECRET };
  if (provider === "metrics_worker") return { url: env.MULTICHANNEL_METRICS_WORKER_URL, secret: env.MULTICHANNEL_METRICS_WORKER_SECRET, callbackSecret: env.MULTICHANNEL_METRICS_CALLBACK_SECRET };
  return {};
}

function callbackUrl(env = process.env) {
  if (env.REPURPOSING_CALLBACK_URL) return env.REPURPOSING_CALLBACK_URL;
  const host = env.VERCEL_PROJECT_PRODUCTION_URL || env.VERCEL_URL;
  return host ? `https://${host}/api/repurposing` : null;
}

async function queueWorker(snapshot, payload) {
  const stage = STAGE_BY_ID.get(payload.stageId);
  const connector = connectorFor(stage);
  if (!connector.ready) throw new Error(`${connector.label} 연결이 필요합니다. 연결 전에는 수동 결과 등록을 사용할 수 있습니다.`);
  const config = workerConfig(stage.provider);
  const now = new Date().toISOString();
  const jobId = `JOB-${randomUUID()}`;
  const target = snapshot.state.stages[payload.stageId];
  target.status = "queued";
  target.jobId = jobId;
  target.error = null;
  target.updatedAt = now;
  snapshot.state.status = "queued";
  snapshot.state.currentStageId = payload.stageId;
  snapshot.state.updatedAt = now;
  snapshot.state.updatedBy = payload.actor;
  snapshot.state.jobs.push({ id: jobId, stageId: payload.stageId, provider: stage.provider, status: "queued", createdAt: now, updatedAt: now });
  const commitSha = await commitFiles(snapshot, [], `repurposing(${payload.contentId}): ${payload.stageId} queued`);
  const response = await fetch(config.url, {
    method: "POST",
    signal: AbortSignal.timeout(10_000),
    headers: { authorization: `Bearer ${config.secret}`, "content-type": "application/json" },
    body: JSON.stringify({
      jobId, pipelineId: PIPELINE_ID, contentId: payload.contentId, stageId: payload.stageId,
      sourceAssetUrl: snapshot.state.sourceAssetUrl,
      dependencyOutputs: stage.dependsOn.map((id) => ({ stageId: id, outputPath: snapshot.state.stages[id]?.outputPath, assetUrl: snapshot.state.stages[id]?.assetUrl })),
      schedule: payload.schedule || null, callbackUrl: callbackUrl(), repositoryRef: commitSha,
    }),
  }).catch(() => null);
  if (!response?.ok) {
    const latest = await loadSnapshot(payload.contentId);
    const failedTarget = latest.state.stages[payload.stageId];
    const failedJob = latest.state.jobs.find((item) => item.id === jobId);
    if (failedTarget?.jobId === jobId && failedJob?.status === "queued") {
      const failedAt = new Date().toISOString();
      failedTarget.status = "blocked";
      failedTarget.error = response ? `${connector.label} 요청이 거절됐습니다.` : `${connector.label} 전달 여부를 확인하지 못했습니다.`;
      failedTarget.updatedAt = failedAt;
      failedJob.status = "blocked";
      failedJob.updatedAt = failedAt;
      latest.state.status = "blocked";
      latest.state.currentStageId = payload.stageId;
      latest.state.updatedAt = failedAt;
      latest.state.updatedBy = payload.actor;
      await commitFiles(latest, [], `repurposing(${payload.contentId}): ${payload.stageId} dispatch blocked`);
    }
    throw new Error(response ? `${connector.label} 요청이 거절됐습니다.` : `${connector.label} 전달 여부를 확인하지 못했습니다. 같은 단계에서 재시도해주세요.`);
  }
  return { commitSha, jobId, state: snapshot.state };
}

function validatePayload(payload) {
  if (!CONTENT_ID_PATTERN.test(payload.contentId || "")) throw new Error("Content ID 형식이 올바르지 않습니다.");
  if (!ACTOR_PATTERN.test(payload.actor || "")) throw new Error("작업자 형식이 올바르지 않습니다.");
  if (payload.stageId && !STAGE_BY_ID.has(payload.stageId)) throw new Error("지원하지 않는 멀티채널 Stage입니다.");
  if (String(payload.inputText || "").length > MAX_INPUT_LENGTH) throw new Error("입력은 160,000자 이하여야 합니다.");
  if (String(payload.summary || "").length > 40_000) throw new Error("작업 결과는 40,000자 이하여야 합니다.");
  if (String(payload.output || "").length > MAX_OUTPUT_LENGTH) throw new Error("Worker 결과는 1.5MB 이하여야 합니다.");
}

async function handleAction(payload) {
  validatePayload(payload);
  const snapshot = await loadSnapshot(payload.contentId);
  if (payload.action === "activate") {
    const sourceAssetUrl = validateAssetReference(payload.sourceAssetUrl);
    const input = String(payload.inputText || "").trim();
    if (!snapshot.triggerReady && !sourceAssetUrl && !input) throw new Error("완료본 URL·자산 ID 또는 SRT·대본 중 하나를 입력해주세요.");
    const now = new Date().toISOString();
    const sourcePath = `05_contents/${payload.contentId}/10_repurposing/SOURCE_CONTEXT.md`;
    snapshot.state.sourceReady = true;
    snapshot.state.sourceAssetUrl = sourceAssetUrl || snapshot.state.sourceAssetUrl;
    snapshot.state.sourceContextPath = input ? sourcePath : snapshot.state.sourceContextPath;
    snapshot.state.updatedAt = now;
    snapshot.state.updatedBy = payload.actor;
    unlockRepurposingStages(snapshot.state);
    const sourceMarkdown = `---\nschema_version: "1.0"\nid: ${payload.contentId}-repurposing-source\nentity_type: context\nscope: content\ncontent_id: ${payload.contentId}\ntitle: 멀티채널 재가공 원본 맥락\nstatus: active\nversion: 1\nsource_asset: ${snapshot.state.sourceAssetUrl ? JSON.stringify(snapshot.state.sourceAssetUrl) : "null"}\nupdated_at: ${now}\nupdated_by: ${payload.actor}\n---\n\n# 멀티채널 재가공 원본 맥락\n\n${input || "YouTube 완료본 검증 결과를 원본으로 사용합니다."}\n`;
    const commitSha = await commitFiles(snapshot, input ? [{ path: sourcePath, content: sourceMarkdown }] : [], `repurposing(${payload.contentId}): source ready`);
    return { commitSha, state: snapshot.state };
  }
  const stage = STAGE_BY_ID.get(payload.stageId);
  const target = snapshot.state.stages[payload.stageId];
  if (!stage) throw new Error("Stage를 선택해주세요.");
  if (payload.action === "retry") {
    if (!["failed", "blocked", "needs_input"].includes(target.status)) throw new Error("현재 상태에서는 재시도할 수 없습니다.");
    target.status = "ready"; target.jobId = null; target.error = null; target.updatedAt = new Date().toISOString();
    snapshot.state.status = "ready"; snapshot.state.currentStageId = stage.id;
    const commitSha = await commitFiles(snapshot, [], `repurposing(${payload.contentId}): ${stage.id} retry`);
    return { commitSha, state: snapshot.state };
  }
  if (payload.action === "approve") {
    if (target.status !== "needs_decision" && !(stage.provider === "human" && target.status === "ready")) throw new Error("현재 확인 가능한 단계가 아닙니다.");
    return saveResult(snapshot, payload, { output: `## 사람 확인 결과\n\n${String(payload.summary || "그대로 확정").trim()}\n\n- confirmed_by: ${payload.actor}`, status: "completed", assetUrl: validateAssetReference(payload.assetUrl) });
  }
  if (payload.action === "manual_complete") {
    if (!payload.qualityConfirmed) throw new Error("완료 기준 확인이 필요합니다.");
    if (!["ready", "failed", "blocked", "needs_input"].includes(target.status)) throw new Error("현재 단계에서는 수동 완료를 기록할 수 없습니다.");
    if (!String(payload.summary || "").trim() && !payload.assetUrl) throw new Error("수동 결과 또는 자산 ID를 입력해주세요.");
    return saveResult(snapshot, payload, { output: `## 수동 작업 결과\n\n${String(payload.summary || "산출물 연결 완료").trim()}\n\n- quality_confirmed: true\n- completed_by: ${payload.actor}`, status: stage.humanGate ? "needs_decision" : "completed", assetUrl: validateAssetReference(payload.assetUrl) });
  }
  if (payload.action !== "run") throw new Error("지원하지 않는 작업입니다.");
  if (target.status !== "ready") throw new Error(`현재 단계 상태(${target.status})에서는 실행할 수 없습니다.`);
  const connector = connectorFor(stage);
  if (!connector.ready) throw new Error(`${connector.label} 연결이 필요합니다.`);
  if (stage.provider === "openai") {
    const input = await dependencyInput(snapshot, stage, payload.inputText);
    const output = await runOpenAI(stage.id, input);
    return saveResult(snapshot, payload, { output, status: stage.humanGate ? "needs_decision" : "completed" });
  }
  if (stage.provider === "human") throw new Error("이 단계는 미리보기 확인 후 확정해주세요.");
  return queueWorker(snapshot, payload);
}

async function handleCallback(payload, authorization) {
  validatePayload({ ...payload, actor: payload.actor || "system" });
  const stage = STAGE_BY_ID.get(payload.stageId);
  const config = workerConfig(stage?.provider);
  if (!config.callbackSecret || !safeEqual(authorization, `Bearer ${config.callbackSecret}`)) throw Object.assign(new Error("Callback 인증이 올바르지 않습니다."), { status: 401 });
  const snapshot = await loadSnapshot(payload.contentId);
  const target = snapshot.state.stages[payload.stageId];
  const job = snapshot.state.jobs.find((item) => item.id === payload.jobId && item.stageId === payload.stageId);
  if (!job || target.jobId !== payload.jobId || !["queued", "running"].includes(job.status)) throw new Error("활성 Worker Job을 찾지 못했습니다.");
  if (!["completed", "failed", "needs_input"].includes(payload.status)) throw new Error("Callback 상태가 올바르지 않습니다.");
  job.status = payload.status;
  job.updatedAt = new Date().toISOString();
  if (payload.status !== "completed") {
    target.status = payload.status; target.error = String(payload.error || payload.summary || "Worker 처리 실패").slice(0, 2000); target.updatedAt = job.updatedAt;
    snapshot.state.status = payload.status; snapshot.state.currentStageId = payload.stageId;
    const commitSha = await commitFiles(snapshot, [], `repurposing(${payload.contentId}): ${payload.stageId} ${payload.status}`);
    return { commitSha, state: snapshot.state };
  }
  return saveResult(snapshot, { ...payload, actor: payload.actor || "system" }, { output: String(payload.output || payload.summary || "Worker 산출물 생성 완료"), status: "completed", assetUrl: validateAssetReference(payload.assetUrl) });
}

export default async function handler(request, response) {
  if (request.method === "GET") {
    try {
      const url = new URL(request.url || "/api/repurposing", "https://brandyaction-os.vercel.app");
      const contentId = url.searchParams.get("contentId");
      if (!contentId) return json({ ok: true, pipelineId: PIPELINE_ID, connectors: repurposingConnectorStatus(), stages: REPURPOSING_STAGES }, 200, response);
      if (!CONTENT_ID_PATTERN.test(contentId)) return json({ error: "Content ID 형식이 올바르지 않습니다." }, 400, response);
      const snapshot = await loadSnapshot(contentId);
      return json({ ok: true, pipelineId: PIPELINE_ID, connectors: repurposingConnectorStatus(), triggerReady: snapshot.triggerReady, state: snapshot.state, stages: displayRepurposingStages(snapshot.state) }, 200, response);
    } catch (error) { return json({ error: error.message || "멀티채널 상태를 읽지 못했습니다." }, error.status || 400, response); }
  }
  if (request.method !== "POST") return json({ error: "GET 또는 POST 요청만 허용됩니다." }, 405, response);
  try {
    const payload = await requestBody(request);
    const authorization = request.headers.get?.("authorization") || request.headers.authorization || "";
    if (payload.action === "callback") return json({ ok: true, ...(await handleCallback(payload, authorization)) }, 200, response);
    const auth = authorizationContext(request, process.env, authorization);
    if (!auth.authorized) return json({ error: "팀 작업 세션이 필요합니다." }, 401, response);
    if (auth.actor) payload.actor = auth.actor;
    return json({ ok: true, ...(await handleAction(payload)) }, 200, response);
  } catch (error) { return json({ error: error.message || "멀티채널 작업에 실패했습니다." }, error.status || 400, response); }
}
