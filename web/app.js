const app = document.querySelector("#app");
const pageTitle = document.querySelector("#page-title");
const userSelect = document.querySelector("#user-select");
const taskCount = document.querySelector("#task-count");
const peopleCount = document.querySelector("#people-count");
const meetingCount = document.querySelector("#meeting-count");
const syncTime = document.querySelector("#sync-time");
const sidebar = document.querySelector("#sidebar");
const drawer = document.querySelector("#drawer");
const drawerBackdrop = document.querySelector("#drawer-backdrop");
const drawerContent = document.querySelector("#drawer-content");
const submitModal = document.querySelector("#submit-modal");
const submitBackdrop = document.querySelector("#submit-backdrop");
const submitForm = document.querySelector("#submit-form");
const submitFeedback = document.querySelector("#submit-feedback");
const sessionStatusButton = document.querySelector("#session-status");
const sessionModal = document.querySelector("#session-modal");
const sessionBackdrop = document.querySelector("#session-backdrop");
const sessionForm = document.querySelector("#session-form");
const sessionFeedback = document.querySelector("#session-feedback");

const viewTitles = {
  dashboard: "전체 업무 공정",
  tasks: "내가 할 일",
  youtube: "유튜브 제작",
  contents: "콘텐츠 Run",
  meetings: "회의 노트",
  people: "직원 워크스페이스",
  wiki: "Company Wiki",
  skills: "OS Access Skills",
};

const statusLabels = {
  draft: "초안",
  ready: "준비",
  in_progress: "진행 중",
  waiting_human: "사람 확인 대기",
  waiting_approval: "승인 대기",
  review: "검수 중",
  approved: "승인 완료",
  rejected: "반려",
  completed: "완료",
  archived: "보관",
  locked: "잠김",
  active: "활성",
  inbox: "Inbox",
  organized: "정리 완료",
  decision: "의사결정",
  queued: "실행 대기",
  running: "실행 중",
  needs_input: "입력 필요",
  needs_decision: "확인 필요",
  blocked: "막힘",
  failed: "실패",
  not_started: "시작 전",
};

let index = null;
let currentView = location.hash.replace("#", "") || "dashboard";
let currentUser = localStorage.getItem("ba-os-user") || "ricky";
let activeSkillFilter = "all";
let activeWikiFilter = "all";
let activeMeetingFilter = "all";
let activeMeetingPath = "";
let activeMeetingId = "";
let activeMeetingVersion = 0;
let meetingNextOffset = null;
let meetingSourceType = "manual";
let meetingStream = null;
let meetingRecorder = null;
let meetingRecordingActive = false;
let meetingRecordingStartedAt = 0;
let meetingTimer = null;
let meetingSegmentTimer = null;
let meetingSegments = [];
let automationConnectors = {};
let activeYoutubeContentId = localStorage.getItem("ba-os-youtube-content") || "";
let activeYoutubeStageId = localStorage.getItem("ba-os-youtube-stage") || "";
let youtubeLastOutput = null;
let youtubeRequestSerial = 0;
let youtubePollTimer = null;
let workSession = { authenticated: false, actor: null, expiresAt: null };
let pendingYoutubeAction = null;
let youtubeUploadAssets = {};

const YOUTUBE_DISPLAY_GROUPS = [
  { id: "context", order: 1, label: "작업 준비", description: "최신 Wiki·입력물", stages: ["source_package"] },
  { id: "original", order: 2, label: "PDF 원본 8공정", description: "개인 AI·Premiere", stages: ["pc_main_edit"] },
  { id: "handoff", order: 3, label: "완료본 인계", description: "MP4·SRT·자동검증", stages: ["master_upload", "master_validation"] },
  { id: "thumbnail", order: 4, label: "썸네일 폐쇄 루프", description: "아이디어·생성·평가·승인", stages: ["thumbnail_idea", "thumbnail_generate", "thumbnail_evaluate", "thumbnail_approve"] },
  { id: "distribution", order: 5, label: "배포·성과·학습", description: "숏폼·YouTube·CTR", stages: ["shortform_plan", "shortform_render", "publish_package", "youtube_publish", "metrics", "thumbnail_learn"] },
];

