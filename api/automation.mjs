import { randomUUID, timingSafeEqual } from "node:crypto";
import { authorizationContext } from "./session-auth.mjs";

const DEFAULT_REPOSITORY = "brandyaction-ricky/OS";
const DEFAULT_BRANCH = "main";
const PIPELINE_ID = "youtube-production-v2";
const MAX_INPUT_LENGTH = 160_000;
const MAX_RESULT_LENGTH = 1_500_000;
const CONTENT_ID_PATTERN = /^BA-\d{4}$/;
const ACTOR_PATTERN = /^[a-z][a-z0-9_-]{1,40}$/;

export const AUTOMATION_STAGES = [
  { id: "source_package", provider: "human", humanGate: false, dependsOn: [] },
  { id: "pc_main_edit", provider: "human", humanGate: false, dependsOn: ["source_package"] },
  { id: "master_upload", provider: "asset_upload", humanGate: false, dependsOn: ["pc_main_edit"] },
  { id: "master_validation", provider: "render_worker", humanGate: false, dependsOn: ["master_upload"] },
  { id: "thumbnail_idea", provider: "openai", humanGate: true, dependsOn: ["master_validation"] },
  { id: "thumbnail_generate", provider: "thumbnail_worker", humanGate: false, dependsOn: ["thumbnail_idea"] },
  { id: "thumbnail_evaluate", provider: "thumbnail_worker", humanGate: false, dependsOn: ["thumbnail_generate"] },
  { id: "thumbnail_approve", provider: "human", humanGate: false, dependsOn: ["thumbnail_evaluate"] },
  { id: "shortform_plan", provider: "openai", humanGate: true, dependsOn: ["master_validation"] },
  { id: "shortform_render", provider: "render_worker", humanGate: false, dependsOn: ["shortform_plan"] },
  { id: "publish_package", provider: "openai", humanGate: true, dependsOn: ["master_validation", "shortform_render"] },
  { id: "youtube_publish", provider: "youtube", humanGate: true, dependsOn: ["publish_package", "thumbnail_approve"] },
  { id: "metrics", provider: "youtube_data", humanGate: false, dependsOn: ["youtube_publish"] },
  { id: "thumbnail_learn", provider: "openai", humanGate: false, dependsOn: ["metrics", "thumbnail_idea", "thumbnail_evaluate", "thumbnail_approve"] },
];

const STAGE_BY_ID = new Map(AUTOMATION_STAGES.map((stage) => [stage.id, stage]));
const RECIPE_PATH = "07_automations/youtube-production/RECIPE.md";
const COMMON_CONTEXT_PATHS = ["01_company/context/COMPANY.md"];
const CONTENT_INPUT_POINTERS = ["latest_script", "latest_reading_script", "latest_shoot"];
const ASSET_REQUIRED_STAGES = new Set([
  "master_upload", "thumbnail_generate", "thumbnail_approve", "shortform_render", "youtube_publish",
]);

const STAGE_LABELS = {
  source_package: "작업 패키지 준비",
  pc_main_edit: "개인 PC 메인 편집",
  master_upload: "완료본 업로드",
  master_validation: "완료본 자동 검증",
  thumbnail_idea: "썸네일 아이디어 Brief",
  thumbnail_generate: "썸네일 AI 생성",
  thumbnail_evaluate: "썸네일 AI 평가",
  thumbnail_approve: "사람 최종 승인",
  shortform_plan: "숏폼 구간·스타일 설정",
  shortform_render: "숏폼 자동 생성",
  publish_package: "업로드 문안·설정",
  youtube_publish: "YouTube 업로드·예약",
  metrics: "성과·CTR 자동 회수",
  thumbnail_learn: "썸네일 학습 반영",
};

const OPENAI_INSTRUCTIONS = {
  thumbnail_idea: `당신은 브랜디액션 YouTube 썸네일 전략가입니다. 승인 원고, 영상의 핵심 약속, 사용자가 적은 Brief와 과거 thumbnail_learn 결과를 사용해 서로 다른 썸네일 아이디어 3개를 제안하세요. 각 아이디어마다 한 줄 카피, 시각 구도, 표정·피사체, 대비 방식, 제목과의 역할 분담, 검증할 CTR 가설을 적으세요. 과거 학습을 그대로 일반화하지 말고 이번 영상과 연결되는 근거를 적으세요. 결과는 Markdown만 반환하세요.`,
  shortform_plan: `당신은 브랜디액션 숏폼 편집 디렉터입니다. 완성된 롱폼 SRT와 사용자가 지정한 숏폼 설정만 사용해 단독으로 이해되는 구간을 제안하세요. 각 후보마다 순위, 시작·종료 타임코드, 첫 2초 훅, 핵심 메시지, 예상 길이, 자막 키워드, CTA를 적으세요. 문장 중간 절단과 중복 메시지는 금지합니다. 결과는 Markdown만 반환하세요.`,
  publish_package: `당신은 브랜디액션 YouTube 업로드 에디터입니다. 완료된 롱폼과 숏폼 manifest에서 확인 가능한 사실만 사용하세요. 결과는 Markdown만 반환하고 반드시 ## 롱폼 제목, ## 숏폼별 제목, ## 설명문, ## 타임라인, ## 고정댓글, ## 해시태그, ## 인용·출처 순서를 사용하세요. 확인되지 않은 사실이나 URL을 만들지 마세요. 최신 CTA는 Company Wiki를 우선합니다.`,
  thumbnail_learn: `당신은 브랜디액션 썸네일 실험 분석가입니다. 썸네일 아이디어 가설, AI 사전 평가, 사람이 선택한 이유, 실제 YouTube 노출·CTR 스냅샷만 비교하세요. 결과는 Markdown만 반환하고 반드시 ## 이번 가설, ## 예상과 실제의 차이, ## 유지할 규칙, ## 버릴 규칙, ## 다음 실험 가설, ## 근거 데이터 순서를 사용하세요. 인과관계를 단정하지 말고 표본이 작거나 측정 기간이 짧으면 한계를 명시하세요.`,
};