function escapeHtml(value) {
  return String(value ?? "-")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function safeExternalUrl(value) {
  try {
    const url = new URL(String(value || ""));
    return url.protocol === "https:" ? url.href : "";
  } catch {
    return "";
  }
}

function youtubeDraftKey(contentId = activeYoutubeContentId, stageId = activeYoutubeStageId) {
  return `ba-os-youtube-draft:${contentId}:${stageId}`;
}

function readYoutubeDraft() {
  try { return JSON.parse(sessionStorage.getItem(youtubeDraftKey()) || "{}"); } catch { return {}; }
}

function saveYoutubeDraft() {
  if (currentView !== "youtube" || !activeYoutubeContentId || !activeYoutubeStageId) return;
  const parameters = {};
  document.querySelectorAll("[data-youtube-param]").forEach((field) => {
    parameters[field.dataset.youtubeParam] = field.type === "checkbox" ? field.checked : field.value;
  });
  const checklist = [...document.querySelectorAll("[data-youtube-check]")].map((field) => field.checked);
  sessionStorage.setItem(youtubeDraftKey(), JSON.stringify({
    inputText: document.querySelector("#youtube-input")?.value || "",
    summary: document.querySelector("#youtube-summary")?.value || "",
    assetUrl: document.querySelector("#youtube-asset-url")?.value || "",
    privacyStatus: document.querySelector("#youtube-privacy-status")?.value || "private",
    publishAt: document.querySelector("#youtube-publish-at")?.value || "",
    parameters,
    checklist,
    assetRefs: { ...youtubeUploadAssets },
  }));
}

function statusLabel(status) {
  return statusLabels[status] || status || "-";
}

function statusBadge(status) {
  return `<span class="status" data-status="${escapeHtml(status)}">${escapeHtml(statusLabel(status))}</span>`;
}

function initials(owner) {
  return String(owner ?? "-").slice(0, 2).toUpperCase();
}

function ownerBadge(owner) {
  return `<span class="owner"><i class="avatar">${escapeHtml(initials(owner))}</i>${escapeHtml(owner)}</span>`;
}

function formatDate(value) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("ko-KR", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

function toDateTimeLocal(value = new Date()) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const offset = date.getTimezoneOffset();
  return new Date(date.getTime() - offset * 60_000).toISOString().slice(0, 16);
}

function meetingIdNow() {
  const now = new Date();
  const parts = [
    now.getFullYear(),
    String(now.getMonth() + 1).padStart(2, "0"),
    String(now.getDate()).padStart(2, "0"),
    String(now.getHours()).padStart(2, "0"),
    String(now.getMinutes()).padStart(2, "0"),
    String(now.getSeconds()).padStart(2, "0"),
  ];
  return `MTG-${parts.slice(0, 3).join("")}-${parts.slice(3).join("")}`;
}

function meetingTemplate() {
  return `## 한 줄 요약


## 핵심 논의

- 논의 내용을 기록하세요.

## 결정사항

- [ ] 결정사항을 기록하세요.

## 액션 아이템

- [ ] 담당자 · 할 일 · 기한

## 보류·추가 확인

- 추가 확인이 필요한 내용을 기록하세요.

## 원문 메모·전사

`;
}

function meetingFolderLabel(folder) {
  return ({ inbox: "회의 Inbox", organized: "정리된 회의록", decisions: "의사결정 기록" })[folder] || folder;
}

function meetingSection(body, heading) {
  const lines = String(body || "").replace(/\r\n/g, "\n").split("\n");
  const start = lines.findIndex((line) => line.trim() === `## ${heading}`);
  if (start < 0) return "";
  const rest = lines.slice(start + 1);
  const end = rest.findIndex((line) => line.startsWith("## "));
  return (end < 0 ? rest : rest.slice(0, end)).join("\n").trim();
}

function meetingSecret() {
  return document.querySelector("#meeting-secret")?.value || sessionStorage.getItem("ba-os-push-secret") || "";
}

function meetingFeedback(message, type = "") {
  const target = document.querySelector("#meeting-feedback");
  if (!target) return;
  target.textContent = message;
  target.className = `meeting-feedback${type ? ` is-${type}` : ""}`;
}

function emptyState(title = "현재 항목이 없습니다", description) {
  return `<section class="empty-state">
    <span>✓</span>
    <h2>${escapeHtml(title)}</h2>
    <p>${escapeHtml(description || "Repository가 갱신되면 이 화면에 자동으로 표시됩니다.")}</p>
  </section>`;
}

function sectionHead(title, description, action = "") {
  return `<header class="section-head"><div><h2>${escapeHtml(title)}</h2><p>${escapeHtml(description)}</p></div>${action}</header>`;
}

function contentRows(contents) {
  return contents.map((content) => `
    <tr data-content-id="${escapeHtml(content.id)}">
      <td><span class="id">${escapeHtml(content.id)}</span></td>
      <td class="title-cell"><strong>${escapeHtml(content.title)}</strong><span>${escapeHtml(content.brandId)} · ${escapeHtml(content.type)}</span></td>
      <td>${statusBadge(content.status)}</td>
      <td>${escapeHtml(content.currentStep)}</td>
      <td>${ownerBadge(content.owner)}</td>
      <td class="next-action">${escapeHtml(content.nextAction)}</td>
      <td>${escapeHtml(formatDate(content.updatedAt))}</td>
    </tr>`).join("");
}

function contentTable(contents) {
  if (!contents.length) return emptyState();
  return `<div class="panel table-wrap"><table class="table">
    <thead><tr><th>ID</th><th>콘텐츠</th><th>상태</th><th>현재 단계</th><th>담당자</th><th>다음 행동</th><th>업데이트</th></tr></thead>
    <tbody>${contentRows(contents)}</tbody>
  </table></div>`;
}

function dominantProcess() {
  return index.processes[0] || { id: "-", steps: [] };
}

function stepState(step, content) {
  if (!content) return "";
  const found = content.steps.find((item) => item.id === step.id);
  if (["approved", "completed"].includes(found?.status)) return "is-done";
  if (step.id === content.currentStep) return "is-current";
  return "";
}

function processFlow(process, content) {
  return `<div class="process-card">
    <div class="process-meta"><strong>${escapeHtml(process.id)} Process</strong><span class="tag">v${escapeHtml(process.version)}</span><span class="tag">${escapeHtml(process.status)}</span></div>
    <div class="process-flow">${process.steps.map((step) => `
      <article class="process-step ${stepState(step, content)}">
        <span class="step-dot">${escapeHtml(step.order)}</span>
        <h3>${escapeHtml(step.label)}</h3>
        <p>${escapeHtml(step.owner)}<br>${escapeHtml(step.type)}</p>
      </article>`).join("")}</div>
  </div>`;
}

function osContextFlow() {
  return `<div class="os-context-flow">
    <article><i>01</i><span>PERSONAL</span><strong>개인 Obsidian</strong><p>Raw와 개인 Wiki를 자유롭게 관리</p></article><b>→</b>
    <article><i>02</i><span>SHARED TRUTH</span><strong>Company Wiki</strong><p>공정에서 사용할 최신 정본만 공유</p></article><b>→</b>
    <article><i>03</i><span>ACCESS</span><strong>OS Access Skill</strong><p>업무에 필요한 Wiki와 데이터 호출</p></article><b>→</b>
    <article><i>04</i><span>EXECUTION</span><strong>각자의 AI</strong><p>불러온 맥락으로 실제 결과물 생성</p></article><b>→</b>
    <article><i>05</i><span>VERSIONED OUTPUT</span><strong>Content Run</strong><p>결과와 상태를 회사 OS에 기록</p></article>
  </div>`;
}

function renderDashboard() {
  const summary = index.summary;
  const lead = index.contents[0];
  const process = dominantProcess();
  app.innerHTML = `
    <section class="hero">
      <div class="hero-copy"><p class="hero-kicker">SHARED CONTEXT OPERATING SYSTEM</p><h2>각자의 맥락을 회사의 실행력으로</h2><p>개인 Obsidian에서 정리한 Wiki를 회사 공정과 연결하고, 각자의 AI가 필요한 최신 맥락을 불러와 일하게 합니다.</p><button class="hero-primary" data-go="youtube">유튜브 제작 관제 열기 →</button></div>
      <div class="hero-side"><strong>${summary.activeCount}</strong><span>현재 진행 중인 Content Run</span></div>
    </section>
    <section class="stat-grid">
      <article class="stat-card"><header><span>진행 중</span><i>→</i></header><strong>${summary.activeCount}</strong><small>완료·보관 제외</small></article>
      <article class="stat-card"><header><span>제작 자동화 Run</span><i>▶</i></header><strong>${summary.automationRunCount || 0}</strong><small>유튜브 공정 연결</small></article>
      <article class="stat-card"><header><span>확인 필요한 예외</span><i>◇</i></header><strong>${summary.automationAttentionCount || 0}</strong><small>사람이 볼 항목만</small></article>
      <article class="stat-card"><header><span>공유 Wiki</span><i>▣</i></header><strong>${summary.wikiCount}</strong><small>회사 OS 최신 정본</small></article>
    </section>
    <section class="section">${sectionHead("OS가 일하는 방식", "개인의 맥락 관리와 회사 공정 실행을 분리하고 최신 Wiki로 연결합니다.")}${osContextFlow()}</section>
    <section class="section">${sectionHead("Longform 전체 공정", "기획부터 성과 회수까지의 표준 공정")}${processFlow(process, lead)}</section>
    <section class="section">${sectionHead("최근 Content Run", "최근 업데이트된 업무부터 표시합니다.", '<button data-go="contents">전체 보기 →</button>')}${contentTable(index.contents.slice(0, 5))}</section>`;
}

function tasksForUser() {
  return index.contents.filter((content) => content.owner === currentUser && !["completed", "archived"].includes(content.status));
}

function automationTasksForUser() {
  return index.contents.flatMap((content) => (content.youtubeAutomation?.stages || [])
    .filter((stage) => stage.owner === currentUser && ["ready", "needs_input", "needs_decision", "failed", "blocked"].includes(stage.status))
    .map((stage) => ({ content, stage })));
}

function renderTasks() {
  const tasks = tasksForUser();
  const automationTasks = automationTasksForUser();
  app.innerHTML = `${sectionHead(`${currentUser}의 할 일`, "Content Run과 Automation Stage에서 지금 행동 가능한 업무만 표시합니다.")}
    ${automationTasks.length ? `<div class="automation-task-list">${automationTasks.map(({ content, stage }) => `
      <button class="automation-task" data-youtube-task="${escapeHtml(content.id)}" data-youtube-stage="${escapeHtml(stage.id)}">
        <span class="automation-task-status" data-status="${escapeHtml(stage.status)}">${escapeHtml(statusLabel(stage.status))}</span>
        <div><small>${escapeHtml(content.id)} · 유튜브 제작</small><strong>${escapeHtml(stage.label)}</strong><p>${escapeHtml(stage.description)}</p></div>
        <i>작업 열기 →</i>
      </button>`).join("")}</div>` : ""}
    ${tasks.length ? `<div class="task-list">${tasks.map((content) => `
      <article class="task-card" data-content-id="${escapeHtml(content.id)}">
        <span class="task-number">${escapeHtml(content.id.replace("BA-", ""))}</span>
        <div><h3>${escapeHtml(content.nextAction)}</h3><p>${escapeHtml(content.title)} · ${escapeHtml(content.currentStep)}</p></div>
        <time>${escapeHtml(formatDate(content.updatedAt))}</time>
      </article>`).join("")}</div>` : ""}
    ${!tasks.length && !automationTasks.length ? emptyState("배정된 업무가 없습니다", `${currentUser} 담당으로 지정된 진행 업무가 없습니다.`) : ""}`;
}

function renderContents() {
  app.innerHTML = `${sectionHead("전체 Content Run", "콘텐츠의 현재 상태, 담당자, 다음 행동을 확인합니다.")}${contentTable(index.contents)}`;
}

function youtubeRuns() {
  return index.contents.filter((content) => content.youtubeAutomation);
}

function selectedYoutubeContent() {
  const runs = youtubeRuns();
  if (!runs.length) return null;
  const selected = runs.find((content) => content.id === activeYoutubeContentId) || runs[0];
  activeYoutubeContentId = selected.id;
  localStorage.setItem("ba-os-youtube-content", selected.id);
  return selected;
}

function connectorKeyForStage(stage) {
  return ({
    openai: "openai",
    thumbnail_worker: "thumbnail",
    asset_upload: "asset",
    render_worker: "render",
    youtube: "youtube",
    youtube_data: "metrics",
  })[stage.provider] || "human";
}

function updateSessionStatus() {
  if (!sessionStatusButton) return;
  sessionStatusButton.classList.toggle("is-ready", workSession.authenticated);
  sessionStatusButton.querySelector("span").textContent = workSession.authenticated ? `${workSession.actor || "팀"} · 작업 연결됨` : "작업 권한 연결";
}

function openSessionModal() {
  sessionBackdrop.hidden = false;
  sessionModal.classList.add("is-open");
  sessionModal.setAttribute("aria-hidden", "false");
  sessionFeedback.textContent = "";
  sessionFeedback.className = "submit-feedback";
  setTimeout(() => document.querySelector("#session-code")?.focus(), 30);
}

function closeSessionModal() {
  sessionModal.classList.remove("is-open");
  sessionModal.setAttribute("aria-hidden", "true");
  setTimeout(() => { sessionBackdrop.hidden = true; }, 180);
}

async function refreshWorkSession() {
  try {
    const response = await fetch("/api/session", { cache: "no-store", credentials: "same-origin" });
    const result = await response.json().catch(() => ({}));
    workSession = response.ok && result.authenticated ? result : { authenticated: false, actor: null, expiresAt: null };
  } catch {
    workSession = { authenticated: false, actor: null, expiresAt: null };
  }
  updateSessionStatus();
  return workSession.authenticated;
}

async function connectWorkSession(event) {
  event.preventDefault();
  const code = document.querySelector("#session-code")?.value || "";
  const button = sessionForm.querySelector("button[type=submit]");
  if (!code) return;
  button.disabled = true;
  sessionFeedback.textContent = "작업 권한을 확인하고 있습니다…";
  sessionFeedback.className = "submit-feedback is-loading";
  try {
    const response = await fetch("/api/session", {
      method: "POST",
      credentials: "same-origin",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ code, actor: currentUser }),
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(result.error || "작업 권한을 연결하지 못했습니다.");
    workSession = result;
    document.querySelector("#session-code").value = "";
    updateSessionStatus();
    closeSessionModal();
    const action = pendingYoutubeAction;
    pendingYoutubeAction = null;
    if (action) runYoutubeAction(action);
  } catch (error) {
    sessionFeedback.textContent = error.message;
    sessionFeedback.className = "submit-feedback is-error";
  } finally {
    button.disabled = false;
  }
}

function connectorForStage(stage) {
  const key = connectorKeyForStage(stage);
  if (key === "human") return { ready: true, label: "사람 작업", mode: "OS 확인" };
  return automationConnectors[key] || { ready: false, label: stage.provider, mode: "연결 확인 중" };
}

function youtubeStageActions(stage, connector) {
  if (stage.id === "metrics" && stage.status === "completed") return connector.ready
    ? `<button class="youtube-action-button" data-youtube-action="run">↻ 최신 성과 다시 수집</button>`
    : `<span class="youtube-stage-complete">✓ 최신 수집 완료 · Worker 미연결</span>`;
  if (stage.status === "completed") return `<span class="youtube-stage-complete">✓ 이 단계 완료</span>`;
  if (stage.status === "locked") return `<button class="youtube-action-button" disabled>선행 단계 완료 후 열림</button>`;
  if (["queued", "running"].includes(stage.status)) return `<button class="youtube-action-button" disabled>${stage.status === "queued" ? "Worker 실행 대기 중" : "Worker 실행 중"}</button>`;
  if (stage.status === "needs_decision") return `
    <button class="youtube-action-button is-decision" data-youtube-action="approve">${stage.id === "youtube_publish" ? "게시 설정 승인 · 업로드 실행" : stage.id === "shortform_plan" ? "숏폼 후보 확정" : stage.id === "thumbnail_idea" ? "아이디어 Brief 확정" : "게시 문안 확정"}</button>
    <button class="youtube-action-button is-secondary" data-youtube-action="revise">수정 후 다시 실행</button>`;
  if (["failed", "blocked", "needs_input"].includes(stage.status)) return `
    <button class="youtube-action-button is-retry" data-youtube-action="retry">다시 실행 준비</button>
    <button class="youtube-action-button is-secondary" data-youtube-action="complete">수동 결과로 완료</button>`;
  if (stage.id === "source_package") return `<button class="youtube-action-button" data-youtube-action="complete">작업 준비 완료</button>`;
  if (stage.id === "pc_main_edit") return `<button class="youtube-action-button" data-youtube-action="complete">PC 편집 완료 · 마스터 접수로</button>`;
  if (stage.id === "master_upload") return `<button class="youtube-action-button" data-youtube-action="complete">완료본 등록</button>`;
  if (stage.id === "thumbnail_approve") return `<button class="youtube-action-button is-decision" data-youtube-action="complete">최종 썸네일 승인</button>`;
  if (stage.provider === "human") return `<button class="youtube-action-button" data-youtube-action="complete">완료 기록</button>`;
  if (stage.provider === "openai") return connector.ready
    ? `<button class="youtube-action-button" data-youtube-action="run">${escapeHtml(stage.ui?.primaryAction || "AI 실행")}</button>`
    : `<button class="youtube-action-button is-secondary" data-youtube-action="complete">수동 결과로 완료</button>`;
  if (stage.provider === "youtube") return connector.ready
    ? `<button class="youtube-action-button" data-youtube-action="run">게시 설정 검토 시작</button>`
    : `<button class="youtube-action-button is-secondary" data-youtube-action="complete">수동 게시 결과 등록</button>`;
  if (connector.ready) return `<button class="youtube-action-button" data-youtube-action="run">${escapeHtml(stage.ui?.primaryAction || `${connector.mode} 실행`)}</button>`;
  return `<button class="youtube-action-button is-secondary" data-youtube-action="complete">수동 산출물 연결 · 완료</button>`;
}

const YOUTUBE_OPTION_LABELS = {
  "20-30": "20~30초", "30-45": "30~45초", "45-60": "45~60초",
  youtube_shorts: "YouTube Shorts", instagram_reels: "Instagram Reels", both: "Shorts + Reels",
  brand_default: "브랜드 기본", keyword_emphasis: "키워드 강조", minimal: "미니멀",
  smart_crop: "화자 자동 추적", speaker_center: "화자 중앙 고정", split_layout: "상·하 분할",
  korean_subject: "한국인 피사체", no_face: "인물 없음", source_face: "원본 화자 활용",
};

function youtubeFieldValue(stage, draft, field) {
  const stored = draft.parameters?.[field.key] ?? stage.parameters?.[field.key];
  return stored === undefined || stored === null ? field.default : stored;
}

function renderYoutubeParameterField(stage, draft, field) {
  const value = youtubeFieldValue(stage, draft, field);
  if (field.type === "checkbox") return `<label class="youtube-toggle-field"><input type="checkbox" data-youtube-param="${escapeHtml(field.key)}" ${value === true || value === "true" ? "checked" : ""} /><span><strong>${escapeHtml(field.label)}</strong><small>${value === true || value === "true" ? "사용" : "선택"}</small></span></label>`;
  if (field.type === "select") return `<label class="youtube-field"><span>${escapeHtml(field.label)}</span><select data-youtube-param="${escapeHtml(field.key)}">${(field.options || []).map((option) => `<option value="${escapeHtml(option)}" ${String(option) === String(value) ? "selected" : ""}>${escapeHtml(YOUTUBE_OPTION_LABELS[option] || option)}</option>`).join("")}</select></label>`;
  if (field.type === "textarea") return `<label class="youtube-field youtube-field-wide"><span>${escapeHtml(field.label)}</span><textarea data-youtube-param="${escapeHtml(field.key)}" rows="3">${escapeHtml(value || "")}</textarea></label>`;
  return `<label class="youtube-field"><span>${escapeHtml(field.label)}${field.suffix ? ` <small>${escapeHtml(field.suffix)}</small>` : ""}</span><input data-youtube-param="${escapeHtml(field.key)}" type="${field.type === "number" ? "number" : "text"}" value="${escapeHtml(value ?? "")}" ${field.min !== undefined ? `min="${field.min}"` : ""} ${field.max !== undefined ? `max="${field.max}"` : ""} /></label>`;
}

function renderCanonicalPdfProcess(draft) {
  const process = index.youtubePipeline?.originalProcess;
  if (!process?.steps?.length) return "";
  const steps = process.steps.map((item, indexValue) => `
    <label class="youtube-canonical-step">
      <input type="checkbox" data-youtube-check="${indexValue}" ${draft.checklist?.[indexValue] ? "checked" : ""} />
      <i>${String(item.order).padStart(2, "0")}</i>
      <div><header><strong>${escapeHtml(item.label)}</strong><em>${escapeHtml(item.tool)}</em></header><p>${escapeHtml(item.description)}</p><small><b>OUT</b>${escapeHtml(item.output)}</small></div>
    </label>`).join("");
  const rules = (process.absoluteRules || []).map((rule) => `<li><i>✓</i><span>${escapeHtml(rule)}</span></li>`).join("");
  return `<section class="youtube-canonical-panel">
    <header><div><span>UPLOADED PDF · CANONICAL PROCESS</span><strong>${escapeHtml(process.title)}</strong><p>${escapeHtml(process.subtitle)}</p></div><em>8개 공정 · 축약 없음</em></header>
    <div class="youtube-canonical-io"><article><span>INPUT · ${process.inputs.length}</span>${process.inputs.map((item) => `<strong>${escapeHtml(item)}</strong>`).join("")}</article><b>→</b><article><span>OUTPUT · ${process.outputs.length}</span>${process.outputs.map((item) => `<strong>${escapeHtml(item)}</strong>`).join("")}</article></div>
    <div class="youtube-canonical-steps">${steps}</div>
    <section class="youtube-absolute-rules"><header><span>ABSOLUTE RULES</span><strong>PDF 절대 규칙 ${process.absoluteRules?.length || 0}개</strong></header><ul>${rules}</ul></section>
  </section>`;
}

function renderThumbnailScorecard() {
  const scorecard = index.youtubePipeline?.thumbnailLoop?.scorecard;
  if (!scorecard) return "";
  const visual = scorecard.visual.map((item) => `<li><span>${escapeHtml(item)}</span><i>1</i><i>2</i><i>3</i><i>4</i></li>`).join("");
  const fit = scorecard.contentFit.map((item) => `<li><span>${escapeHtml(item)}</span><i>1</i><i>2</i><i>3</i><i>4</i></li>`).join("");
  return `<section class="thumbnail-scorecard"><header><div><span>AI CRITIQUE SCORECARD</span><strong>총점보다 근거와 개선 우선순위</strong></div><em>${escapeHtml(scorecard.scale)}</em></header><div><article><h4>시각 품질</h4><ul>${visual}</ul></article><article><h4>콘텐츠 적합성</h4><ul>${fit}</ul></article></div><p>${escapeHtml(scorecard.decisionRule)}</p></section>`;
}

function renderThumbnailLoop(stages, selectedStage) {
  const loop = index.youtubePipeline?.thumbnailLoop;
  if (!loop?.steps?.length) return "";
  const referenceUrl = safeExternalUrl(loop.referenceUrl);
  const nodes = loop.steps.map((step) => {
    const stage = stages.find((item) => item.id === step.stageId);
    const status = stage?.status || "locked";
    const isActive = selectedStage?.id === step.stageId;
    return `<button class="thumbnail-loop-node ${isActive ? "is-active" : ""}" data-youtube-stage="${escapeHtml(step.stageId)}" data-status="${escapeHtml(status)}"><i>${status === "completed" ? "✓" : step.order}</i><span><strong>${escapeHtml(step.label)}</strong><small>${escapeHtml(step.output)}</small></span><em>${escapeHtml(statusLabel(status))}</em></button>`;
  }).join('<b class="thumbnail-loop-arrow">→</b>');
  return `<section class="thumbnail-loop"><header><div><span>THUMBNAIL CLOSED LOOP</span><h3>${escapeHtml(loop.label)}</h3><p>제작 완료가 끝이 아니라 실제 CTR 학습이 다음 아이디어로 돌아옵니다.</p></div>${referenceUrl ? `<a href="${escapeHtml(referenceUrl)}" target="_blank" rel="noreferrer">평가 참고 화면 ↗</a>` : ""}</header><div class="thumbnail-loop-track">${nodes}<b class="thumbnail-loop-return">↳ 학습 결과가 다음 아이디어 Context로 자동 연결</b></div></section>`;
}

function renderYoutubeStageSpecific(stage, draft, content, connector) {
  const mode = stage.ui?.mode || "default";
  if (mode === "work_package") return `
    <section class="youtube-pc-card"><div><span>최신 맥락 묶음</span><strong>${escapeHtml(content.id)} 작업 패키지</strong><p>승인 원고·촬영 포인터·최신 Wiki·Access Skill을 한 파일로 받습니다.</p></div><a class="youtube-download-button" href="${escapeHtml(content.workPackageUrl || "#")}" download="${escapeHtml(content.id)}_WORK_PACKAGE.md">↓ 작업 패키지 받기</a></section>`;
  if (mode === "canonical_process") return renderCanonicalPdfProcess(draft);
  if (mode === "local_checklist") {
    const checks = stage.ui?.checklist || [];
    return `<section class="youtube-local-panel"><header><div><span>개인 PC에서 완료</span><strong>메인 편집 체크리스트</strong></div><em>서버 토큰 사용 없음</em></header><div class="youtube-local-checklist">${checks.map((item, indexValue) => `<label><input type="checkbox" data-youtube-check="${indexValue}" ${draft.checklist?.[indexValue] ? "checked" : ""} /><i>${String(indexValue + 1).padStart(2, "0")}</i><span>${escapeHtml(item)}</span></label>`).join("")}</div><details class="youtube-technical-details"><summary>PDF 기술 작업 상세</summary><p>자막 → 요약 덱 → 사진 → 1920×1080 렌더 → CTA → 오디오 → XML → Premiere 최종 MP4 순서입니다. 실제 파일과 개인 AI 토큰은 PC 밖으로 보내지 않습니다.</p></details></section>`;
  }
  if (mode === "master_upload") {
    const previousAssets = { ...(stage.parameters?.assets || {}), ...(draft.assetRefs || {}) };
    const fileCards = [
      { kind: "master", label: "최종 MP4", accept: "video/mp4,.mp4", required: true },
      { kind: "subtitle", label: "최종 SRT", accept: ".srt,text/plain", required: true },
    ];
    return `<section class="youtube-upload-panel"><header><div><span>DIRECT ASSET UPLOAD</span><strong>완료본 MP4·SRT만 인계</strong><p>썸네일은 다음 폐쇄 루프에서 별도로 생성·평가·승인합니다.</p></div><i class="connector-light ${connector.ready ? "is-ready" : ""}">${connector.ready ? "업로드 연결됨" : "저장소 연결 필요"}</i></header><div class="youtube-upload-grid">${fileCards.map((item) => `<article class="youtube-upload-card"><span>${item.required ? "필수" : "선택"}</span><strong>${escapeHtml(item.label)}</strong><label>파일 선택<input type="file" data-youtube-upload="${item.kind}" accept="${item.accept}" /></label><small data-youtube-file-name="${item.kind}">선택된 파일 없음</small><input data-youtube-asset-ref="${item.kind}" type="text" placeholder="asset://... 직접 입력" value="${escapeHtml(previousAssets[item.kind] || "")}" /></article>`).join("")}</div><div class="youtube-upload-progress" id="youtube-upload-progress" hidden><span><i></i></span><small>업로드 준비 중</small></div><p class="youtube-upload-note">저장소가 연결되기 전에는 업로드된 자산의 <code>asset://</code> ID를 직접 입력할 수 있습니다.</p></section>`;
  }
  if (mode === "worker_validation") return `<section class="youtube-validation-preview"><article><span>VIDEO</span><strong>해상도·FPS·길이</strong><small>FFprobe 검사</small></article><article><span>AUDIO</span><strong>트랙·음량</strong><small>재생 오류 검사</small></article><article><span>SUBTITLE</span><strong>타임코드 범위</strong><small>SRT 일치 검사</small></article></section>`;
  if (mode === "thumbnail_evaluate") return renderThumbnailScorecard();
  if (mode === "metrics") return `<section class="youtube-metrics-preview"><article><span>썸네일 노출</span><strong>—</strong><small>1h·6h·24h·7d</small></article><article><span>CTR</span><strong>—</strong><small>교체 시점 분리</small></article><article><span>롱폼 조회</span><strong>—</strong><small>YouTube Analytics 연결 후 표시</small></article><article><span>숏폼 조회</span><strong>—</strong><small>클립별 비교</small></article></section>`;
  if (mode === "thumbnail_learn") return `<section class="thumbnail-learning-preview"><i>01</i><div><strong>AI 예상</strong><span>가설·사전 점수</span></div><b>↔</b><i>02</i><div><strong>실제 성과</strong><span>노출·CTR 스냅샷</span></div><b>→</b><i>03</i><div><strong>다음 가설</strong><span>재사용·폐기 규칙</span></div></section>`;
  const fields = stage.ui?.fields || [];
  if (!fields.length) return "";
  return `<section class="youtube-stage-form"><header><span>${escapeHtml(stage.ui?.eyebrow || "STAGE SETTINGS")}</span><strong>${escapeHtml(stage.ui?.helper || "이 공정에 필요한 설정만 입력합니다.")}</strong></header><div class="youtube-stage-form-grid">${fields.map((field) => renderYoutubeParameterField(stage, draft, field)).join("")}</div></section>`;
}

function youtubeDisplayGroupForStage(stageId) {
  return YOUTUBE_DISPLAY_GROUPS.find((group) => group.stages.includes(stageId)) || YOUTUBE_DISPLAY_GROUPS[0];
}

function youtubeStageForGroup(group, stages) {
  const groupStages = group.stages.map((id) => stages.find((stage) => stage.id === id)).filter(Boolean);
  return groupStages.find((stage) => ["ready", "needs_input", "needs_decision", "failed", "blocked", "queued", "running"].includes(stage.status)) || groupStages.at(-1);
}

function renderYoutube() {
  const content = selectedYoutubeContent();
  if (!content) {
    app.innerHTML = `${emptyState("유튜브 제작 Run이 없습니다", "Longform Content Run을 만들면 실제 제작 파이프라인이 연결됩니다.")}<button class="primary-action empty-state-action" data-go="contents">콘텐츠 Run으로 이동</button>`;
    return;
  }
  const automation = content.youtubeAutomation;
  const stages = automation.stages || [];
  const selectedStage = stages.find((stage) => stage.id === activeYoutubeStageId)
    || stages.find((stage) => stage.id === automation.currentStageId)
    || stages.find((stage) => ["ready", "needs_decision", "failed"].includes(stage.status))
    || stages[0];
  activeYoutubeStageId = selectedStage.id;
  localStorage.setItem("ba-os-youtube-stage", selectedStage.id);
  const draft = readYoutubeDraft();
  const lastOutput = youtubeLastOutput?.contentId === content.id && youtubeLastOutput?.stageId === selectedStage.id ? youtubeLastOutput.text : "";
  const connector = connectorForStage(selectedStage);
  const readyCount = stages.filter((stage) => stage.status === "ready").length;
  const activeCount = stages.filter((stage) => ["queued", "running"].includes(stage.status)).length;
  const decisionCount = stages.filter((stage) => ["needs_decision", "needs_input", "failed", "blocked"].includes(stage.status)).length;
  const questions = automation.questions || [];
  const jobs = (automation.jobs || []).slice(-5).reverse();
  const outputLink = selectedStage.outputPath ? `https://github.com/brandyaction-ricky/OS/blob/main/${selectedStage.outputPath}` : "";
  const assetLink = safeExternalUrl(selectedStage.assetUrl);
  const sourceLabel = selectedStage.source === "pdf" ? "실제 PDF 공정" : selectedStage.executionBoundary === "personal_pc" ? "개인 PC 공정" : "서버 공정";
  const sourceDescription = selectedStage.source === "pdf"
    ? "업로드한 브랜디액션 제작공정 체크리스트"
    : selectedStage.executionBoundary === "personal_pc" ? "개인 PC에서 실행하고 OS에는 완료 상태만 기록" : "완료본 이후 회사 서버 실행";
  const stageRail = YOUTUBE_DISPLAY_GROUPS.map((group) => {
    const groupStages = group.stages.map((id) => stages.find((stage) => stage.id === id)).filter(Boolean);
    if (!groupStages.length) return "";
    return `<section class="youtube-phase ${groupStages.some((stage) => stage.id === selectedStage.id) ? "is-active" : ""}"><header><span>${String(group.order).padStart(2, "0")}</span><div><strong>${escapeHtml(group.label)}</strong><small>${escapeHtml(group.description)}</small></div></header><div class="youtube-substage-tabs is-always">${groupStages.map((stage) => `<button class="${stage.id === selectedStage.id ? "is-active" : ""}" data-youtube-stage="${escapeHtml(stage.id)}"><i data-status="${escapeHtml(stage.status)}"></i><span>${escapeHtml(stage.shortLabel)}</span><em>${escapeHtml(statusLabel(stage.status))}</em></button>`).join("")}</div></section>`;
  }).join("");
  const connectors = ["asset", "openai", "thumbnail", "render", "youtube", "metrics"].map((key) => {
    const item = automationConnectors[key] || { ready: false, label: key, mode: "연결 확인 중" };
    return `<article class="integration-mini ${item.ready ? "is-ready" : ""}"><i></i><span><strong>${escapeHtml(item.label)}</strong><small>${escapeHtml(item.ready ? `${item.mode} 설정됨` : item.fallback || "연결 필요")}</small></span></article>`;
  }).join("");
  const selectedPrivacy = draft.privacyStatus || selectedStage.publishSettings?.privacyStatus || "private";
  const selectedPublishAt = draft.publishAt || (selectedStage.publishSettings?.publishAt ? toDateTimeLocal(selectedStage.publishSettings.publishAt) : "");
  const publishSettings = selectedStage.id === "youtube_publish" ? `
    <div class="youtube-input-grid youtube-publish-settings">
      <label class="youtube-field"><span>공개 상태</span><select id="youtube-privacy-status"><option value="private" ${selectedPrivacy === "private" ? "selected" : ""}>비공개 업로드</option><option value="unlisted" ${selectedPrivacy === "unlisted" ? "selected" : ""}>일부 공개</option><option value="public" ${selectedPrivacy === "public" ? "selected" : ""}>공개</option></select></label>
      <label class="youtube-field"><span>예약 시각 <small>선택</small></span><input id="youtube-publish-at" type="datetime-local" value="${escapeHtml(selectedPublishAt)}" /></label>
    </div>` : "";
  const publishApproval = selectedStage.id === "youtube_publish" && selectedStage.status === "needs_decision" ? `
    <label class="youtube-field is-secret"><span>YouTube 게시 승인 코드</span><input id="youtube-publish-approval-secret" type="password" autocomplete="off" placeholder="게시 권한자 전용 코드" /><small>공용 OS 작업 코드와 분리된 게시 전용 승인입니다.</small></label>` : "";
  const stageSpecific = renderYoutubeStageSpecific(selectedStage, draft, content, connector);
  const manualAssetConfig = selectedStage.id === "thumbnail_approve"
    ? { label: "승인할 썸네일 Asset ID", placeholder: "asset://longform/BA-0268/thumbnails/candidate-a.png", value: "" }
    : !connector.ready && selectedStage.id === "thumbnail_generate"
      ? { label: "수동 후보 Manifest Asset ID", placeholder: "asset://longform/BA-0268/thumbnails/manifest.json", value: "" }
      : !connector.ready && selectedStage.id === "shortform_render"
        ? { label: "수동 숏폼 Asset ID", placeholder: "asset://longform/BA-0268/shorts/manifest.json", value: "" }
        : !connector.ready && selectedStage.id === "youtube_publish"
          ? { label: "게시된 YouTube URL", placeholder: "https://youtube.com/watch?v=...", value: "" }
          : null;
  const manualAssetField = manualAssetConfig ? `<label class="youtube-field"><span>${escapeHtml(manualAssetConfig.label)}</span><input id="youtube-asset-url" type="text" maxlength="2000" placeholder="${escapeHtml(manualAssetConfig.placeholder)}" value="${escapeHtml(draft.assetUrl || selectedStage.assetUrl || manualAssetConfig.value || "")}" /></label>` : "";
  const qualityConfirmation = ["canonical_process", "local_checklist"].includes(selectedStage.ui?.mode) ? "" : `<label class="youtube-quality-confirm"><input id="youtube-quality-confirm" type="checkbox" /><span>완료 기준과 연결된 결과를 직접 확인했습니다.</span></label>`;
  const activity = jobs.length ? jobs.map((job) => `<li><i data-status="${escapeHtml(job.status)}"></i><span><strong>${escapeHtml(stages.find((stage) => stage.id === job.stageId)?.label || job.stageId)}</strong><small>${escapeHtml(job.provider)} · ${escapeHtml(formatDate(job.updatedAt || job.createdAt))}</small></span><em>${escapeHtml(statusLabel(job.status))}</em></li>`).join("") : `<li class="is-empty">아직 실행 로그가 없습니다.</li>`;

  app.innerHTML = `
    <section class="youtube-hero">
      <div class="youtube-hero-copy"><p>ORIGINAL PROCESS · CLOSED LOOP</p><h2>유튜브 전체 제작공정</h2><span>업로드한 PDF 8공정을 그대로 유지하고, 완료본 이후 썸네일·숏폼·게시·성과 학습을 연결합니다.</span></div>
      <label class="youtube-run-select"><span>Content Run</span><select id="youtube-content-select">${youtubeRuns().map((run) => `<option value="${escapeHtml(run.id)}" ${run.id === content.id ? "selected" : ""}>${escapeHtml(run.id)} · ${escapeHtml(run.title)}</option>`).join("")}</select></label>
      <button class="youtube-refresh" id="youtube-refresh" type="button">↻ 최신 상태</button>
      <div class="youtube-progress"><strong>${automation.progress}%</strong><span><i style="width:${automation.progress}%"></i></span><small>${automation.completedCount}/${automation.totalCount} 단계 완료</small></div>
    </section>
    <section class="youtube-summary-strip">
      <article><span>지금 할 작업</span><strong>${readyCount}</strong><small>현재 열려 있는 공정</small></article>
      <article><span>자동화 실행 중</span><strong>${activeCount}</strong><small>API·Worker Queue</small></article>
      <article class="${decisionCount ? "is-alert" : ""}"><span>확인·예외</span><strong>${decisionCount}</strong><small>사람이 볼 항목만</small></article>
      <article><span>현재 담당</span><strong>${escapeHtml(selectedStage.owner)}</strong><small>${escapeHtml(selectedStage.shortLabel)}</small></article>
    </section>
    <section class="youtube-source-note"><strong>공정 원칙</strong><span>상위 구분은 탐색용이며 원본 공정을 대체하지 않습니다.</span><i>PDF 8공정 + 실행 Stage ${stages.length}개 전체 표시</i></section>
    ${renderThumbnailLoop(stages, selectedStage)}
    <div class="youtube-workspace">
      <aside class="youtube-stage-rail"><header><strong>전체 실행 공정</strong><span>${stages.length}개 Stage · 축약 없음</span></header>${stageRail}</aside>
      <main class="youtube-stage-workbench">
        <header class="youtube-stage-head">
          <div><span class="youtube-source-badge ${selectedStage.source === "pdf" ? "is-pdf" : ""}">${escapeHtml(sourceLabel)}</span><p>${escapeHtml(sourceDescription)}</p><h2>${escapeHtml(selectedStage.label)}</h2><strong>${escapeHtml(selectedStage.description)}</strong></div>
          <div class="youtube-stage-state"><span data-status="${escapeHtml(selectedStage.status)}">${escapeHtml(statusLabel(selectedStage.status))}</span><small>${escapeHtml(selectedStage.automationLevel)}</small></div>
        </header>
        <section class="youtube-execution-box">
          <header><div><span>${escapeHtml(selectedStage.ui?.eyebrow || "CURRENT TASK")}</span><strong>${escapeHtml(selectedStage.ui?.helper || selectedStage.description)}</strong><p>${selectedStage.executionBoundary === "personal_pc" ? "이 단계는 회사 서버 비용을 사용하지 않습니다." : connector.ready ? `${connector.mode} 연결이 준비됐습니다.` : `${connector.label} 연결 전이며 수동 결과 등록을 사용할 수 있습니다.`}</p></div><i class="connector-light ${connector.ready ? "is-ready" : ""}">${selectedStage.executionBoundary === "personal_pc" ? "PC 작업" : connector.ready ? "설정됨" : "연결 필요"}</i></header>
          ${stageSpecific}
          ${publishSettings}
          ${publishApproval}
          ${manualAssetField}
          <label class="youtube-field youtube-field-wide youtube-stage-note"><span>작업 메모 <small>결정 근거·수동 결과</small></span><textarea id="youtube-summary" rows="3" maxlength="20000" placeholder="결정값·예외·다음 담당자에게 남길 내용만 적으세요.">${escapeHtml(draft.summary || "")}</textarea></label>
          ${selectedStage.error ? `<div class="youtube-stage-error"><strong>최근 오류</strong><span>${escapeHtml(selectedStage.error)}</span><small>${escapeHtml(formatDate(selectedStage.stageUpdatedAt))}</small></div>` : ""}
          ${qualityConfirmation}
          <div class="youtube-action-row">${youtubeStageActions(selectedStage, connector)}</div>
          <div class="youtube-feedback" id="youtube-feedback" role="status"></div>
          ${lastOutput ? `<details class="youtube-output-preview" open><summary>이번 실행 결과 미리보기</summary><pre>${escapeHtml(lastOutput)}</pre></details>` : ""}
          ${outputLink ? `<div class="youtube-output-links"><a href="${escapeHtml(outputLink)}" target="_blank" rel="noreferrer">최신 Markdown 결과 보기 ↗</a>${assetLink ? `<a href="${escapeHtml(assetLink)}" target="_blank" rel="noreferrer">공개 산출물 열기 ↗</a>` : ""}</div>` : ""}
        </section>
        <section class="youtube-quality"><header><span>COMPLETION CRITERIA</span><h3>이 공정의 완료 기준</h3></header><ul>${selectedStage.qualityChecks.map((check) => `<li><i>○</i>${escapeHtml(check)}</li>`).join("")}</ul></section>
        <details class="youtube-process-details"><summary>공정 세부정보 · Context · 연결 상태 · 실행 이력</summary><div class="youtube-details-grid"><section><header><span>INPUT → OUTPUT</span><strong>산출물 계약</strong></header><div class="youtube-stage-contract"><article><span>INPUT</span><div>${selectedStage.inputKeys.map((item) => `<i>${escapeHtml(item)}</i>`).join("")}</div></article><b>→</b><article><span>OUTPUT</span><div>${selectedStage.outputs.map((item) => `<i>${escapeHtml(item)}</i>`).join("")}</div></article></div></section><section><header><span>INTEGRATIONS</span><strong>서버 연결 현황</strong></header><div class="integration-mini-list">${connectors}</div></section><section><header><span>ATTENTION</span><strong>확인 필요한 예외</strong></header>${questions.length ? `<ul class="youtube-question-list">${questions.map((question) => `<li><strong>${escapeHtml(question.question || question.stageId)}</strong><span>${escapeHtml(question.status || "대기")}</span></li>`).join("")}</ul>` : `<p class="youtube-none">현재 등록된 질문이 없습니다.</p>`}</section><section><header><span>ACTIVITY</span><strong>최근 자동화 실행</strong></header><ul class="youtube-job-list">${activity}</ul></section></div></details>
      </main>
    </div>`;
  document.querySelector(`[data-youtube-stage="${selectedStage.id}"]`)?.setAttribute("aria-current", "step");
  clearTimeout(youtubePollTimer);
  if (stages.some((stage) => ["queued", "running"].includes(stage.status))) {
    youtubePollTimer = setTimeout(() => refreshYoutubeState(true), 8_000);
  }
}

function updateYoutubeState(content, state) {
  const automation = content.youtubeAutomation;
  automation.status = state.status;
  automation.currentStageId = state.currentStageId;
  automation.updatedAt = state.updatedAt;
  automation.updatedBy = state.updatedBy;
  automation.questions = state.questions || [];
  automation.jobs = state.jobs || [];
  automation.stages.forEach((stage) => Object.assign(stage, state.stages?.[stage.id] || {}));
  automation.completedCount = automation.stages.filter((stage) => stage.status === "completed").length;
  automation.attentionCount = automation.stages.filter((stage) => ["needs_input", "needs_decision", "blocked", "failed"].includes(stage.status)).length;
  automation.progress = Math.round((automation.completedCount / automation.totalCount) * 100);
}

async function refreshYoutubeState(silent = false) {
  const content = selectedYoutubeContent();
  if (!content) return;
  const feedback = document.querySelector("#youtube-feedback");
  if (!silent && feedback) { feedback.textContent = "GitHub의 최신 실행 상태를 확인하고 있습니다…"; feedback.className = "youtube-feedback is-loading"; }
  try {
    const response = await fetch(`/api/automation?contentId=${encodeURIComponent(content.id)}`, { cache: "no-store" });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(result.error || "최신 상태를 읽지 못했습니다.");
    if (result.state) updateYoutubeState(content, result.state);
    if (currentView === "youtube") renderYoutube();
  } catch (error) {
    if (!silent && feedback) { feedback.textContent = error.message; feedback.className = "youtube-feedback is-error"; }
    if (silent && currentView === "youtube") youtubePollTimer = setTimeout(() => refreshYoutubeState(true), 15_000);
  }
}

async function uploadYoutubeMasterAssets(content) {
  const refs = { ...youtubeUploadAssets };
  document.querySelectorAll("[data-youtube-asset-ref]").forEach((field) => {
    const value = field.value.trim();
    if (value) refs[field.dataset.youtubeAssetRef] = value;
  });
  const files = [...document.querySelectorAll("[data-youtube-upload]")].map((input) => ({ kind: input.dataset.youtubeUpload, file: input.files?.[0] })).filter((item) => item.file);
  if (files.length && !automationConnectors.asset?.ready) throw new Error("완료본 저장소 연결 전입니다. 자산 서비스 연결 후 파일을 올리거나 기존 asset:// ID를 입력해주세요.");
  const progress = document.querySelector("#youtube-upload-progress");
  if (progress && files.length) progress.hidden = false;
  for (let indexValue = 0; indexValue < files.length; indexValue += 1) {
    const { kind, file } = files[indexValue];
    if (progress) {
      progress.querySelector("i").style.width = `${Math.round((indexValue / files.length) * 100)}%`;
      progress.querySelector("small").textContent = `${file.name} 업로드 준비 중`;
    }
    const sessionResponse = await fetch("/api/assets", {
      method: "POST", credentials: "same-origin", headers: { "content-type": "application/json" },
      body: JSON.stringify({ contentId: content.id, kind, fileName: file.name, size: file.size, contentType: file.type || "application/octet-stream" }),
    });
    const session = await sessionResponse.json().catch(() => ({}));
    if (!sessionResponse.ok) throw new Error(session.error || `${file.name} 업로드를 준비하지 못했습니다.`);
    const uploadResponse = await fetch(session.uploadUrl, { method: "PUT", headers: session.headers || {}, body: file });
    if (!uploadResponse.ok) throw new Error(`${file.name} 업로드가 중단됐습니다. 다시 시도해주세요.`);
    refs[kind] = session.assetId;
    const assetField = document.querySelector(`[data-youtube-asset-ref="${kind}"]`);
    if (assetField) assetField.value = session.assetId;
  }
  if (progress && files.length) {
    progress.querySelector("i").style.width = "100%";
    progress.querySelector("small").textContent = "완료본 업로드 완료";
  }
  if (!refs.master || !refs.subtitle) throw new Error("최종 MP4와 SRT 파일 또는 asset:// ID가 모두 필요합니다.");
  youtubeUploadAssets = refs;
  return refs;
}

async function runYoutubeAction(action) {
  const content = selectedYoutubeContent();
  const stage = content?.youtubeAutomation?.stages.find((item) => item.id === activeYoutubeStageId);
  const feedback = document.querySelector("#youtube-feedback");
  const buttons = [...document.querySelectorAll("[data-youtube-action]")];
  if (!content || !stage || !feedback) return;
  if (!workSession.authenticated) {
    pendingYoutubeAction = action;
    openSessionModal();
    return;
  }
  const inputText = document.querySelector("#youtube-input")?.value || "";
  let summary = document.querySelector("#youtube-summary")?.value.trim() || "";
  let assetUrl = document.querySelector("#youtube-asset-url")?.value.trim() || "";
  const parameters = {};
  document.querySelectorAll("[data-youtube-param]").forEach((field) => {
    parameters[field.dataset.youtubeParam] = field.type === "checkbox" ? field.checked : field.value;
  });
  const checklist = [...document.querySelectorAll("[data-youtube-check]")];
  const checklistConfirmed = checklist.length > 0 && checklist.every((field) => field.checked);
  const publishAtInput = document.querySelector("#youtube-publish-at")?.value || "";
  const publishSettings = stage.id === "youtube_publish" ? {
    privacyStatus: document.querySelector("#youtube-privacy-status")?.value || "private",
    publishAt: publishAtInput ? new Date(publishAtInput).toISOString() : null,
  } : null;
  buttons.forEach((button) => { button.disabled = true; });
  saveYoutubeDraft();
  const requestSerial = ++youtubeRequestSerial;
  feedback.textContent = action === "run" ? "최신 Wiki와 입력을 불러와 실행하고 있습니다…" : "상태와 산출물을 반영하고 있습니다…";
  feedback.className = "youtube-feedback is-loading";
  try {
    if (stage.id === "master_upload" && action === "complete") {
      const assets = await uploadYoutubeMasterAssets(content);
      parameters.assets = assets;
      assetUrl = assets.master;
    }
    if (stage.id === "source_package" && !summary) summary = "최신 작업 패키지와 입력물을 확인했습니다.";
    if (stage.id === "pc_main_edit") {
      if (!checklistConfirmed) throw new Error("PDF 원본 8개 공정을 모두 확인해주세요.");
      if (!summary) summary = "업로드한 PDF 원본 후반작업 8개 공정을 완료했습니다.";
    }
    if (stage.id === "master_upload" && !summary) summary = "최종 MP4·SRT 완료본을 등록했습니다.";
    if (stage.id === "thumbnail_idea" && !summary && action === "complete") {
      summary = `핵심 약속: ${parameters.corePromise || "-"}\n타깃: ${parameters.audience || "-"}\n카피 A/B: ${parameters.copyA || "-"} / ${parameters.copyB || "-"}\n시각 가설: ${parameters.visualHypothesis || "-"}`;
    }
    if (stage.id === "thumbnail_approve") {
      if (!assetUrl) throw new Error("승인할 최종 썸네일 Asset ID를 입력해주세요.");
      if (!summary) summary = parameters.decisionReason || "";
      if (!summary) throw new Error("AI 평가를 확인한 뒤 최종 후보의 선택 이유를 기록해주세요.");
    }
    const response = await fetch("/api/automation", {
      method: "POST",
      credentials: "same-origin",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        action,
        contentId: content.id,
        stageId: stage.id,
        actor: currentUser,
        inputText,
        summary,
        assetUrl,
        parameters,
        publishSettings,
        publishApprovalSecret: document.querySelector("#youtube-publish-approval-secret")?.value || "",
        qualityConfirmed: checklistConfirmed || document.querySelector("#youtube-quality-confirm")?.checked === true,
      }),
    });
    const result = await response.json().catch(() => ({}));
    if (response.status === 401) {
      workSession = { authenticated: false, actor: null, expiresAt: null };
      updateSessionStatus();
      pendingYoutubeAction = action;
      openSessionModal();
      throw new Error("작업 세션이 만료됐습니다. 다시 연결해주세요.");
    }
    if (!response.ok) throw new Error(result.error || "Automation 작업에 실패했습니다.");
    youtubeLastOutput = result.output ? { contentId: content.id, stageId: stage.id, text: result.output } : null;
    if (result.state) updateYoutubeState(content, result.state);
    activeYoutubeStageId = stage.id;
    if (stage.id === "master_upload" && action === "complete") youtubeUploadAssets = {};
    if (["run", "complete", "approve"].includes(action)) sessionStorage.removeItem(youtubeDraftKey(content.id, stage.id));
    if (requestSerial !== youtubeRequestSerial || currentView !== "youtube") return;
    renderYoutube();
    const nextFeedback = document.querySelector("#youtube-feedback");
    if (nextFeedback) {
      nextFeedback.textContent = result.jobId ? "Worker에 작업을 전달했습니다. 완료되면 OS 상태가 갱신됩니다." : "공정 상태와 결과 Markdown을 반영했습니다.";
      nextFeedback.className = "youtube-feedback is-success";
    }
  } catch (error) {
    if (requestSerial !== youtubeRequestSerial || currentView !== "youtube") return;
    feedback.textContent = error.message;
    feedback.className = "youtube-feedback is-error";
    buttons.forEach((button) => { button.disabled = false; });
  }
}

async function importYoutubeTextFile(file) {
  if (!file) return;
  if (file.size > 500_000) throw new Error("텍스트 파일은 500KB 이하여야 합니다.");
  const source = await file.text();
  if (source.length > 160_000) throw new Error("텍스트는 160,000자를 초과할 수 없습니다. 필요한 구간만 가져와주세요.");
  const target = document.querySelector("#youtube-input");
  if (target) { target.value = source; saveYoutubeDraft(); }
}

function renderMeetings() {
  activeMeetingId ||= meetingIdNow();
  const meetings = index.meetingItems || [];
  const folders = [
    { id: "inbox", label: "회의 Inbox", description: "작성 중인 메모와 전사 초안" },
    { id: "organized", label: "정리된 회의록", description: "AI 정리와 직접 편집이 끝난 문서" },
    { id: "decisions", label: "의사결정 기록", description: "실행에 반영할 확정 결정" },
  ];
  const visible = activeMeetingFilter === "all" ? meetings : meetings.filter((meeting) => meeting.folder === activeMeetingFilter);
  const meetingList = visible.length ? visible.map((meeting) => `
    <button class="meeting-list-item" data-meeting-open="${escapeHtml(meeting.path)}">
      <span>${meeting.sourceType === "recording" || meeting.sourceType === "upload" ? "◉" : "▤"}</span>
      <div><strong>${escapeHtml(meeting.title)}</strong><small>${escapeHtml(formatDate(meeting.meetingDate))} · ${escapeHtml(meeting.owner)}</small></div>
      <i>${escapeHtml(meetingFolderLabel(meeting.folder))}</i>
    </button>`).join("") : `<div class="meeting-list-empty"><span>아직 문서가 없습니다.</span><small>오른쪽에서 새 회의록을 작성하세요.</small></div>`;
  const processOptions = index.processes.map((process) => `<option value="${escapeHtml(process.id)}">${escapeHtml(process.id)}</option>`).join("");
  const contentOptions = index.contents.map((content) => `<option value="${escapeHtml(content.id)}">${escapeHtml(content.id)} · ${escapeHtml(content.title)}</option>`).join("");

  app.innerHTML = `
    <section class="meeting-head"><div><p>MEETING KNOWLEDGE</p><h2>회의 노트</h2><span>노션처럼 기록하고, 녹음을 전사·요약한 뒤 비공개 Markdown 폴더로 이동합니다.</span></div><div class="meeting-head-actions"><button class="secondary-action" id="meeting-load-private">↻ 비공개 회의록</button><button class="primary-action" id="meeting-new">＋ 새 회의록</button></div></section>
    <div class="meeting-layout">
      <aside class="meeting-library">
        <header><strong>회사 회의 기록</strong><span>${meetings.length}개 문서</span></header>
        <button class="meeting-folder ${activeMeetingFilter === "all" ? "is-active" : ""}" data-meeting-filter="all"><span>▥ 전체 회의록</span><em>${meetings.length}</em></button>
        ${folders.map((folder) => `<button class="meeting-folder ${activeMeetingFilter === folder.id ? "is-active" : ""}" data-meeting-filter="${folder.id}"><span>${escapeHtml(folder.label)}<small>${escapeHtml(folder.description)}</small></span><em>${meetings.filter((meeting) => meeting.folder === folder.id).length}</em></button>`).join("")}
        <div class="meeting-list">${meetingList}</div>
        ${meetingNextOffset !== null ? '<button class="meeting-load-more" id="meeting-load-more">다음 50개 불러오기</button>' : ""}
      </aside>

      <section class="meeting-editor-shell">
        <div class="meeting-document-path"><span id="meeting-path">06_meetings / inbox / ${escapeHtml(activeMeetingId)}.md</span><i>Git + Markdown</i></div>
        <input class="meeting-title-input" id="meeting-title" maxlength="160" placeholder="회의 제목" value="" />
        <div class="meeting-properties">
          <label><span>일시</span><input id="meeting-date" type="datetime-local" value="${toDateTimeLocal()}" /></label>
          <label><span>참석자</span><input id="meeting-participants" type="text" value="${escapeHtml(currentUser)}" placeholder="ricky, jay, jeongho" /></label>
          <label><span>장소</span><input id="meeting-location" type="text" value="office" placeholder="회의실 또는 온라인" /></label>
          <label><span>연결 공정</span><select id="meeting-process"><option value="">회사 공통</option>${processOptions}</select></label>
          <label><span>연결 Content</span><select id="meeting-content"><option value="">연결 없음</option>${contentOptions}</select></label>
          <label><span>저장 위치</span><select id="meeting-destination"><option value="inbox">회의 Inbox</option><option value="organized">정리된 회의록</option><option value="decisions">의사결정 기록</option></select></label>
        </div>

        <div class="meeting-toolbar" aria-label="Markdown 서식">
          <button data-meeting-block="heading">H2</button><button data-meeting-block="bullet">• 목록</button><button data-meeting-block="check">☐ 할 일</button><button data-meeting-block="quote">❝ 인용</button><span>Markdown으로 저장됩니다</span>
        </div>
        <textarea class="meeting-editor" id="meeting-editor" spellcheck="true" aria-label="회의록 본문">${escapeHtml(meetingTemplate())}</textarea>

        <section class="meeting-recorder">
          <header><div><span>AI MEETING ASSISTANT</span><strong>녹음 → 전사 → 회의록 정리</strong><p>녹음 구간은 OpenAI 전사 API로 전송되며 원본 오디오는 GitHub에 저장하지 않습니다. Markdown 저장은 비공개 회의 저장소가 연결된 경우에만 허용됩니다.</p></div><time id="meeting-record-time">00:00</time></header>
          <div class="meeting-record-actions"><button class="record-action" id="meeting-record">● 녹음 시작</button><button class="stop-action" id="meeting-stop" disabled>■ 녹음 종료</button><label class="upload-action">↑ 녹음 파일 가져오기<input id="meeting-audio-upload" type="file" accept="audio/*,.webm,.mp3,.m4a,.wav" multiple /></label><button class="ai-action" id="meeting-summarize">✦ AI 회의록 정리</button></div>
          <div class="meeting-segments" id="meeting-segments"><span>녹음하거나 2.5MB 이하의 음성 파일을 가져오면 전사문이 여기에 쌓입니다.</span></div>
          <label class="meeting-transcript-field"><span>전사 원문 · 직접 붙여넣기도 가능</span><textarea id="meeting-transcript" rows="7" placeholder="녹음 전사 결과 또는 기존 회의 내용을 붙여넣으세요."></textarea></label>
        </section>

        <footer class="meeting-savebar">
          <label><span>OS 작업 코드</span><input id="meeting-secret" type="password" autocomplete="current-password" value="${escapeHtml(sessionStorage.getItem("ba-os-push-secret") || "")}" placeholder="Repository 저장·AI 처리에 필요" /></label>
          <div><p class="meeting-feedback" id="meeting-feedback">작성 중에는 Inbox, 정리 후에는 완료 또는 의사결정 폴더로 저장하세요.</p><button class="primary-action" id="meeting-save">Markdown 저장·이동</button></div>
        </footer>
      </section>
    </div>`;
}