function json(payload, status = 200, nodeResponse = null) {
  if (nodeResponse?.status) return nodeResponse.status(status).json(payload);
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
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

export function connectorStatus(env = process.env) {
  const githubReady = Boolean(env.GITHUB_TOKEN);
  return {
    github: { ready: githubReady, label: "OS 정본 저장", mode: "GitHub" },
    session: { ready: Boolean(env.OS_PUSH_SECRET), label: "팀 작업 세션", mode: "HttpOnly Session" },
    asset: { ready: Boolean(githubReady && env.ASSET_UPLOAD_SESSION_URL && env.ASSET_UPLOAD_SERVICE_SECRET), label: "완료본 저장", mode: "Direct Object Upload" },
    openai: { ready: Boolean(githubReady && env.OPENAI_API_KEY), label: "숏폼·게시·학습", mode: "OpenAI Responses API" },
    thumbnail: { ready: Boolean(githubReady && env.THUMBNAIL_WORKER_WEBHOOK_URL && env.THUMBNAIL_WORKER_SECRET && env.THUMBNAIL_CALLBACK_SECRET), label: "썸네일 생성·평가", mode: "Image + Vision Worker" },
    render: { ready: Boolean(githubReady && env.VIDEO_WORKER_WEBHOOK_URL && env.VIDEO_WORKER_SECRET && env.VIDEO_CALLBACK_SECRET), label: "완료본 검증·숏폼", mode: "FFmpeg Worker" },
    youtube: { ready: Boolean(githubReady && env.YOUTUBE_WORKER_WEBHOOK_URL && env.YOUTUBE_WORKER_SECRET && env.YOUTUBE_CALLBACK_SECRET && env.YOUTUBE_PUBLISH_APPROVAL_SECRET), label: "YouTube 업로드", mode: "YouTube Data API" },
    metrics: { ready: Boolean(githubReady && env.METRICS_WORKER_WEBHOOK_URL && env.METRICS_WORKER_SECRET && env.METRICS_CALLBACK_SECRET), label: "성과 회수", mode: "YouTube Data/Analytics API" },
  };
}

function connectorForProvider(provider, env = process.env) {
  const connectors = connectorStatus(env);
  return ({
    openai: connectors.openai,
    thumbnail_worker: connectors.thumbnail,
    asset_upload: connectors.asset,
    render_worker: connectors.render,
    youtube: connectors.youtube,
    youtube_data: connectors.metrics,
    human: { ready: true, label: "사람 작업", mode: "OS 확인" },
  })[provider];
}

function stageStateTemplate() {
  return { status: "locked", attempt: 0, jobId: null, idempotencyKey: null, outputPath: null, assetUrl: null, publishSettings: null, parameters: null, error: null, updatedAt: null };
}

export function normalizeAutomationState(source, contentId) {
  const state = source && typeof source === "object" ? structuredClone(source) : {};
  state.schemaVersion = "1.0";
  state.contentId = contentId;
  state.pipelineId = PIPELINE_ID;
  state.currentStageId ||= "source_package";
  state.status ||= "ready";
  state.stages ||= {};
  state.questions = Array.isArray(state.questions) ? state.questions : [];
  state.jobs = Array.isArray(state.jobs) ? state.jobs : [];
  for (const stage of AUTOMATION_STAGES) state.stages[stage.id] = { ...stageStateTemplate(), ...(state.stages[stage.id] || {}) };
  if (AUTOMATION_STAGES.every((stage) => state.stages[stage.id].status === "locked")) state.stages.source_package.status = "ready";
  unlockAvailableStages(state);
  return state;
}

function dependenciesCompleted(state, stage) {
  return stage.dependsOn.every((dependency) => state.stages[dependency]?.status === "completed");
}

export function unlockAvailableStages(state) {
  for (const stage of AUTOMATION_STAGES) {
    const stageState = state.stages[stage.id];
    if (stageState.status === "locked" && dependenciesCompleted(state, stage)) stageState.status = "ready";
  }
  const active = AUTOMATION_STAGES.find((stage) => ["needs_decision", "needs_input", "failed", "running", "queued", "ready"].includes(state.stages[stage.id].status));
  state.currentStageId = active?.id ?? AUTOMATION_STAGES.at(-1).id;
  state.status = active ? state.stages[active.id].status : "completed";
  return state;
}

export function completeAutomationStage(state, stageId, { outputPath = null, assetUrl = null, actor = "system", now = new Date().toISOString() } = {}) {
  const stage = STAGE_BY_ID.get(stageId);
  if (!stage) throw new Error("지원하지 않는 Automation Stage입니다.");
  const target = state.stages[stageId];
  target.status = "completed";
  target.outputPath = outputPath ?? target.outputPath;
  target.assetUrl = assetUrl ?? target.assetUrl;
  target.error = null;
  target.updatedAt = now;
  state.updatedAt = now;
  state.updatedBy = actor;
  return unlockAvailableStages(state);
}

function scalar(value) {
  if (value === null || value === undefined || value === "") return "null";
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return JSON.stringify(String(value));
}

function updateMarkdownFrontmatter(markdown, updates) {
  const lines = String(markdown || "").replace(/\r\n/g, "\n").split("\n");
  if (lines[0] !== "---") throw new Error("Automation 결과 Frontmatter가 없습니다.");
  const end = lines.indexOf("---", 1);
  if (end < 0) throw new Error("Automation 결과 Frontmatter가 닫히지 않았습니다.");
  const seen = new Set();
  for (let index = 1; index < end; index += 1) {
    const match = lines[index].match(/^([A-Za-z0-9_]+):/);
    if (!match || !(match[1] in updates)) continue;
    lines[index] = `${match[1]}: ${scalar(updates[match[1]])}`;
    seen.add(match[1]);
  }
  const additions = Object.entries(updates)
    .filter(([key]) => !seen.has(key))
    .map(([key, value]) => `${key}: ${scalar(value)}`);
  lines.splice(end, 0, ...additions);
  return lines.join("\n");
}

function frontmatterFields(markdown) {
  const lines = String(markdown || "").replace(/\r\n/g, "\n").split("\n");
  if (lines[0] !== "---") return {};
  const end = lines.indexOf("---", 1);
  if (end < 0) return {};
  const fields = {};
  for (const line of lines.slice(1, end)) {
    if (/^\s/.test(line)) continue;
    const match = line.match(/^([A-Za-z0-9_]+):\s*(.*)$/);
    if (!match) continue;
    fields[match[1]] = match[2].replace(/^"(.*)"$/, "$1");
  }
  return fields;
}

function inlineList(value) {
  const text = String(value || "").trim();
  if (!text.startsWith("[") || !text.endsWith("]")) return [];
  return text.slice(1, -1).split(",")
    .map((item) => item.trim().replace(/^(?:"(.*)"|'(.*)')$/, "$1$2"))
    .filter(Boolean);
}

function normalizeRepoPath(contentId, filePath) {
  const value = String(filePath || "").trim().replace(/^\/+/, "");
  if (!value || value === "null") return null;
  if (/^(?:00_system|01_company|02_brands|03_processes|04_skills|05_contents|06_meetings|07_automations|08_people|10_wiki)\//.test(value)) return value;
  return `05_contents/${contentId}/${value}`;
}

function contentInputPaths(snapshot, stage) {
  const dependencyPaths = stage.dependsOn
    .map((dependency) => normalizeRepoPath(snapshot.state.contentId, snapshot.state.stages[dependency]?.outputPath))
    .filter(Boolean);
  const pointerPaths = CONTENT_INPUT_POINTERS
    .map((pointer) => normalizeRepoPath(snapshot.state.contentId, snapshot.contentMetadata[pointer]))
    .filter(Boolean);
  return [...new Set([...dependencyPaths, ...pointerPaths])];
}

function recentThumbnailLearningPaths(snapshot, limit = 10) {
  return snapshot.treeEntries
    .filter((item) => item.type === "blob" && /^05_contents\/BA-\d{4}\/05_edit\/automation\/results\/thumbnail_learn_v\d+\.md$/.test(item.path))
    .map((item) => item.path)
    .sort()
    .slice(-limit);
}

async function latestWikiPaths(snapshot) {
  const recipeMetadata = frontmatterFields(snapshot.recipeSource);
  const wikiIds = inlineList(recipeMetadata.wiki_sources);
  if (!wikiIds.length) throw new Error("Automation Recipe에 wiki_sources가 없습니다.");
  const candidates = snapshot.treeEntries
    .filter((item) => item.type === "blob" && /^10_wiki\/.+\.md$/.test(item.path));
  const resolved = await Promise.all(candidates.map(async (item) => {
    const source = await repositoryFile(snapshot.repository, item.path, snapshot.headSha, true);
    const metadata = frontmatterFields(source || "");
    return { path: item.path, metadata };
  }));
  return wikiIds.map((wikiId) => {
    const matches = resolved.filter((item) => item.metadata.wiki_id === wikiId && item.metadata.is_latest === "true");
    if (matches.length !== 1) throw new Error(`최신 Wiki를 하나로 확정할 수 없습니다: ${wikiId}`);
    return matches[0].path;
  });
}

async function accessSkillPath(snapshot) {
  const recipeMetadata = frontmatterFields(snapshot.recipeSource);
  const skillId = recipeMetadata.access_skill;
  if (!skillId) throw new Error("Automation Recipe에 access_skill이 없습니다.");
  const candidates = snapshot.treeEntries.filter((item) => item.type === "blob" && /^04_skills\/.+\/SKILL\.md$/.test(item.path));
  const matches = [];
  for (const item of candidates) {
    const source = await repositoryFile(snapshot.repository, item.path, snapshot.headSha, true);
    if (frontmatterFields(source || "").skill_id === skillId) matches.push(item.path);
  }
  if (matches.length !== 1) throw new Error(`Access Skill을 하나로 확정할 수 없습니다: ${skillId}`);
  return matches[0];
}

function callbackUrl(env = process.env) {
  if (env.AUTOMATION_CALLBACK_URL) return env.AUTOMATION_CALLBACK_URL;
  const host = env.VERCEL_PROJECT_PRODUCTION_URL || env.VERCEL_URL;
  return host ? `https://${host}/api/automation` : null;
}

function validateAssetUrl(value, stageId) {
  const text = String(value || "").trim();
  if (!text) return;
  if (/^asset:\/\/[a-z0-9][a-z0-9._/-]{2,500}$/i.test(text)) return;
  let url;
  try {
    url = new URL(text);
  } catch {
    throw new Error("자산 URL 형식이 올바르지 않습니다.");
  }
  const youtubeHost = ["youtube.com", "www.youtube.com", "youtu.be"].includes(url.hostname);
  if (url.protocol === "https:" && stageId === "youtube_publish" && youtubeHost) return;
  if (url.protocol === "https:" && process.env.ALLOW_PUBLIC_ASSET_URLS === "true") return;
  throw new Error("공개 Repository에는 서명 URL을 저장할 수 없습니다. asset:// 형태의 자산 ID를 사용해주세요.");
}

export function resultMarkdown({ contentId, stageId, actor, provider, version, status, output, assetUrl, createdAt = new Date().toISOString() }) {
  const id = `${contentId}-${stageId}-run-${version}`;
  return `---
schema_version: "1.0"
id: ${id}
entity_type: automation_result
content_id: ${contentId}
pipeline_id: ${PIPELINE_ID}
stage_id: ${stageId}
status: ${status}
owner: ${actor}
provider: ${provider}
version: ${version}
asset_url: ${scalar(assetUrl)}
created_at: ${createdAt}
updated_at: ${createdAt}
updated_by: ${actor}
---

# ${STAGE_LABELS[stageId] || stageId}

${String(output || "결과 본문 없음").trim()}
`;
}

export function responseText(result) {
  if (typeof result?.output_text === "string") return result.output_text.trim();
  return (result?.output || [])
    .flatMap((item) => item.content || [])
    .filter((item) => item.type === "output_text" && typeof item.text === "string")
    .map((item) => item.text)
    .join("\n")
    .trim();
}

export function extractQuestions(markdown) {
  const lines = String(markdown || "").replace(/\r\n/g, "\n").split("\n");
  const start = lines.findIndex((line) => /^##\s+확인 필요\s*$/.test(line.trim()));
  if (start < 0) return [];
  const section = lines.slice(start + 1);
  const end = section.findIndex((line) => /^##\s+/.test(line.trim()));
  const candidates = (end < 0 ? section : section.slice(0, end))
    .map((line) => line.trim().replace(/^[-*]\s*/, ""))
    .filter(Boolean);
  return candidates.filter((item) => !/^(없음|해당 없음|없습니다)[.!]?$/.test(item));
}

async function runOpenAI(stageId, inputText) {
  if (!process.env.OPENAI_API_KEY) throw new Error("OpenAI 연결이 필요합니다. 운영 환경에 OPENAI_API_KEY를 설정해주세요.");
  const instructions = OPENAI_INSTRUCTIONS[stageId];
  if (!instructions) throw new Error("이 단계의 AI Recipe가 아직 등록되지 않았습니다.");
  const body = {
    model: process.env.OPENAI_AUTOMATION_MODEL || "gpt-5.6",
    instructions: `${instructions}\n\n공통 안전 규칙: 결과 마지막에 반드시 ## 확인 필요 섹션을 두세요. 사람에게 물어볼 내용이 없으면 정확히 - 없음이라고 적으세요.`,
    input: inputText,
  };
  if (process.env.OPENAI_WEB_SEARCH_ENABLED === "true" && stageId === "publish_package") {
    body.tools = [{ type: "web_search" }];
  }
  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: { authorization: `Bearer ${process.env.OPENAI_API_KEY}`, "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(result.error?.message || `OpenAI Responses API ${response.status}`);
  const output = responseText(result).replace(/^```(?:markdown)?\s*/i, "").replace(/\s*```$/, "").trim();
  if (!output) throw new Error("AI가 결과 본문을 반환하지 않았습니다.");
  return output;
}

async function github(path, options = {}) {
  const { allow404 = false, ...fetchOptions } = options;
  const response = await fetch(`https://api.github.com${path}`, {
    ...fetchOptions,
    headers: {
      accept: "application/vnd.github+json",
      authorization: `Bearer ${process.env.GITHUB_TOKEN}`,
      "x-github-api-version": "2022-11-28",
      "content-type": "application/json",
      ...(fetchOptions.headers || {}),
    },
  });
  if (response.status === 404 && allow404) return null;
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(body.message || `GitHub API ${response.status}`);
    error.status = response.status;
    throw error;
  }
  return body;
}

async function repositoryFile(repository, filePath, ref, allow404 = false) {
  const body = await github(`/repos/${repository}/contents/${filePath}?ref=${encodeURIComponent(ref)}`, { allow404 });
  if (!body) return null;
  return Buffer.from(body.content, "base64").toString("utf8");
}

async function loadSnapshot(contentId) {
  if (!process.env.GITHUB_TOKEN) throw new Error("GitHub 저장 연결이 필요합니다.");
  const repository = process.env.GITHUB_REPOSITORY || DEFAULT_REPOSITORY;
  const branch = process.env.GITHUB_BRANCH || DEFAULT_BRANCH;
  const ref = await github(`/repos/${repository}/git/ref/heads/${branch}`);
  const headSha = ref.object.sha;
  const headCommit = await github(`/repos/${repository}/git/commits/${headSha}`);
  const tree = await github(`/repos/${repository}/git/trees/${headCommit.tree.sha}?recursive=1`);
  const contentPath = `05_contents/${contentId}/CONTENT.md`;
  const contentSource = await repositoryFile(repository, contentPath, headSha);
  const contentMetadata = frontmatterFields(contentSource);
  if (contentMetadata.id !== contentId || contentMetadata.type !== "longform") throw new Error("Longform Content Run을 찾지 못했습니다.");
  if (contentMetadata.automation_recipe !== PIPELINE_ID) throw new Error("이 Content Run에는 YouTube Automation Recipe가 연결되지 않았습니다.");
  if (!["edit", "thumbnail", "approval", "publish", "metrics"].includes(contentMetadata.current_step)) throw new Error("편집 단계에 진입한 Longform Content Run만 자동화를 실행할 수 있습니다.");
  if (contentMetadata.script_status !== "approved" || !contentMetadata.latest_script || !contentMetadata.latest_shoot) throw new Error("승인 원고와 촬영 입력이 준비된 뒤 자동화를 실행해주세요.");
  const statePath = `05_contents/${contentId}/05_edit/automation/state.json`;
  const stateSource = await repositoryFile(repository, statePath, headSha, true);
  const state = normalizeAutomationState(stateSource ? JSON.parse(stateSource) : null, contentId);
  const recipeSource = await repositoryFile(repository, RECIPE_PATH, headSha);
  const pipelinePath = "03_processes/longform/YOUTUBE_PIPELINE.json";
  const pipeline = JSON.parse(await repositoryFile(repository, pipelinePath, headSha));
  if (pipeline.id !== PIPELINE_ID || !Array.isArray(pipeline.stages)) throw new Error("YouTube Automation Pipeline 정본이 올바르지 않습니다.");
  return {
    repository, branch, headSha, treeSha: headCommit.tree.sha, treeEntries: tree.tree || [],
    contentPath, contentSource, contentMetadata, statePath, state,
    baseState: structuredClone(state), recipePath: RECIPE_PATH, recipeSource, pipelinePath, pipeline,
  };
}

export function contentProgressUpdates(state) {
  const stages = state.stages;
  const current = STAGE_BY_ID.get(state.currentStageId);
  const base = {
    status: "in_progress",
    current_step: "edit",
    owner: "jay",
    next_owner: "jay",
    edit_status: "in_progress",
    thumbnail_status: "locked",
    approval_status: "locked",
    publish_status: "locked",
    metrics_status: "locked",
    next_action: current ? `${STAGE_LABELS[current.id]} 진행` : "유튜브 제작 공정 진행",
  };
  if (stages.master_upload.status === "completed") {
    Object.assign(base, {
      current_step: "thumbnail", edit_status: "completed", thumbnail_status: "in_progress",
      next_action: "완료본 검증·썸네일 아이디어·숏폼 생성",
    });
  }
  if (stages.thumbnail_approve.status === "completed") {
    Object.assign(base, {
      current_step: "approval", owner: "jay", next_owner: "jay",
      edit_status: "completed", thumbnail_status: "approved", approval_status: "in_progress",
      next_action: "숏폼·게시 문안 완료 후 업로드 설정 확인",
    });
  }
  if (stages.thumbnail_approve.status === "completed" && (stages.publish_package.status === "completed" || ["ready", "needs_decision", "queued", "running"].includes(stages.youtube_publish.status))) {
    Object.assign(base, {
      current_step: "approval", owner: "ricky", next_owner: "ricky",
      edit_status: "completed", thumbnail_status: "approved", approval_status: "waiting_approval",
      next_action: "롱폼·숏폼 업로드 설정 확인",
    });
  }
  if (["queued", "running"].includes(stages.youtube_publish.status)) {
    Object.assign(base, {
      current_step: "publish", owner: "jay", next_owner: "jay",
      approval_status: "approved", publish_status: "in_progress",
      next_action: "YouTube 업로드·예약 완료 확인",
    });
  }
  if (stages.youtube_publish.status === "completed") {
    Object.assign(base, {
      current_step: "metrics", owner: "eric", next_owner: "eric",
      approval_status: "approved", publish_status: "completed", metrics_status: "in_progress",
      next_action: "게시 후 성과 스냅샷 수집",
    });
  }
  if (stages.metrics.status === "completed") {
    Object.assign(base, {
      status: "in_progress", current_step: "metrics", owner: "eric", next_owner: "eric",
      approval_status: "approved", publish_status: "completed", metrics_status: "in_progress",
      next_action: "썸네일 CTR 학습 기록 생성",
    });
  }
  if (stages.thumbnail_learn.status === "completed") {
    Object.assign(base, {
      status: "completed", current_step: "metrics", owner: "eric", next_owner: null,
      approval_status: "approved", publish_status: "completed", metrics_status: "completed",
      next_action: "학습 기록을 다음 썸네일 아이디어에 재사용",
    });
  }
  if (["needs_input", "needs_decision", "blocked", "failed"].includes(state.status) && current) {
    base.next_action = `${STAGE_LABELS[current.id]} 예외 확인`;
  }
  return base;
}

function milestoneDefinitions(baseState, state, stageId) {
  const before = baseState.stages[stageId]?.status;
  const after = state.stages[stageId]?.status;
  const definitions = [];
  if (stageId === "master_upload" && before !== "completed" && after === "completed") definitions.push({ key: "edit", pointer: "latest_edit", folder: "05_edit", step: "edit", title: "롱폼 최종 마스터", status: "completed", approvalStatus: "not_required", alsoPointer: "latest_master" });
  if (stageId === "thumbnail_approve" && before !== "completed" && after === "completed") definitions.push({ key: "thumbnail", pointer: "latest_thumbnail", folder: "06_thumbnail", step: "thumbnail", title: "사람이 승인한 최종 썸네일", status: "approved", approvalStatus: "approved" });
  if (stageId === "youtube_publish" && before === "needs_decision" && ["queued", "running", "completed"].includes(after)) definitions.push({ key: "approval", pointer: "latest_approval", folder: "07_approval", step: "approval", title: "YouTube 게시 승인 기록", status: "approved", approvalStatus: "approved" });
  if (stageId === "youtube_publish" && before !== "completed" && after === "completed") definitions.push({ key: "publish", pointer: "latest_publish", folder: "08_publish", step: "publish", title: "YouTube 게시 결과", status: "completed", approvalStatus: "approved" });
  if (stageId === "metrics" && before !== "completed" && after === "completed") definitions.push({ key: "metrics", pointer: "latest_metrics", folder: "09_metrics", step: "metrics", title: "YouTube 성과 스냅샷", status: "completed", approvalStatus: "not_required" });
  return definitions;
}

export function milestoneDefinition(baseState, state, stageId) {
  return milestoneDefinitions(baseState, state, stageId)[0] || null;
}

async function milestoneChanges(snapshot, baseState, state, stageId) {
  const definitions = milestoneDefinitions(baseState, state, stageId);
  if (!definitions.length) return { files: [], pointers: {} };
  const metadata = frontmatterFields(snapshot.contentSource);
  const target = state.stages[stageId];
  const now = state.updatedAt || new Date().toISOString();
  const files = [];
  const pointers = {};
  for (const definition of definitions) {
    const previousRelativePath = metadata[definition.pointer] && metadata[definition.pointer] !== "null" ? metadata[definition.pointer] : null;
    const previousVersion = Number(previousRelativePath?.match(/_v(\d+)\.md$/)?.[1] || 0);
    const version = previousVersion + 1;
    const relativePath = `${definition.folder}/${definition.key}_v${version}.md`;
    const repositoryPath = `05_contents/${state.contentId}/${relativePath}`;
    const parentId = previousVersion ? `${state.contentId}-${definition.key}-v${previousVersion}` : null;
    const markdown = `---
schema_version: "1.0"
id: ${scalar(`${state.contentId}-${definition.key}-v${version}`)}
entity_type: "artifact"
content_id: ${scalar(state.contentId)}
artifact_key: ${scalar(definition.key)}
title: ${scalar(definition.title)}
process: "longform"
step: ${scalar(definition.step)}
status: ${scalar(definition.status)}
owner: ${scalar(state.updatedBy || "system")}
version: ${version}
is_latest: true
created_at: ${scalar(now)}
updated_at: ${scalar(now)}
updated_by: ${scalar(state.updatedBy || "system")}
approval_status: ${scalar(definition.approvalStatus)}
${parentId ? `parent_id: ${scalar(parentId)}\n` : ""}source_automation_result: ${scalar(target.outputPath)}
asset_url: ${scalar(target.assetUrl)}
---

# ${definition.title}

## Automation 연결

- pipeline: ${PIPELINE_ID}
- stage: ${stageId}
- result: ${target.outputPath || "-"}
- asset: ${target.assetUrl || "-"}
`;
    files.push({ path: repositoryPath, content: markdown });
    if (previousRelativePath) {
      const previousPath = normalizeRepoPath(state.contentId, previousRelativePath);
      const previousSource = await repositoryFile(snapshot.repository, previousPath, snapshot.headSha, true);
      if (previousSource) files.push({ path: previousPath, content: `${updateMarkdownFrontmatter(previousSource, { is_latest: false }).trim()}\n` });
    }
    pointers[definition.pointer] = relativePath;
    if (definition.alsoPointer) pointers[definition.alsoPointer] = relativePath;
  }
  return { files, pointers };
}

function syncContentSource(source, state, pointers = {}) {
  const metadata = frontmatterFields(source);
  return updateMarkdownFrontmatter(source, {
    ...contentProgressUpdates(state),
    ...pointers,
    version: Number(metadata.version || 0) + 1,
    updated_at: state.updatedAt || new Date().toISOString(),
    updated_by: state.updatedBy || "system",
  });
}

function mergeConcurrentState(latestState, incomingState, stageId) {
  const merged = structuredClone(latestState);
  merged.stages[stageId] = structuredClone(incomingState.stages[stageId]);
  merged.questions = [
    ...(latestState.questions || []).filter((item) => item.stageId !== stageId),
    ...(incomingState.questions || []).filter((item) => item.stageId === stageId),
  ];
  merged.jobs = [
    ...(latestState.jobs || []).filter((item) => item.stageId !== stageId),
    ...(incomingState.jobs || []).filter((item) => item.stageId === stageId),
  ];
  merged.updatedAt = incomingState.updatedAt;
  merged.updatedBy = incomingState.updatedBy;
  return unlockAvailableStages(merged);
}

async function commitFiles(snapshot, files, message, { stageId } = {}) {
  let working = snapshot;
  let state = snapshot.state;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    if (attempt > 0) {
      const latest = await loadSnapshot(snapshot.state.contentId);
      if (!stageId || JSON.stringify(latest.state.stages[stageId]) !== JSON.stringify(snapshot.baseState.stages[stageId])) {
        const error = new Error("같은 공정이 다른 작업자에 의해 먼저 변경됐습니다. 최신 상태를 불러와 다시 시도해주세요.");
        error.status = 409;
        throw error;
      }
      state = mergeConcurrentState(latest.state, snapshot.state, stageId);
      snapshot.state = state;
      working = latest;
    }
    const milestone = stageId ? await milestoneChanges(working, snapshot.baseState, state, stageId) : { files: [], pointers: {} };
    const stateFile = { path: working.statePath, content: `${JSON.stringify(state, null, 2)}\n` };
    const contentFile = { path: working.contentPath, content: `${syncContentSource(working.contentSource, state, milestone.pointers).trim()}\n` };
    const effectiveFiles = [
      ...files.filter((file) => ![working.statePath, working.contentPath].includes(file.path)),
      ...milestone.files,
      stateFile,
      contentFile,
    ];
    const blobs = await Promise.all(effectiveFiles.map(async (file) => {
      const blob = await github(`/repos/${working.repository}/git/blobs`, {
        method: "POST",
        body: JSON.stringify({ content: file.content, encoding: "utf-8" }),
      });
      return { path: file.path, mode: "100644", type: "blob", sha: blob.sha };
    }));
    const tree = await github(`/repos/${working.repository}/git/trees`, {
      method: "POST",
      body: JSON.stringify({ base_tree: working.treeSha, tree: blobs }),
    });
    const commit = await github(`/repos/${working.repository}/git/commits`, {
      method: "POST",
      body: JSON.stringify({ message, tree: tree.sha, parents: [working.headSha] }),
    });
    try {
      await github(`/repos/${working.repository}/git/refs/heads/${working.branch}`, {
        method: "PATCH",
        body: JSON.stringify({ sha: commit.sha, force: false }),
      });
      return commit.sha;
    } catch (error) {
      if (error.status !== 422 || attempt === 2) throw error;
    }
  }
  throw new Error("Repository 상태 갱신에 실패했습니다.");
}

function validateCommonPayload(payload) {
  if (!CONTENT_ID_PATTERN.test(payload.contentId || "")) throw new Error("Content ID 형식이 올바르지 않습니다.");
  if (!ACTOR_PATTERN.test(payload.actor || "")) throw new Error("작업자 형식이 올바르지 않습니다.");
  if (!STAGE_BY_ID.has(payload.stageId || "")) throw new Error("지원하지 않는 Automation Stage입니다.");
  if (String(payload.inputText || "").length > MAX_INPUT_LENGTH) throw new Error("입력 텍스트는 160,000자 이하여야 합니다.");
  if (String(payload.summary || "").length > 20_000) throw new Error("작업 요약은 20,000자 이하여야 합니다.");
  if (String(payload.assetUrl || "").length > 2_000) throw new Error("자산 URL이 너무 깁니다.");
  if (String(payload.output || "").length > MAX_RESULT_LENGTH) throw new Error("Worker 결과는 1.5MB 이하여야 합니다.");
  if (String(payload.publishApprovalSecret || "").length > 500) throw new Error("게시 승인 코드가 너무 깁니다.");
  if (payload.parameters !== undefined) {
    if (!payload.parameters || typeof payload.parameters !== "object" || Array.isArray(payload.parameters)) throw new Error("공정별 설정 형식이 올바르지 않습니다.");
    if (JSON.stringify(payload.parameters).length > 20_000) throw new Error("공정별 설정은 20,000자 이하여야 합니다.");
  }
  if (payload.stageId === "master_upload" && payload.parameters?.assets !== undefined) {
    const assets = payload.parameters.assets;
    if (!assets || typeof assets !== "object" || Array.isArray(assets)) throw new Error("완료본 자산 목록 형식이 올바르지 않습니다.");
    const unexpected = Object.keys(assets).filter((key) => !["master", "subtitle", "thumbnail"].includes(key));
    if (unexpected.length) throw new Error("지원하지 않는 완료본 자산이 포함됐습니다.");
    if (!assets.master || !assets.subtitle) throw new Error("최종 MP4와 SRT 자산 ID가 모두 필요합니다.");
    for (const value of Object.values(assets)) if (value) validateAssetUrl(value, "master_upload");
    if (payload.assetUrl && payload.assetUrl !== assets.master) throw new Error("최종 마스터 자산 ID가 인계 목록과 일치하지 않습니다.");
  }
  validateAssetUrl(payload.assetUrl, payload.stageId);
  if (payload.outputKeys !== undefined && (!Array.isArray(payload.outputKeys) || payload.outputKeys.length > 50 || payload.outputKeys.some((item) => !/^[a-z][a-z0-9_-]{1,80}$/.test(item)))) throw new Error("Worker outputKeys 형식이 올바르지 않습니다.");
  if (payload.qaResults !== undefined && (!Array.isArray(payload.qaResults) || payload.qaResults.length > 100 || payload.qaResults.some((item) => typeof item !== "object" || typeof item.check !== "string" || !["pass", "fail"].includes(item.status)))) throw new Error("Worker qaResults 형식이 올바르지 않습니다.");
  if (payload.publishSettings !== null && payload.publishSettings !== undefined) {
    if (typeof payload.publishSettings !== "object" || !["private", "unlisted", "public"].includes(payload.publishSettings.privacyStatus)) throw new Error("YouTube 공개 설정이 올바르지 않습니다.");
    if (payload.publishSettings.publishAt) {
      if (!/(?:Z|[+-]\d{2}:\d{2})$/.test(payload.publishSettings.publishAt) || Number.isNaN(new Date(payload.publishSettings.publishAt).getTime())) throw new Error("YouTube 예약 시각에는 시간대가 포함되어야 합니다.");
      if (new Date(payload.publishSettings.publishAt).getTime() < Date.now() + 5 * 60_000) throw new Error("YouTube 예약 시각은 현재보다 5분 이후여야 합니다.");
      if (payload.publishSettings.privacyStatus !== "private") throw new Error("예약 게시를 사용할 때 공개 상태는 비공개여야 합니다.");
    }
  }
}

function stageContract(snapshot, stageId) {
  const contract = snapshot.pipeline.stages.find((item) => item.id === stageId);
  if (!contract) throw new Error("Pipeline에서 Stage Output Contract를 찾지 못했습니다.");
  return contract;
}

function effectiveAsset(snapshot, payload) {
  const target = snapshot.state.stages[payload.stageId];
  if (payload.assetUrl || target.assetUrl) return payload.assetUrl || target.assetUrl;
  if (payload.stageId === "youtube_publish") return snapshot.state.stages.master_upload.assetUrl;
  const stage = STAGE_BY_ID.get(payload.stageId);
  for (const dependency of stage?.dependsOn || []) {
    const dependencyAsset = snapshot.state.stages[dependency]?.assetUrl;
    if (dependencyAsset) return dependencyAsset;
  }
  if (["thumbnail_evaluate", "thumbnail_approve"].includes(payload.stageId)) return snapshot.state.stages.thumbnail_generate.assetUrl;
  return null;
}

function validateYoutubePublicUrl(value) {
  let url;
  try { url = new URL(String(value || "")); } catch { throw new Error("YouTube 게시 결과에는 공개 YouTube URL이 필요합니다."); }
  if (url.protocol !== "https:" || !["youtube.com", "www.youtube.com", "youtu.be"].includes(url.hostname)) throw new Error("YouTube 게시 결과 URL이 올바르지 않습니다.");
  return url.href;
}

function validateManualCompletion(snapshot, payload) {
  if (payload.qualityConfirmed !== true) throw new Error("완료 기준을 확인했다는 체크가 필요합니다.");
  if (payload.stageId === "thumbnail_approve" && !payload.assetUrl) throw new Error("사람이 선택한 최종 썸네일 Asset ID가 필요합니다.");
  if (ASSET_REQUIRED_STAGES.has(payload.stageId) && !effectiveAsset(snapshot, payload)) throw new Error("이 단계의 필수 산출물 asset:// ID를 연결해주세요.");
}

function validateWorkerCompletion(snapshot, payload) {
  if (payload.status !== "completed") return;
  const contract = stageContract(snapshot, payload.stageId);
  const outputKeys = new Set(payload.outputKeys || []);
  const missingOutputs = (contract.outputs || []).filter((key) => !outputKeys.has(key));
  if (missingOutputs.length) throw new Error(`Worker 필수 산출물이 누락됐습니다: ${missingOutputs.join(", ")}`);
  const qa = new Map((payload.qaResults || []).map((item) => [item.check, item.status]));
  const failedChecks = (contract.qualityChecks || []).filter((check) => qa.get(check) !== "pass");
  if (failedChecks.length) throw new Error(`Worker 품질검사가 완료되지 않았습니다: ${failedChecks.join(" · ")}`);
  if (ASSET_REQUIRED_STAGES.has(payload.stageId) && !payload.assetUrl) throw new Error("Worker가 이번 실행의 필수 산출물 자산 ID를 반환하지 않았습니다.");
  if (payload.stageId === "youtube_publish") validateYoutubePublicUrl(payload.assetUrl);
}

function assertStageActionAllowed(state, stageId, action) {
  const status = state.stages[stageId].status;
  if (stageId === "metrics" && action === "run" && status === "completed") return;
  if (action === "approve" && status !== "needs_decision") throw new Error("현재 승인 대기 상태가 아닙니다.");
  if (action === "revise" && status !== "needs_decision") throw new Error("현재 수정 요청 상태가 아닙니다.");
  if (action === "retry" && !["failed", "blocked", "needs_input"].includes(status)) throw new Error("재시도할 수 있는 상태가 아닙니다.");
  if (["run", "complete"].includes(action) && !["ready", "needs_input", "failed"].includes(status)) throw new Error(`현재 단계 상태(${status})에서는 실행할 수 없습니다.`);
}

async function resolveInput(payload, snapshot) {
  const direct = String(payload.inputText || "").trim();
  const stage = STAGE_BY_ID.get(payload.stageId);
  const historyPaths = payload.stageId === "thumbnail_idea" ? recentThumbnailLearningPaths(snapshot) : [];
  const sourcePaths = [...new Set([...contentInputPaths(snapshot, stage), ...historyPaths])];
  const sourceFiles = await Promise.all(sourcePaths.map(async (filePath) => ({
    filePath,
    source: await repositoryFile(snapshot.repository, filePath, snapshot.headSha, true),
  })));
  const sourceBundle = [
    payload.parameters && Object.keys(payload.parameters).length ? `# 공정 설정\n\n\`\`\`json\n${JSON.stringify(payload.parameters, null, 2)}\n\`\`\`` : "",
    direct ? `# 직접 입력\n\n${direct}` : "",
    ...sourceFiles.filter((item) => item.source).map((item) => `# 실행 자산 · ${item.filePath}\n\n${item.source}`),
  ].filter(Boolean).join("\n\n---\n\n");
  if (!sourceBundle) throw new Error("이 단계에 필요한 입력이 없습니다. 텍스트를 붙여넣거나 선행 단계와 Content 자산을 먼저 완료해주세요.");
  const brandPath = snapshot.contentMetadata.brand_id ? `02_brands/${snapshot.contentMetadata.brand_id}/context/BRAND.md` : null;
  const contextPaths = [...COMMON_CONTEXT_PATHS, brandPath, snapshot.recipePath, await accessSkillPath(snapshot), ...(await latestWikiPaths(snapshot))].filter(Boolean);
  const contextSources = await Promise.all(contextPaths.map(async (filePath) => ({
    filePath,
    source: filePath === snapshot.recipePath ? snapshot.recipeSource : await repositoryFile(snapshot.repository, filePath, snapshot.headSha, true),
  })));
  const contextBundle = contextSources
    .filter((item) => item.source)
    .map((item) => `\n\n---\n\n# OS 정본 · ${item.filePath}\n\n${item.source}`)
    .join("");
  const combined = `# 실행 입력\n\n${sourceBundle}${contextBundle}`;
  if (combined.length > MAX_INPUT_LENGTH) throw new Error("입력과 최신 Wiki 묶음이 160,000자를 초과합니다. 입력 범위를 줄여주세요.");
  return combined;
}

function resultPath(contentId, stageId, version) {
  return `05_contents/${contentId}/05_edit/automation/results/${stageId}_v${version}.md`;
}

function updateStageQuestions(state, stageId, questions, status, actor, now) {
  for (const question of state.questions) {
    if (question.stageId === stageId && question.status === "open") {
      question.status = status === "completed" ? "resolved" : "superseded";
      question.resolvedAt = now;
      question.resolvedBy = actor;
    }
  }
  for (const question of questions || []) {
    state.questions.push({
      id: `Q-${randomUUID()}`,
      stageId,
      question: String(question).slice(0, 1_000),
      status: "open",
      createdAt: now,
    });
  }
}

async function saveStageResult(snapshot, payload, { output, status, assetUrl = null }) {
  const stage = STAGE_BY_ID.get(payload.stageId);
  const target = snapshot.state.stages[payload.stageId];
  const version = Number(target.attempt || 0) + 1;
  const now = new Date().toISOString();
  const outputPath = resultPath(payload.contentId, payload.stageId, version);
  target.attempt = version;
  target.status = status;
  target.outputPath = outputPath;
  target.assetUrl = assetUrl || target.assetUrl;
  target.publishSettings = payload.publishSettings || target.publishSettings;
  target.parameters = payload.parameters || target.parameters || null;
  target.error = null;
  target.updatedAt = now;
  snapshot.state.updatedAt = now;
  snapshot.state.updatedBy = payload.actor;
  updateStageQuestions(snapshot.state, payload.stageId, payload.questions || [], status, payload.actor, now);
  if (status === "completed") completeAutomationStage(snapshot.state, payload.stageId, { outputPath, assetUrl, actor: payload.actor, now });
  else {
    snapshot.state.currentStageId = payload.stageId;
    snapshot.state.status = status;
  }
  const markdown = resultMarkdown({
    contentId: payload.contentId,
    stageId: payload.stageId,
    actor: payload.actor,
    provider: stage.provider,
    version,
    status,
    output,
    assetUrl,
    createdAt: now,
  });
  const commitSha = await commitFiles(snapshot, [
    { path: outputPath, content: markdown },
    { path: snapshot.statePath, content: `${JSON.stringify(snapshot.state, null, 2)}\n` },
  ], `automation(${payload.contentId}): ${payload.stageId} ${status}`, { stageId: payload.stageId });
  return { commitSha, outputPath, version, state: snapshot.state, output };
}

function webhookForProvider(provider) {
  return ({
    thumbnail_worker: process.env.THUMBNAIL_WORKER_WEBHOOK_URL,
    render_worker: process.env.VIDEO_WORKER_WEBHOOK_URL,
    youtube: process.env.YOUTUBE_WORKER_WEBHOOK_URL,
    youtube_data: process.env.METRICS_WORKER_WEBHOOK_URL,
  })[provider];
}

function workerSecretForProvider(provider) {
  return ({
    thumbnail_worker: process.env.THUMBNAIL_WORKER_SECRET,
    render_worker: process.env.VIDEO_WORKER_SECRET,
    youtube: process.env.YOUTUBE_WORKER_SECRET,
    youtube_data: process.env.METRICS_WORKER_SECRET,
  })[provider];
}

function callbackSecretForProvider(provider) {
  return ({
    thumbnail_worker: process.env.THUMBNAIL_CALLBACK_SECRET,
    render_worker: process.env.VIDEO_CALLBACK_SECRET,
    youtube: process.env.YOUTUBE_CALLBACK_SECRET,
    youtube_data: process.env.METRICS_CALLBACK_SECRET,
  })[provider];
}

async function queueExternalStage(snapshot, payload, extraFiles = []) {
  const stage = STAGE_BY_ID.get(payload.stageId);
  const connector = connectorForProvider(stage.provider);
  if (!connector?.ready) throw new Error(`${connector?.label || stage.provider} 연결이 필요합니다. 연결 전에는 수동 결과 등록을 사용할 수 있습니다.`);
  const workerCallbackUrl = callbackUrl();
  if (!workerCallbackUrl) throw new Error("Automation callback 주소가 설정되지 않았습니다.");
  const contextPaths = [
    ...COMMON_CONTEXT_PATHS,
    snapshot.contentMetadata.brand_id ? `02_brands/${snapshot.contentMetadata.brand_id}/context/BRAND.md` : null,
    snapshot.recipePath,
    await accessSkillPath(snapshot),
    ...(await latestWikiPaths(snapshot)),
  ].filter(Boolean);
  const now = new Date().toISOString();
  const target = snapshot.state.stages[payload.stageId];
  const jobId = target.jobId && target.idempotencyKey ? target.jobId : `JOB-${randomUUID()}`;
  const idempotencyKey = target.idempotencyKey || `${PIPELINE_ID}:${payload.contentId}:${payload.stageId}:${Number(target.attempt || 0) + 1}`;
  target.status = "queued";
  target.jobId = jobId;
  target.idempotencyKey = idempotencyKey;
  target.error = null;
  target.updatedAt = now;
  snapshot.state.status = "queued";
  snapshot.state.currentStageId = payload.stageId;
  snapshot.state.updatedAt = now;
  snapshot.state.updatedBy = payload.actor;
  const existingJob = snapshot.state.jobs.find((item) => item.id === jobId);
  if (existingJob) {
    existingJob.status = "queued";
    existingJob.idempotencyKey = idempotencyKey;
    existingJob.updatedAt = now;
  } else {
    snapshot.state.jobs.push({ id: jobId, idempotencyKey, stageId: payload.stageId, status: "queued", provider: stage.provider, createdAt: now, updatedAt: now });
  }
  const commitSha = await commitFiles(snapshot, [
    ...extraFiles,
    { path: snapshot.statePath, content: `${JSON.stringify(snapshot.state, null, 2)}\n` },
  ], `automation(${payload.contentId}): ${payload.stageId} queued`, { stageId: payload.stageId });
  let response;
  try {
    response = await fetch(webhookForProvider(stage.provider), {
      method: "POST",
      signal: AbortSignal.timeout(10_000),
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${workerSecretForProvider(stage.provider)}`,
      },
      body: JSON.stringify({
        jobId,
        pipelineId: PIPELINE_ID,
        contentId: payload.contentId,
        stageId: payload.stageId,
        actor: payload.actor,
        assetUrl: effectiveAsset(snapshot, payload),
        summary: payload.summary || null,
        parameters: payload.parameters || null,
        assetRefs: {
          ...(snapshot.state.stages.master_upload.parameters?.assets || {}),
          thumbnailCandidates: snapshot.state.stages.thumbnail_generate.assetUrl || null,
          approvedThumbnail: snapshot.state.stages.thumbnail_approve.assetUrl || null,
        },
        publishSettings: payload.publishSettings || null,
        callbackUrl: workerCallbackUrl,
        repository: snapshot.repository,
        branch: snapshot.branch,
        repositoryRef: commitSha,
        contentPath: `05_contents/${payload.contentId}/CONTENT.md`,
        statePath: snapshot.statePath,
        pipelinePath: "03_processes/longform/YOUTUBE_PIPELINE.json",
        recipePath: "07_automations/youtube-production/RECIPE.md",
        inputPaths: contentInputPaths(snapshot, stage),
        contextPaths,
        idempotencyKey,
      }),
    });
  } catch {
    response = null;
  }
  if (!response?.ok) {
    const failure = await loadSnapshot(payload.contentId);
    const failedAt = new Date().toISOString();
    const failedStage = failure.state.stages[payload.stageId];
    const failedJob = failure.state.jobs.find((item) => item.id === jobId);
    if (failedStage.jobId !== jobId || !failedJob || !["queued", "running"].includes(failedJob.status)) {
      return { commitSha, jobId, state: failure.state };
    }
    const ambiguous = !response;
    failedStage.status = ambiguous ? "blocked" : "failed";
    failedStage.error = ambiguous ? `${connector.label} 전달 확인 실패 · 같은 operation key로 재시도 필요` : `${connector.label} 요청 거절`;
    failedStage.updatedAt = failedAt;
    failedJob.status = ambiguous ? "queued" : "failed";
    failedJob.updatedAt = failedAt;
    failure.state.status = failedStage.status;
    failure.state.currentStageId = payload.stageId;
    failure.state.updatedAt = failedAt;
    failure.state.updatedBy = payload.actor;
    await commitFiles(failure, [{ path: failure.statePath, content: `${JSON.stringify(failure.state, null, 2)}\n` }], `automation(${payload.contentId}): ${payload.stageId} dispatch failed`, { stageId: payload.stageId });
    throw new Error(ambiguous
      ? `${connector.label} 전달 여부를 확인하지 못했습니다. 같은 operation key로 안전하게 재시도할 수 있습니다.`
      : `${connector.label} 요청이 거절됐습니다. 입력은 보존됐으며 재시도할 수 있습니다.`);
  }
  return { commitSha, jobId, state: snapshot.state };
}

async function handleUserAction(payload) {
  validateCommonPayload(payload);
  const snapshot = await loadSnapshot(payload.contentId);
  assertStageActionAllowed(snapshot.state, payload.stageId, payload.action);
  const stage = STAGE_BY_ID.get(payload.stageId);
  if (payload.action === "revise") {
    const now = new Date().toISOString();
    const target = snapshot.state.stages[payload.stageId];
    const job = target.jobId ? snapshot.state.jobs.find((item) => item.id === target.jobId) : null;
    if (job) { job.status = "revision_requested"; job.updatedAt = now; }
    updateStageQuestions(snapshot.state, payload.stageId, [], "retry", payload.actor, now);
    target.status = "ready";
    target.jobId = null;
    target.idempotencyKey = null;
    target.error = null;
    target.updatedAt = now;
    snapshot.state.status = "ready";
    snapshot.state.currentStageId = payload.stageId;
    snapshot.state.updatedAt = now;
    snapshot.state.updatedBy = payload.actor;
    const commitSha = await commitFiles(snapshot, [{ path: snapshot.statePath, content: `${JSON.stringify(snapshot.state, null, 2)}\n` }], `automation(${payload.contentId}): ${payload.stageId} revision requested`, { stageId: payload.stageId });
    return { commitSha, state: snapshot.state };
  }
  if (payload.action === "retry") {
    const now = new Date().toISOString();
    const previousStatus = snapshot.state.stages[payload.stageId].status;
    const previousJobId = snapshot.state.stages[payload.stageId].jobId;
    const previousJob = previousJobId ? snapshot.state.jobs.find((item) => item.id === previousJobId) : null;
    if (previousJob && previousStatus !== "blocked") { previousJob.status = "retry_requested"; previousJob.updatedAt = now; }
    updateStageQuestions(snapshot.state, payload.stageId, [], "retry", payload.actor, now);
    snapshot.state.stages[payload.stageId] = {
      ...snapshot.state.stages[payload.stageId],
      status: "ready",
      jobId: previousStatus === "blocked" ? previousJobId : null,
      idempotencyKey: previousStatus === "blocked" ? snapshot.state.stages[payload.stageId].idempotencyKey : null,
      error: null,
      updatedAt: now,
    };
    snapshot.state.status = "ready";
    snapshot.state.currentStageId = payload.stageId;
    snapshot.state.updatedAt = now;
    snapshot.state.updatedBy = payload.actor;
    const commitSha = await commitFiles(snapshot, [{ path: snapshot.statePath, content: `${JSON.stringify(snapshot.state, null, 2)}\n` }], `automation(${payload.contentId}): ${payload.stageId} retry`, { stageId: payload.stageId });
    return { commitSha, state: snapshot.state };
  }
  if (payload.action === "approve") {
    const target = snapshot.state.stages[payload.stageId];
    const now = new Date().toISOString();
    validateManualCompletion(snapshot, payload);
    const manualYoutubeCompletion = payload.stageId === "youtube_publish" && !connectorForProvider("youtube").ready;
    if (payload.stageId === "youtube_publish") {
      if (!process.env.YOUTUBE_PUBLISH_APPROVAL_SECRET) throw new Error("YouTube 게시 승인 연결이 설정되지 않았습니다.");
      if (!safeEqual(payload.publishApprovalSecret, process.env.YOUTUBE_PUBLISH_APPROVAL_SECRET)) throw new Error("YouTube 게시 승인 코드가 올바르지 않습니다.");
      payload.actor = process.env.YOUTUBE_PUBLISH_APPROVER || "ricky";
      if (!ACTOR_PATTERN.test(payload.actor)) throw new Error("YouTube 게시 승인자 설정이 올바르지 않습니다.");
      if (manualYoutubeCompletion) validateYoutubePublicUrl(payload.assetUrl || target.assetUrl);
    }
    const job = target.jobId ? snapshot.state.jobs.find((item) => item.id === target.jobId) : null;
    updateStageQuestions(snapshot.state, payload.stageId, [], "completed", payload.actor, now);
    const resultFiles = [];
    if (target.outputPath) {
      const resultSource = await repositoryFile(snapshot.repository, target.outputPath, snapshot.headSha, true);
      if (resultSource) {
        const approved = updateMarkdownFrontmatter(resultSource, { status: payload.stageId === "youtube_publish" && !manualYoutubeCompletion ? "approved" : "completed", updated_at: now, updated_by: payload.actor });
        resultFiles.push({ path: target.outputPath, content: `${approved.trim()}\n\n## 확인 기록\n\n- confirmed_by: ${payload.actor}\n- confirmed_at: ${now}\n- selected_values: ${String(payload.summary || "그대로 승인").trim()}\n- asset_ref: ${payload.assetUrl || target.assetUrl || "-"}\n` });
      }
    }
    if (payload.stageId === "youtube_publish") {
      if (!String(payload.summary || "").trim()) throw new Error("게시할 제목과 최종 확인 내용을 기록해주세요.");
      if (!manualYoutubeCompletion) return queueExternalStage(snapshot, payload, resultFiles);
      if (job) { job.status = "completed"; job.updatedAt = now; }
      completeAutomationStage(snapshot.state, payload.stageId, { outputPath: target.outputPath, assetUrl: payload.assetUrl || target.assetUrl, actor: payload.actor, now });
      const commitSha = await commitFiles(snapshot, [...resultFiles, { path: snapshot.statePath, content: `${JSON.stringify(snapshot.state, null, 2)}\n` }], `automation(${payload.contentId}): youtube publish manually confirmed`, { stageId: payload.stageId });
      return { commitSha, state: snapshot.state };
    }
    if (job) { job.status = "completed"; job.updatedAt = now; }
    completeAutomationStage(snapshot.state, payload.stageId, { outputPath: target.outputPath, assetUrl: payload.assetUrl || target.assetUrl, actor: payload.actor, now });
    const files = [{ path: snapshot.statePath, content: `${JSON.stringify(snapshot.state, null, 2)}\n` }];
    files.unshift(...resultFiles);
    const commitSha = await commitFiles(snapshot, files, `automation(${payload.contentId}): ${payload.stageId} approved`, { stageId: payload.stageId });
    return { commitSha, state: snapshot.state };
  }
  if (payload.action === "complete") {
    validateManualCompletion(snapshot, payload);
    const output = String(payload.summary || "").trim();
    if (!output && !payload.assetUrl) throw new Error("완료 내용 또는 산출물 자산 ID를 입력해주세요.");
    if (payload.stageId === "youtube_publish") validateYoutubePublicUrl(payload.assetUrl);
    const manualStatus = stage.humanGate ? "needs_decision" : "completed";
    const resolvedAsset = ASSET_REQUIRED_STAGES.has(payload.stageId) ? effectiveAsset(snapshot, payload) : payload.assetUrl || null;
    const assets = payload.stageId === "master_upload" ? payload.parameters?.assets : null;
    const assetHandoff = assets ? `\n\n## 자산 인계\n\n- final_master: ${assets.master}\n- clean_srt: ${assets.subtitle}\n- thumbnail: ${assets.thumbnail || "선택 안 함"}` : "";
    return saveStageResult(snapshot, payload, { output: `## 수동 작업 결과\n\n${output || "산출물 연결 완료"}${assetHandoff}\n\n## 수동 완료 기록\n\n- 완료 기준 확인: 예\n- 기록자: ${payload.actor}`, status: manualStatus, assetUrl: resolvedAsset });
  }
  if (payload.action !== "run") throw new Error("지원하지 않는 Automation 작업입니다.");
  if (payload.stageId === "metrics" && snapshot.state.stages.metrics.status === "completed") {
    snapshot.state.stages.metrics.jobId = null;
    snapshot.state.stages.metrics.idempotencyKey = null;
  }
  if (payload.stageId === "youtube_publish") {
    if (!payload.publishSettings) throw new Error("공개 상태와 예약 시각을 확인해주세요.");
    const settings = payload.publishSettings;
    const output = `## YouTube 게시 실행 계획\n\n- privacy_status: ${settings.privacyStatus}\n- publish_at: ${settings.publishAt || "즉시"}\n- asset_ref: ${payload.assetUrl || "이전 단계 자산"}\n\n## 확인 필요\n\n- 위 설정으로 YouTube 업로드를 실행할지 확인해주세요.`;
    return saveStageResult(snapshot, { ...payload, questions: ["위 설정으로 YouTube 업로드를 실행할지 확인해주세요."] }, { output, status: "needs_decision", assetUrl: payload.assetUrl || null });
  }
  if (stage.provider === "openai" || (stage.provider === "human_ai" && process.env.OPENAI_API_KEY)) {
    const input = await resolveInput(payload, snapshot);
    const output = await runOpenAI(payload.stageId, input);
    const questions = extractQuestions(output);
    return saveStageResult(snapshot, { ...payload, questions }, { output, status: stage.humanGate ? "needs_decision" : questions.length ? "needs_input" : "completed", assetUrl: payload.assetUrl || null });
  }
  if (["thumbnail_worker", "render_worker", "youtube", "youtube_data"].includes(stage.provider)) return queueExternalStage(snapshot, payload);
  throw new Error("이 단계는 사람의 결과 등록이 필요합니다.");
}

async function handleCallback(payload) {
  payload.actor ||= "system";
  validateCommonPayload(payload);
  if (!payload.jobId || !["completed", "failed", "needs_input", "needs_decision"].includes(payload.status)) throw new Error("Callback 상태가 올바르지 않습니다.");
  const snapshot = await loadSnapshot(payload.contentId);
  const stage = STAGE_BY_ID.get(payload.stageId);
  validateWorkerCompletion(snapshot, payload);
  const job = snapshot.state.jobs.find((item) => item.id === payload.jobId && item.stageId === payload.stageId);
  if (!job) throw new Error("등록된 Automation Job을 찾지 못했습니다.");
  if (!["queued", "running"].includes(job.status)) throw new Error("이미 처리된 Automation Job입니다.");
  const now = new Date().toISOString();
  const target = snapshot.state.stages[payload.stageId];
  if (target.jobId !== payload.jobId) throw new Error("현재 단계의 활성 Automation Job이 아닙니다.");
  const effectiveStatus = payload.status === "completed" && stage.humanGate && stage.provider !== "youtube" ? "needs_decision" : payload.status;
  job.status = effectiveStatus;
  job.updatedAt = now;
  if (payload.status === "failed" || payload.status === "needs_input") {
    target.status = payload.status;
    target.error = String(payload.error || payload.summary || "Worker 작업 실패").slice(0, 2_000);
    target.updatedAt = now;
    snapshot.state.status = payload.status;
    snapshot.state.currentStageId = payload.stageId;
    snapshot.state.updatedAt = now;
    snapshot.state.updatedBy = payload.actor;
    const commitSha = await commitFiles(snapshot, [{ path: snapshot.statePath, content: `${JSON.stringify(snapshot.state, null, 2)}\n` }], `automation(${payload.contentId}): ${payload.stageId} ${payload.status}`, { stageId: payload.stageId });
    return { commitSha, state: snapshot.state };
  }
  const callbackPayload = { ...payload, actor: payload.actor || "system" };
  return saveStageResult(snapshot, callbackPayload, {
    output: String(payload.output || payload.summary || "Worker 산출물 생성 완료"),
    status: effectiveStatus,
    assetUrl: payload.assetUrl || null,
  });
}

export default async function handler(request, response) {
  if (request.method === "GET") {
    try {
      const url = new URL(request.url || "/api/automation", "https://brandyaction-os.vercel.app");
      const contentId = url.searchParams.get("contentId");
      if (!contentId) return json({ ok: true, pipelineId: PIPELINE_ID, connectors: connectorStatus(), stages: AUTOMATION_STAGES }, 200, response);
      if (!CONTENT_ID_PATTERN.test(contentId)) return json({ error: "Content ID 형식이 올바르지 않습니다." }, 400, response);
      if (!process.env.GITHUB_TOKEN) return json({ error: "GitHub 상태 연결이 필요합니다." }, 503, response);
      const snapshot = await loadSnapshot(contentId);
      return json({ ok: true, pipelineId: PIPELINE_ID, connectors: connectorStatus(), state: snapshot.state }, 200, response);
    } catch (error) {
      return json({ error: error.message || "Automation 상태를 읽지 못했습니다." }, 400, response);
    }
  }
  if (request.method !== "POST") return json({ error: "GET 또는 POST 요청만 허용됩니다." }, 405, response);
  try {
    const payload = await requestBody(request);
    const authorization = request.headers.get?.("authorization") || request.headers.authorization || "";
    if (payload.action === "callback") {
      const callbackStage = STAGE_BY_ID.get(payload.stageId || "");
      const callbackSecret = callbackStage ? callbackSecretForProvider(callbackStage.provider) : null;
      if (!callbackSecret || !safeEqual(authorization, `Bearer ${callbackSecret}`)) return json({ error: "Callback 인증이 올바르지 않습니다." }, 401, response);
      return json({ ok: true, ...(await handleCallback(payload)) }, 200, response);
    }
    const auth = authorizationContext(request, process.env, authorization);
    if (!auth.authorized) return json({ error: "팀 작업 세션이 필요합니다." }, 401, response);
    if (auth.actor) payload.actor = auth.actor;
    return json({ ok: true, ...(await handleUserAction(payload)) }, 200, response);
  } catch (error) {
    return json({ error: error.message || "Automation 작업에 실패했습니다." }, 400, response);
  }
}