function setMeetingPath(path = "") {
  const target = document.querySelector("#meeting-path");
  if (!target) return;
  const destination = document.querySelector("#meeting-destination")?.value || "inbox";
  const year = new Date(document.querySelector("#meeting-date")?.value || Date.now()).getFullYear();
  target.textContent = path || `06_meetings / ${destination}${destination === "inbox" ? "" : ` / ${year}`} / ${activeMeetingId}.md`;
}

function resetMeetingEditor() {
  activeMeetingPath = "";
  activeMeetingId = meetingIdNow();
  activeMeetingVersion = 0;
  meetingSourceType = "manual";
  meetingSegments = [];
  document.querySelector("#meeting-title").value = "";
  document.querySelector("#meeting-date").value = toDateTimeLocal();
  document.querySelector("#meeting-participants").value = currentUser;
  document.querySelector("#meeting-location").value = "office";
  document.querySelector("#meeting-process").value = "";
  document.querySelector("#meeting-content").value = "";
  document.querySelector("#meeting-destination").value = "inbox";
  document.querySelector("#meeting-editor").value = meetingTemplate();
  document.querySelector("#meeting-transcript").value = "";
  renderMeetingSegments();
  setMeetingPath();
  meetingFeedback("새 회의록을 시작했습니다. 제목과 내용을 입력하세요.");
  document.querySelector("#meeting-title").focus();
}

function openMeetingNote(path) {
  const meeting = (index.meetingItems || []).find((item) => item.path === path);
  if (!meeting) return;
  if (!("body" in meeting)) {
    readPrivateMeeting(path);
    return;
  }
  activeMeetingPath = meeting.path;
  activeMeetingId = meeting.id;
  activeMeetingVersion = Number(meeting.version || 1);
  meetingSourceType = meeting.sourceType || "manual";
  meetingSegments = [];
  document.querySelector("#meeting-title").value = meeting.title || "";
  document.querySelector("#meeting-date").value = toDateTimeLocal(meeting.meetingDate || meeting.updatedAt);
  document.querySelector("#meeting-participants").value = (meeting.participants || []).join(", ");
  document.querySelector("#meeting-location").value = meeting.location || "";
  document.querySelector("#meeting-process").value = meeting.process || "";
  document.querySelector("#meeting-content").value = meeting.contentId || "";
  document.querySelector("#meeting-destination").value = meeting.folder || "inbox";
  document.querySelector("#meeting-editor").value = meeting.body || meetingTemplate();
  document.querySelector("#meeting-transcript").value = meetingSection(meeting.body, "원문 메모·전사");
  renderMeetingSegments();
  setMeetingPath(meeting.path);
  meetingFeedback(`${meeting.path} 문서를 열었습니다.`);
}

async function readPrivateMeeting(path) {
  const secret = meetingSecret();
  if (!secret) return meetingFeedback("회의록 본문을 열려면 OS 작업 코드를 입력해주세요.", "error");
  meetingFeedback("암호화된 비공개 저장소에서 회의록 본문을 불러오고 있습니다.");
  try {
    const response = await fetch("/api/meetings", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${secret}` },
      body: JSON.stringify({ action: "read", path }),
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(result.error || "회의록 본문을 불러오지 못했습니다.");
    const indexValue = (index.meetingItems || []).findIndex((item) => item.path === path);
    if (indexValue >= 0) index.meetingItems[indexValue] = result.meeting;
    openMeetingNote(path);
  } catch (error) {
    meetingFeedback(error.message, "error");
  }
}

function insertMeetingBlock(type) {
  const editor = document.querySelector("#meeting-editor");
  if (!editor) return;
  const snippets = { heading: "\n## 새 섹션\n\n", bullet: "\n- 항목\n", check: "\n- [ ] 담당자 · 할 일 · 기한\n", quote: "\n> 중요한 발언\n" };
  const snippet = snippets[type] || "";
  const start = editor.selectionStart;
  editor.setRangeText(snippet, start, editor.selectionEnd, "end");
  editor.focus();
}

function recordingTime() {
  const elapsed = Math.max(0, Math.floor((Date.now() - meetingRecordingStartedAt) / 1000));
  return `${String(Math.floor(elapsed / 60)).padStart(2, "0")}:${String(elapsed % 60).padStart(2, "0")}`;
}

function setRecordingControls() {
  const start = document.querySelector("#meeting-record");
  const stop = document.querySelector("#meeting-stop");
  if (!start || !stop) return;
  start.disabled = meetingRecordingActive;
  stop.disabled = !meetingRecordingActive;
  start.textContent = meetingRecordingActive ? "● 녹음 중" : "● 녹음 시작";
  start.classList.toggle("is-recording", meetingRecordingActive);
}

function renderMeetingSegments() {
  const target = document.querySelector("#meeting-segments");
  if (!target) return;
  if (!meetingSegments.length) {
    target.innerHTML = "<span>녹음하거나 2.5MB 이하의 음성 파일을 가져오면 전사문이 여기에 쌓입니다.</span>";
    return;
  }
  target.innerHTML = meetingSegments.map((segment, indexValue) => `<article><i>${String(indexValue + 1).padStart(2, "0")}</i><div><strong>${escapeHtml(segment.name)}</strong><span>${escapeHtml(segment.status)}</span></div>${segment.url ? `<audio controls preload="metadata" src="${escapeHtml(segment.url)}"></audio>` : ""}</article>`).join("");
}

async function blobToBase64(blob) {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let binary = "";
  for (let indexValue = 0; indexValue < bytes.length; indexValue += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(indexValue, indexValue + 0x8000));
  }
  return btoa(binary);
}

async function transcribeMeetingAudio(blob, name) {
  if (blob.size > 2_500_000) throw new Error(`${name}: 2.5MB를 초과합니다. OS 녹음 버튼을 사용하면 자동 분할됩니다.`);
  const secret = meetingSecret();
  if (!secret) throw new Error("AI 전사에 사용할 OS 작업 코드를 입력해주세요.");
  const segment = { name, status: "전사 중…", url: URL.createObjectURL(blob), text: "" };
  meetingSegments.push(segment);
  renderMeetingSegments();
  try {
    const response = await fetch("/api/meetings", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${secret}` },
      body: JSON.stringify({ action: "transcribe", audioBase64: await blobToBase64(blob), mimeType: blob.type || "audio/webm", fileName: name }),
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(result.error || "전사에 실패했습니다.");
    segment.text = result.transcript || "";
    segment.status = "전사 완료";
    const transcript = document.querySelector("#meeting-transcript");
    transcript.value = [transcript.value.trim(), segment.text.trim()].filter(Boolean).join("\n\n");
    sessionStorage.setItem("ba-os-push-secret", secret);
    meetingFeedback(`${name} 전사가 완료됐습니다.`, "success");
  } catch (error) {
    segment.status = `실패 · ${error.message}`;
    meetingFeedback(error.message, "error");
  }
  renderMeetingSegments();
}

function startMeetingSegment() {
  if (!meetingStream || !meetingRecordingActive) return;
  const chunks = [];
  const options = MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
    ? { mimeType: "audio/webm;codecs=opus", audioBitsPerSecond: 32_000 }
    : { audioBitsPerSecond: 32_000 };
  const recorder = new MediaRecorder(meetingStream, options);
  meetingRecorder = recorder;
  recorder.addEventListener("dataavailable", (event) => { if (event.data.size) chunks.push(event.data); });
  recorder.addEventListener("stop", async () => {
    clearTimeout(meetingSegmentTimer);
    const blob = new Blob(chunks, { type: recorder.mimeType || "audio/webm" });
    const segmentName = `${activeMeetingId}-${String(meetingSegments.length + 1).padStart(2, "0")}.webm`;
    if (meetingRecordingActive) startMeetingSegment();
    if (blob.size) await transcribeMeetingAudio(blob, segmentName);
    if (!meetingRecordingActive && meetingStream) {
      meetingStream.getTracks().forEach((track) => track.stop());
      meetingStream = null;
    }
  }, { once: true });
  recorder.start();
  meetingSegmentTimer = setTimeout(() => {
    if (meetingRecorder?.state === "recording") meetingRecorder.stop();
  }, 120_000);
}

async function startMeetingRecording() {
  if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") {
    meetingFeedback("이 브라우저에서는 마이크 녹음을 지원하지 않습니다. 녹음 파일 가져오기를 사용해주세요.", "error");
    return;
  }
  try {
    meetingStream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
    meetingRecordingActive = true;
    meetingRecordingStartedAt = Date.now();
    meetingSourceType = "recording";
    document.querySelector("#meeting-record-time").textContent = "00:00";
    meetingTimer = setInterval(() => { const time = document.querySelector("#meeting-record-time"); if (time) time.textContent = recordingTime(); }, 1000);
    setRecordingControls();
    startMeetingSegment();
    meetingFeedback("녹음 중입니다. 약 2분마다 전사 구간이 자동으로 생성됩니다.");
  } catch (error) {
    meetingFeedback(`마이크를 시작할 수 없습니다: ${error.message}`, "error");
  }
}

function stopMeetingRecording() {
  meetingRecordingActive = false;
  clearInterval(meetingTimer);
  clearTimeout(meetingSegmentTimer);
  setRecordingControls();
  if (meetingStream) {
    meetingStream.getTracks().forEach((track) => track.stop());
    meetingStream = null;
  }
  if (meetingRecorder?.state === "recording") meetingRecorder.stop();
  meetingFeedback("녹음을 종료했습니다. 마지막 구간 전사가 끝나면 AI 회의록 정리를 실행하세요.");
}

async function importMeetingAudio(files) {
  meetingSourceType = "upload";
  for (const file of files) await transcribeMeetingAudio(file, file.name);
}

async function summarizeMeeting() {
  const transcript = document.querySelector("#meeting-transcript").value.trim();
  const notes = document.querySelector("#meeting-editor").value.trim();
  const secret = meetingSecret();
  if (!transcript && !notes) return meetingFeedback("정리할 전사문이나 메모를 입력해주세요.", "error");
  if (!secret) return meetingFeedback("AI 정리에 사용할 OS 작업 코드를 입력해주세요.", "error");
  const button = document.querySelector("#meeting-summarize");
  button.disabled = true;
  button.textContent = "✦ 회의록 정리 중…";
  meetingFeedback("전사문에서 논의·결정·액션 아이템을 분리하고 있습니다.");
  try {
    const response = await fetch("/api/meetings", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${secret}` },
      body: JSON.stringify({ action: "summarize", title: document.querySelector("#meeting-title").value.trim(), attendees: document.querySelector("#meeting-participants").value.trim(), notes, transcript }),
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(result.error || "AI 회의록 정리에 실패했습니다.");
    document.querySelector("#meeting-editor").value = result.markdown || notes;
    sessionStorage.setItem("ba-os-push-secret", secret);
    meetingFeedback("AI가 회의록 초안을 만들었습니다. 내용을 확인하고 직접 수정한 뒤 저장하세요.", "success");
  } catch (error) {
    meetingFeedback(error.message, "error");
  } finally {
    button.disabled = false;
    button.textContent = "✦ AI 회의록 정리";
  }
}

function bodyWithTranscript(body, transcript) {
  if (!transcript) return body;
  const marker = "## 원문 메모·전사";
  if (!body.includes(marker)) return `${body.trim()}\n\n${marker}\n\n${transcript.trim()}\n`;
  if (meetingSection(body, "원문 메모·전사")) return body;
  return body.replace(marker, `${marker}\n\n${transcript.trim()}`);
}

async function saveMeeting() {
  const title = document.querySelector("#meeting-title").value.trim();
  const secret = meetingSecret();
  if (!title) return meetingFeedback("회의 제목을 입력해주세요.", "error");
  if (!secret) return meetingFeedback("Repository 저장에 사용할 OS 작업 코드를 입력해주세요.", "error");
  const destination = document.querySelector("#meeting-destination").value;
  const transcript = document.querySelector("#meeting-transcript").value.trim();
  const button = document.querySelector("#meeting-save");
  button.disabled = true;
  button.textContent = "저장 중…";
  meetingFeedback(activeMeetingPath ? "Markdown을 저장하고 선택한 폴더로 이동하고 있습니다." : "새 Markdown을 Repository에 저장하고 있습니다.");
  const payload = {
    action: "save",
    id: activeMeetingId,
    sourcePath: activeMeetingPath,
    version: activeMeetingVersion,
    title,
    meetingDate: document.querySelector("#meeting-date").value,
    owner: currentUser,
    participants: document.querySelector("#meeting-participants").value.split(",").map((item) => item.trim()).filter(Boolean),
    location: document.querySelector("#meeting-location").value.trim() || "-",
    process: document.querySelector("#meeting-process").value || null,
    contentId: document.querySelector("#meeting-content").value || null,
    destination,
    sourceType: meetingSourceType,
    transcriptStatus: transcript ? "completed" : "not_required",
    summaryStatus: destination === "inbox" ? "draft" : "completed",
    body: bodyWithTranscript(document.querySelector("#meeting-editor").value, transcript),
  };
  try {
    const response = await fetch("/api/meetings", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${secret}` },
      body: JSON.stringify(payload),
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(result.error || "회의록 저장에 실패했습니다.");
    activeMeetingPath = result.path;
    activeMeetingVersion = result.version;
    setMeetingPath(result.path);
    sessionStorage.setItem("ba-os-push-secret", secret);
    meetingFeedback(`저장 완료 · ${result.path}`, "success");
    button.textContent = "저장 완료";
    await loadPrivateMeetings({ silent: true, reopenPath: result.path });
  } catch (error) {
    meetingFeedback(error.message, "error");
    button.textContent = "Markdown 저장·이동";
  } finally {
    button.disabled = false;
  }
}

async function loadPrivateMeetings({ silent = false, reopenPath = "", append = false } = {}) {
  const secret = meetingSecret();
  if (!secret) return meetingFeedback("비공개 회의록을 불러오려면 OS 작업 코드를 입력해주세요.", "error");
  if (!silent) meetingFeedback("비공개 회의 저장소를 확인하고 있습니다.");
  try {
    const response = await fetch("/api/meetings", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${secret}` },
      body: JSON.stringify({ action: "list", offset: append ? meetingNextOffset || 0 : 0, limit: 50 }),
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(result.error || "비공개 회의록을 불러오지 못했습니다.");
    const incoming = result.meetings || [];
    index.meetingItems = append ? [...index.meetingItems, ...incoming] : incoming;
    meetingNextOffset = result.nextOffset ?? null;
    sessionStorage.setItem("ba-os-push-secret", secret);
    meetingCount.textContent = index.meetingItems.length;
    renderMeetings();
    if (reopenPath) openMeetingNote(reopenPath);
    else meetingFeedback(`${index.meetingItems.length}개의 비공개 회의록을 불러왔습니다.`, "success");
  } catch (error) {
    meetingFeedback(error.message, "error");
  }
}

function renderPeople() {
  const cards = index.people.map((person) => `
    <article class="person-workspace ${person.id === currentUser ? "is-mine" : ""}">
      <header><div class="person-identity"><i>${escapeHtml(initials(person.id))}</i><div><span>${person.id === currentUser ? "MY WORKSPACE" : "EMPLOYEE WORKSPACE"}</span><h3>${escapeHtml(person.id)}</h3><p>${escapeHtml(person.role)}</p></div></div>${statusBadge(person.status)}</header>
      <div class="workspace-stats"><div><strong>${person.currentTasks.length}</strong><span>현재 업무</span></div><div><strong>${person.assignedSteps.length}</strong><span>담당 Step</span></div><div><strong>${person.wikiCount}</strong><span>공유 Wiki</span></div><div><strong>${person.skillIds.length}</strong><span>Access Skill</span></div></div>
      <div class="workspace-section"><strong>담당 업무</strong><div class="workspace-chips">${person.assignedSteps.map((step) => `<span>${escapeHtml(step.process)} · ${escapeHtml(step.label)}</span>`).join("") || "<span>미지정</span>"}</div></div>
      <div class="workspace-section"><strong>연결 Access Skill</strong><div class="workspace-chips">${person.skillIds.map((skillId) => `<span class="is-skill">${escapeHtml(skillId)}</span>`).join("") || "<span>연결 없음</span>"}</div></div>
      <footer><span>${escapeHtml(person.path)}</span>${person.currentTasks.length ? `<button data-content-id="${escapeHtml(person.currentTasks[0].id)}">현재 업무 열기 →</button>` : "<small>현재 배정 업무 없음</small>"}</footer>
    </article>`).join("");
  app.innerHTML = `
    <section class="workspace-head"><div><p>PEOPLE & CONTEXT</p><h2>직원별 업무 폴더</h2><span>개인 Obsidian의 Raw는 가져오지 않고, 회사에 공유한 Wiki와 담당 공정·Access Skill만 연결합니다.</span></div><div class="personal-boundary"><strong>개인 영역</strong><span>Raw · 개인 Wiki · 개인 AI</span><i>공유 경계 → Company Wiki</i></div></section>
    <div class="person-grid">${cards}</div>`;
}

function wikiTypeLabel(type) {
  return ({ company: "회사 공통", process: "공정 Wiki", people: "직원 공유 Wiki" })[type] || type;
}

function wikiCards(items) {
  if (!items.length) return emptyState("이 폴더에는 아직 Wiki가 없습니다", "개인 Obsidian에서 공유할 가치가 있는 Wiki만 회사 OS에 연결합니다.");
  return `<div class="wiki-file-grid">${items.map((wiki) => `<article class="wiki-file-card">
    <div class="wiki-file-icon">${wiki.wikiType === "process" ? "▦" : wiki.wikiType === "people" ? "♙" : "◆"}</div>
    <div><header><span>${escapeHtml(wikiTypeLabel(wiki.wikiType))} · ${escapeHtml(wiki.category)}</span><h3>${escapeHtml(wiki.title)}</h3></header><p>${escapeHtml(wiki.excerpt)}</p>
    <div class="wiki-file-meta"><span>owner · ${escapeHtml(wiki.owner)}</span>${wiki.process ? `<span>${escapeHtml(wiki.process)} / ${escapeHtml(wiki.step)}</span>` : ""}<span>v${escapeHtml(wiki.version)} · ${escapeHtml(formatDate(wiki.updatedAt))}</span></div>
    <footer><span>${escapeHtml(wiki.path)}</span><i>최신 정본</i></footer></div>
  </article>`).join("")}</div>`;
}

function renderWiki() {
  const types = [
    { id: "company", label: "회사 공통", icon: "◆", description: "전 직원이 공통으로 참고하는 기준" },
    { id: "process", label: "공정 Wiki", icon: "▦", description: "각 공정단의 최신 실무 정본" },
    { id: "people", label: "직원 공유 Wiki", icon: "♙", description: "개인이 회사에 공유한 역할별 지식" },
  ];
  const visible = activeWikiFilter === "all" ? index.wikiItems : index.wikiItems.filter((wiki) => wiki.wikiType === activeWikiFilter);
  const selected = types.find((type) => type.id === activeWikiFilter);
  app.innerHTML = `
    <section class="workspace-head"><div><p>COMPANY SOURCE OF TRUTH</p><h2>Company Wiki</h2><span>공정과 AI가 참조하는 최신 정본입니다. 개인 Raw는 이곳에 저장하지 않습니다.</span></div><div class="skill-source"><small>VERSION RULE</small><strong>Latest Wiki Only</strong><span>이전 버전은 Git 이력으로 보존</span></div></section>
    <div class="wiki-library-layout"><aside class="wiki-tree-panel">
      <button class="wiki-tree-item ${activeWikiFilter === "all" ? "is-active" : ""}" data-wiki-filter="all"><span>▣ 전체 Wiki</span><em>${index.wikiItems.length}</em></button>
      ${types.map((type) => `<button class="wiki-tree-item ${activeWikiFilter === type.id ? "is-active" : ""}" data-wiki-filter="${escapeHtml(type.id)}"><span>${type.icon} ${escapeHtml(type.label)}<small>${escapeHtml(type.description)}</small></span><em>${index.wikiItems.filter((wiki) => wiki.wikiType === type.id).length}</em></button>`).join("")}
    </aside><section class="skill-browser"><header class="skill-browser-head"><div><p>선택한 정본</p><h2>${escapeHtml(selected?.label || "전체 Wiki")}</h2><span>${visible.length}개의 최신 Wiki</span></div><span class="folder-path">10_wiki / ${escapeHtml(selected?.id || "all")}</span></header>${wikiCards(visible)}</section></div>`;
}

function renderSkills() {
  const matchesFilter = (skill) => {
    if (activeSkillFilter === "all") return true;
    const [type, value] = activeSkillFilter.split(":");
    if (type === "category") return skill.categoryId === value;
    if (type === "folder") return `${skill.categoryId}/${skill.folderId}` === value;
    return true;
  };
  const visibleSkills = index.skills.filter(matchesFilter);
  const selectedCategory = index.skillCategories.find((category) => activeSkillFilter === `category:${category.id}` || activeSkillFilter.startsWith(`folder:${category.id}/`));
  const selectedFolder = selectedCategory?.folders.find((folder) => activeSkillFilter === `folder:${selectedCategory.id}/${folder.id}`);
  const selectedLabel = selectedFolder?.label || selectedCategory?.label || "전체 Access Skill";
  const iconFor = (skill) => ({ planning: "◇", writing: "Aa", video: "▶", publishing: "↗" }[skill.folderId] || "✦");
  const folderTree = index.skillCategories.map((category) => {
    const isExpanded = category.count > 0 || activeSkillFilter === `category:${category.id}` || activeSkillFilter.startsWith(`folder:${category.id}/`);
    return `
    <div class="skill-tree-group ${isExpanded ? "is-expanded" : ""}">
      <button class="skill-tree-category ${activeSkillFilter === `category:${category.id}` ? "is-active" : ""}" data-skill-filter="category:${escapeHtml(category.id)}"><span>${escapeHtml(category.icon)} ${escapeHtml(category.label)}</span><em>${category.count}</em></button>
      ${isExpanded ? `<div class="skill-tree-folders">${category.folders.map((folder) => `<button class="skill-tree-folder ${activeSkillFilter === `folder:${category.id}/${folder.id}` ? "is-active" : ""}" data-skill-filter="folder:${escapeHtml(category.id)}/${escapeHtml(folder.id)}"><span>› ${escapeHtml(folder.label)}</span><em>${folder.count}</em></button>`).join("")}</div>` : ""}
    </div>`;
  }).join("");
  const cards = visibleSkills.length ? `<div class="skill-file-grid">${visibleSkills.map((skill) => `
    <article class="skill-file-card">
      <div class="skill-file-icon">${escapeHtml(iconFor(skill))}</div>
      <div class="skill-file-body">
        <header><div><span>${escapeHtml(skill.categoryLabel)} / ${escapeHtml(skill.folderLabel)}</span><h3>${escapeHtml(skill.id)}</h3></div><i>v${escapeHtml(skill.version)}</i></header>
        <p>${escapeHtml(skill.purpose || "현재 업무에 필요한 최신 Wiki와 데이터를 회사 OS에서 불러옵니다.")}</p>
        <div class="skill-file-meta"><span>담당 · ${escapeHtml(skill.owner)}</span><span>${escapeHtml(skill.process)} / ${escapeHtml(skill.step)}</span><span>Wiki ${skill.wikiSources.length}개 연결</span></div>
        <div class="chip-row">${skill.tools.map((tool) => `<span class="chip">${escapeHtml(tool)}</span>`).join("") || '<span class="chip">human</span>'}</div>
        <details class="skill-detail"><summary>불러오기 규칙 펼치기</summary><div><strong>불러올 Context</strong><p>${escapeHtml(skill.readContext || "SKILL.md 참고")}</p><strong>호출 순서</strong><p>${escapeHtml(skill.procedure || "SKILL.md 참고")}</p><strong>Context 반환 계약</strong><p>${escapeHtml(skill.outputContract || "SKILL.md 참고")}</p><strong>검증 기준</strong><p>${escapeHtml(skill.qualityCriteria || "SKILL.md 참고")}</p></div></details>
        <footer><span>${escapeHtml(skill.repositoryPath)}</span><a href="${escapeHtml(skill.downloadUrl)}" download>SKILL.md 받기 ↓</a></footer>
      </div>
    </article>`).join("")}</div>` : emptyState("이 폴더에는 아직 Skill이 없습니다", "새 Skill이 등록되면 폴더에 자동으로 표시됩니다.");
  const connectionRows = visibleSkills.map((skill) => `<tr><td><strong>${escapeHtml(skill.id)}</strong></td><td>${escapeHtml(skill.process)} / ${escapeHtml(skill.step)}</td><td>${skill.wikiSources.map((wikiId) => `<span class="mini-wiki">${escapeHtml(wikiId)}</span>`).join("")}</td><td>${ownerBadge(skill.owner)}</td><td><span class="status" data-status="${escapeHtml(skill.status)}">${escapeHtml(statusLabel(skill.status))}</span></td></tr>`).join("");

  app.innerHTML = `
    <section class="skill-library-head"><div><p>OS CONTEXT ACCESS</p><h2>OS Access Skills</h2><span>각자의 AI가 현재 공정에 필요한 최신 Company Wiki와 Content Run 데이터를 불러오는 연결 규칙입니다.</span></div><div class="skill-source"><small>SKILL ROLE</small><strong>Context Loader</strong><span>업무 실행·판단은 각자의 AI와 사람</span></div></section>
    <div class="skill-library-layout">
      <aside class="skill-tree-panel">
        <button class="skill-tree-all ${activeSkillFilter === "all" ? "is-active" : ""}" data-skill-filter="all"><span>✦ 전체 Access Skill</span><em>${index.skills.length}</em></button>
        ${folderTree}
      </aside>
      <section class="skill-browser">
        <header class="skill-browser-head"><div><p>선택한 폴더</p><h2>${escapeHtml(selectedLabel)}</h2><span>${visibleSkills.length}개의 Skill</span></div><span class="folder-path">04_skills / ${escapeHtml(selectedCategory?.id || "all")}${selectedFolder ? ` / ${escapeHtml(selectedFolder.id)}` : ""}</span></header>
        ${cards}
        ${visibleSkills.length ? `<section class="skill-connection"><header><h2>Wiki 호출 연결 현황</h2><p>각 Access Skill이 어떤 공정에서 어떤 최신 Wiki를 불러오는지 확인합니다.</p></header><div class="panel table-wrap"><table class="table"><thead><tr><th>Access Skill</th><th>사용 공정</th><th>불러오는 Wiki</th><th>담당자</th><th>상태</th></tr></thead><tbody>${connectionRows}</tbody></table></div></section>` : ""}
      </section>
    </div>`;
}

function render() {
  if (currentView === "approvals") {
    currentView = "youtube";
    if (location.hash !== "#youtube") history.replaceState(null, "", "#youtube");
  }
  if (!viewTitles[currentView]) currentView = "dashboard";
  if (currentView !== "youtube") { clearTimeout(youtubePollTimer); youtubePollTimer = null; }
  if (sessionStatusButton) sessionStatusButton.hidden = currentView === "youtube";
  pageTitle.textContent = viewTitles[currentView];
  document.querySelectorAll(".nav-item").forEach((button) => button.classList.toggle("is-active", button.dataset.view === currentView));
  ({ dashboard: renderDashboard, tasks: renderTasks, youtube: renderYoutube, contents: renderContents, meetings: renderMeetings, people: renderPeople, wiki: renderWiki, skills: renderSkills })[currentView]();
  taskCount.textContent = tasksForUser().length + automationTasksForUser().length;
  peopleCount.textContent = index.people.length;
  meetingCount.textContent = (index.meetingItems || []).length;
  sidebar.classList.remove("is-open");
}

function openDrawer(contentId) {
  const content = index.contents.find((item) => item.id === contentId);
  if (!content) return;
  drawerContent.innerHTML = `
    <span class="drawer-kicker">${escapeHtml(content.id)} · ${escapeHtml(content.type)}</span>
    <h2>${escapeHtml(content.title)}</h2>
    <p class="drawer-summary">${statusBadge(content.status)}</p>
    <div class="drawer-info">
      <div><span>현재 단계</span><strong>${escapeHtml(content.currentStep)}</strong></div>
      <div><span>현재 담당자</span><strong>${escapeHtml(content.owner)}</strong></div>
      <div><span>다음 담당자</span><strong>${escapeHtml(content.nextOwner || "-")}</strong></div>
      <div><span>업데이트</span><strong>${escapeHtml(formatDate(content.updatedAt))}</strong></div>
    </div>
    <div class="work-actions">
      ${content.youtubeAutomation ? `<button class="primary-action" data-youtube-task="${escapeHtml(content.id)}" data-youtube-stage="${escapeHtml(content.youtubeAutomation.currentStageId)}">▶ 제작 관제 열기</button>` : ""}
      <a class="primary-action" href="${escapeHtml(content.workPackageUrl || "#")}" download="${escapeHtml(content.id)}_WORK_PACKAGE.md" ${content.workPackageUrl ? "" : 'aria-disabled="true"'}>↓ 작업 시작</a>
      <button class="secondary-action" data-submit-mode="submit" data-content-id="${escapeHtml(content.id)}">↑ 작업 제출</button>
    </div>
    <p class="work-help">작업 시작은 최신 Context와 Skill을 내려받고, 작업 제출은 결과 정보를 Repository에 기록합니다.</p>
    <div class="timeline"><h3>공정 진행 상태</h3>${content.steps.map((step) => {
      const state = ["approved", "completed"].includes(step.status) ? "is-done" : step.id === content.currentStep ? "is-current" : "";
      return `<div class="timeline-item ${state}"><i class="timeline-dot"></i><strong>${escapeHtml(step.label)}</strong><span>${escapeHtml(step.owner)} · ${escapeHtml(statusLabel(step.status))}</span></div>`;
    }).join("")}</div>`;
  drawerBackdrop.hidden = false;
  drawer.classList.add("is-open");
  drawer.setAttribute("aria-hidden", "false");
}

function openSubmitModal(contentId, mode) {
  const content = index.contents.find((item) => item.id === contentId);
  if (!content) return;
  const step = content.steps.find((item) => item.id === content.currentStep);
  const outputs = step?.outputs?.length ? step.outputs : [{ key: content.currentStep }];
  document.querySelector("#submit-content-id").value = content.id;
  document.querySelector("#submit-step").value = content.currentStep;
  document.querySelector("#submit-mode").value = mode;
  document.querySelector("#submit-title").textContent = "작업 제출";
  document.querySelector("#submit-description").textContent = `${content.id} · ${content.currentStep} · ${currentUser}`;
  document.querySelector("#submit-secret").value = sessionStorage.getItem("ba-os-push-secret") || "";
  const artifactSelect = document.querySelector("#submit-artifact-key");
  artifactSelect.innerHTML = outputs.map((output) => `<option value="${escapeHtml(output.key)}">${escapeHtml(output.key)}</option>`).join("");
  document.querySelector("#submit-artifact-field").hidden = outputs.length === 1;
  submitFeedback.textContent = "";
  submitFeedback.className = "submit-feedback";
  submitBackdrop.hidden = false;
  submitModal.classList.add("is-open");
  submitModal.setAttribute("aria-hidden", "false");
  document.querySelector("#submit-summary").focus();
}

function closeSubmitModal() {
  submitModal.classList.remove("is-open");
  submitModal.setAttribute("aria-hidden", "true");
  submitBackdrop.hidden = true;
}

async function submitWork(event) {
  event.preventDefault();
  const button = document.querySelector("#submit-button");
  const secret = document.querySelector("#submit-secret").value;
  const file = document.querySelector("#submit-markdown").files[0];
  if (file && file.size > 1_500_000) {
    submitFeedback.textContent = "Markdown 파일은 1.5MB 이하여야 합니다.";
    submitFeedback.className = "submit-feedback is-error";
    return;
  }
  const payload = {
    contentId: document.querySelector("#submit-content-id").value,
    step: document.querySelector("#submit-step").value,
    artifactKey: document.querySelector("#submit-artifact-key").value,
    mode: document.querySelector("#submit-mode").value,
    actor: currentUser,
    summary: document.querySelector("#submit-summary").value.trim(),
    assetUrl: document.querySelector("#submit-asset-url").value.trim(),
    checksum: document.querySelector("#submit-checksum").value.trim(),
    sourceMarkdown: file ? await file.text() : "",
  };
  button.disabled = true;
  button.textContent = "검증하고 반영하는 중…";
  submitFeedback.textContent = "";
  try {
    const response = await fetch("/api/push", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${secret}` },
      body: JSON.stringify(payload),
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(result.error || "Push에 실패했습니다.");
    sessionStorage.setItem("ba-os-push-secret", secret);
    submitFeedback.textContent = "Repository 반영 완료. 자동 배포 후 화면이 갱신됩니다.";
    submitFeedback.className = "submit-feedback is-success";
    button.textContent = "반영 완료";
    submitForm.querySelectorAll("input:not([type=hidden]):not([type=password]), textarea").forEach((field) => { field.value = ""; });
  } catch (error) {
    submitFeedback.textContent = error.message;
    submitFeedback.className = "submit-feedback is-error";
    button.disabled = false;
    button.textContent = "Repository에 반영";
  }
}

function closeDrawer() {
  drawer.classList.remove("is-open");
  drawer.setAttribute("aria-hidden", "true");
  setTimeout(() => { drawerBackdrop.hidden = true; }, 220);
}

function bindEvents() {
  document.querySelectorAll(".nav-item").forEach((button) => button.addEventListener("click", () => {
    if (meetingRecordingActive && button.dataset.view !== "meetings") stopMeetingRecording();
    if (currentView === "youtube") saveYoutubeDraft();
    if (button.dataset.view !== "youtube") youtubeRequestSerial += 1;
    currentView = button.dataset.view;
    location.hash = currentView;
  }));
  document.querySelector("#mobile-menu").addEventListener("click", () => sidebar.classList.toggle("is-open"));
  userSelect.addEventListener("change", () => {
    currentUser = userSelect.value;
    localStorage.setItem("ba-os-user", currentUser);
    if (workSession.authenticated && workSession.actor !== currentUser) {
      fetch("/api/session", { method: "DELETE", credentials: "same-origin" }).catch(() => {});
      workSession = { authenticated: false, actor: null, expiresAt: null };
      updateSessionStatus();
    }
    render();
  });
  app.addEventListener("click", (event) => {
    const youtubeTask = event.target.closest("[data-youtube-task]");
    if (youtubeTask) {
      activeYoutubeContentId = youtubeTask.dataset.youtubeTask;
      activeYoutubeStageId = youtubeTask.dataset.youtubeStage || "";
      currentView = "youtube";
      if (location.hash !== "#youtube") location.hash = "youtube";
      else renderYoutube();
      return;
    }
    const youtubeStage = event.target.closest(".thumbnail-loop [data-youtube-stage], .youtube-workspace [data-youtube-stage]");
    if (youtubeStage) {
      saveYoutubeDraft();
      activeYoutubeStageId = youtubeStage.dataset.youtubeStage;
      youtubeLastOutput = null;
      renderYoutube();
      return;
    }
    const youtubeAction = event.target.closest("[data-youtube-action]");
    if (youtubeAction) {
      runYoutubeAction(youtubeAction.dataset.youtubeAction);
      return;
    }
    const contentTarget = event.target.closest("[data-content-id]");
    if (contentTarget) openDrawer(contentTarget.dataset.contentId);
    const viewTarget = event.target.closest("[data-go]");
    if (viewTarget) location.hash = viewTarget.dataset.go;
    const skillFilter = event.target.closest("[data-skill-filter]");
    if (skillFilter) {
      activeSkillFilter = skillFilter.dataset.skillFilter;
      renderSkills();
    }
    const wikiFilter = event.target.closest("[data-wiki-filter]");
    if (wikiFilter) {
      activeWikiFilter = wikiFilter.dataset.wikiFilter;
      renderWiki();
    }
    const meetingFilter = event.target.closest("[data-meeting-filter]");
    if (meetingFilter) {
      activeMeetingFilter = meetingFilter.dataset.meetingFilter;
      renderMeetings();
    }
    const meetingOpen = event.target.closest("[data-meeting-open]");
    if (meetingOpen) openMeetingNote(meetingOpen.dataset.meetingOpen);
    const meetingBlock = event.target.closest("[data-meeting-block]");
    if (meetingBlock) insertMeetingBlock(meetingBlock.dataset.meetingBlock);
    if (event.target.closest("#meeting-new")) resetMeetingEditor();
    if (event.target.closest("#meeting-load-private")) loadPrivateMeetings();
    if (event.target.closest("#meeting-load-more")) loadPrivateMeetings({ append: true });
    if (event.target.closest("#meeting-record")) startMeetingRecording();
    if (event.target.closest("#meeting-stop")) stopMeetingRecording();
    if (event.target.closest("#meeting-summarize")) summarizeMeeting();
    if (event.target.closest("#meeting-save")) saveMeeting();
    if (event.target.closest("#youtube-refresh")) refreshYoutubeState(false);
  });
  app.addEventListener("input", (event) => {
    if (event.target.matches("#youtube-input, #youtube-summary, #youtube-asset-url, #youtube-publish-at, [data-youtube-param], [data-youtube-asset-ref], [data-youtube-check]")) saveYoutubeDraft();
  });
  app.addEventListener("change", (event) => {
    if (event.target.matches("#youtube-content-select")) {
      saveYoutubeDraft();
      activeYoutubeContentId = event.target.value;
      activeYoutubeStageId = "";
      youtubeLastOutput = null;
      youtubeUploadAssets = {};
      renderYoutube();
    }
    if (event.target.matches("#youtube-privacy-status")) saveYoutubeDraft();
    if (event.target.matches("[data-youtube-upload]")) {
      const kind = event.target.dataset.youtubeUpload;
      const label = document.querySelector(`[data-youtube-file-name="${kind}"]`);
      if (label) label.textContent = event.target.files?.[0] ? `${event.target.files[0].name} · ${(event.target.files[0].size / 1024 / 1024).toFixed(1)}MB` : "선택된 파일 없음";
      delete youtubeUploadAssets[kind];
    }
    if (event.target.matches("#youtube-input-file")) {
      importYoutubeTextFile(event.target.files[0]).catch((error) => {
        const feedback = document.querySelector("#youtube-feedback");
        if (feedback) { feedback.textContent = error.message; feedback.className = "youtube-feedback is-error"; }
      });
      event.target.value = "";
    }
    if (event.target.matches("#meeting-destination, #meeting-date")) setMeetingPath();
    if (event.target.matches("#meeting-audio-upload")) {
      importMeetingAudio([...event.target.files]).catch((error) => meetingFeedback(error.message, "error"));
      event.target.value = "";
    }
  });
  drawerContent.addEventListener("click", (event) => {
    const youtubeTarget = event.target.closest("[data-youtube-task]");
    if (youtubeTarget) {
      activeYoutubeContentId = youtubeTarget.dataset.youtubeTask;
      activeYoutubeStageId = youtubeTarget.dataset.youtubeStage || "";
      closeDrawer();
      location.hash = "youtube";
      return;
    }
    const submitTarget = event.target.closest("[data-submit-mode]");
    if (submitTarget) openSubmitModal(submitTarget.dataset.contentId, submitTarget.dataset.submitMode);
  });
  document.querySelector("#drawer-close").addEventListener("click", closeDrawer);
  drawerBackdrop.addEventListener("click", closeDrawer);
  document.querySelector("#submit-close").addEventListener("click", closeSubmitModal);
  submitBackdrop.addEventListener("click", closeSubmitModal);
  submitForm.addEventListener("submit", submitWork);
  sessionStatusButton.addEventListener("click", openSessionModal);
  sessionForm.addEventListener("submit", connectWorkSession);
  document.querySelector("#session-close").addEventListener("click", closeSessionModal);
  sessionBackdrop.addEventListener("click", closeSessionModal);
  window.addEventListener("keydown", (event) => {
    if (event.key !== "Escape") return;
    closeDrawer();
    closeSessionModal();
  });
  window.addEventListener("hashchange", () => {
    if (meetingRecordingActive && location.hash !== "#meetings") stopMeetingRecording();
    if (currentView === "youtube") saveYoutubeDraft();
    currentView = location.hash.replace("#", "") || "dashboard";
    if (currentView !== "youtube") youtubeRequestSerial += 1;
    render();
  });
}

async function boot() {
  try {
    const [response, automationResponse, sessionResponse] = await Promise.all([
      fetch("/data/os-index.json", { cache: "no-store" }),
      fetch("/api/automation", { cache: "no-store" }).catch(() => null),
      fetch("/api/session", { cache: "no-store", credentials: "same-origin" }).catch(() => null),
    ]);
    if (!response.ok) throw new Error(`OS index ${response.status}`);
    index = await response.json();
    if (automationResponse?.ok) {
      const automationStatus = await automationResponse.json().catch(() => ({}));
      automationConnectors = automationStatus.connectors || {};
    }
    if (sessionResponse?.ok) {
      const sessionStatus = await sessionResponse.json().catch(() => ({}));
      workSession = sessionStatus.authenticated ? sessionStatus : workSession;
    }
    const owners = index.owners.includes(currentUser) ? index.owners : [currentUser, ...index.owners];
    userSelect.innerHTML = owners.map((owner) => `<option value="${escapeHtml(owner)}" ${owner === currentUser ? "selected" : ""}>${escapeHtml(owner)}</option>`).join("");
    syncTime.textContent = `Index ${formatDate(index.generatedAt)}`;
    if (workSession.authenticated && workSession.actor !== currentUser) {
      fetch("/api/session", { method: "DELETE", credentials: "same-origin" }).catch(() => {});
      workSession = { authenticated: false, actor: null, expiresAt: null };
    }
    updateSessionStatus();
    bindEvents();
    render();
  } catch (error) {
    console.error(error);
    app.innerHTML = emptyState("Repository 인덱스를 읽지 못했습니다", "배포 빌드와 web/data/os-index.json을 확인해주세요.");
  }
}

boot();
