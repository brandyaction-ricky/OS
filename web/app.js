const app = document.querySelector("#app");
const pageTitle = document.querySelector("#page-title");
const userSelect = document.querySelector("#user-select");
const taskCount = document.querySelector("#task-count");
const approvalCount = document.querySelector("#approval-count");
const syncTime = document.querySelector("#sync-time");
const sidebar = document.querySelector("#sidebar");
const drawer = document.querySelector("#drawer");
const drawerBackdrop = document.querySelector("#drawer-backdrop");
const drawerContent = document.querySelector("#drawer-content");

const viewTitles = {
  dashboard: "전체 업무 공정",
  tasks: "내가 할 일",
  contents: "콘텐츠 Run",
  approvals: "결재함",
  skills: "Skill Library",
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
};

let index = null;
let currentView = location.hash.replace("#", "") || "dashboard";
let currentUser = localStorage.getItem("ba-os-user") || "ricky";

function escapeHtml(value) {
  return String(value ?? "-")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
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

function renderDashboard() {
  const summary = index.summary;
  const lead = index.contents[0];
  const process = dominantProcess();
  app.innerHTML = `
    <section class="hero">
      <div class="hero-copy"><p class="hero-kicker">CONTEXT & CONTROL LAYER</p><h2>회사의 일을 하나의 흐름으로</h2><p>최신 맥락, 작업 상태, 승인, 버전을 Git + Markdown 정본으로 관리합니다.</p></div>
      <div class="hero-side"><strong>${summary.activeCount}</strong><span>현재 진행 중인 Content Run</span></div>
    </section>
    <section class="stat-grid">
      <article class="stat-card"><header><span>전체 콘텐츠</span><i>▤</i></header><strong>${summary.contentCount}</strong><small>Repository 기준</small></article>
      <article class="stat-card"><header><span>진행 중</span><i>→</i></header><strong>${summary.activeCount}</strong><small>완료·보관 제외</small></article>
      <article class="stat-card"><header><span>승인 대기</span><i>◇</i></header><strong>${summary.approvalCount}</strong><small>대표 의사결정 필요</small></article>
      <article class="stat-card"><header><span>Skill</span><i>✦</i></header><strong>${summary.skillCount}</strong><small>활성 Skill Library</small></article>
    </section>
    <section class="section">${sectionHead("Longform 전체 공정", "기획부터 성과 회수까지의 표준 공정")}${processFlow(process, lead)}</section>
    <section class="section">${sectionHead("최근 Content Run", "최근 업데이트된 업무부터 표시합니다.", '<button data-go="contents">전체 보기 →</button>')}${contentTable(index.contents.slice(0, 5))}</section>`;
}

function tasksForUser() {
  return index.contents.filter((content) => content.owner === currentUser && !["completed", "archived"].includes(content.status));
}

function renderTasks() {
  const tasks = tasksForUser();
  app.innerHTML = `${sectionHead(`${currentUser}의 할 일`, "CONTENT.md의 현재 담당자와 다음 행동을 기준으로 표시합니다.")}
    ${tasks.length ? `<div class="task-list">${tasks.map((content) => `
      <article class="task-card" data-content-id="${escapeHtml(content.id)}">
        <span class="task-number">${escapeHtml(content.id.replace("BA-", ""))}</span>
        <div><h3>${escapeHtml(content.nextAction)}</h3><p>${escapeHtml(content.title)} · ${escapeHtml(content.currentStep)}</p></div>
        <time>${escapeHtml(formatDate(content.updatedAt))}</time>
      </article>`).join("")}</div>` : emptyState("배정된 업무가 없습니다", `${currentUser} 담당으로 지정된 진행 업무가 없습니다.`)}`;
}

function renderContents() {
  app.innerHTML = `${sectionHead("전체 Content Run", "콘텐츠의 현재 상태, 담당자, 다음 행동을 확인합니다.")}${contentTable(index.contents)}`;
}

function renderApprovals() {
  app.innerHTML = `${sectionHead("결재함", "검수 또는 승인 상태인 Content Run만 표시합니다.")}${index.approvals.length ? contentTable(index.approvals) : emptyState("대기 중인 결재가 없습니다", "승인 요청이 Push되면 자동으로 표시됩니다.")}`;
}

function renderSkills() {
  app.innerHTML = `${sectionHead("Skill Library", "읽을 Context, 작업 절차, Output Contract와 품질 기준의 모음")}
    <div class="skill-grid">${index.skills.map((skill) => `
      <article class="skill-card">
        <header><h3>${escapeHtml(skill.id)}</h3><span class="tag">v${escapeHtml(skill.version)}</span></header>
        <p>${escapeHtml(skill.purpose || "업무 수행 방법과 결과물 규격을 정의합니다.")}</p>
        <div class="chip-row">${skill.tools.map((tool) => `<span class="chip">${escapeHtml(tool)}</span>`).join("") || '<span class="chip">human</span>'}</div>
        <footer class="skill-foot"><span>${escapeHtml(skill.process)} / ${escapeHtml(skill.step)}</span><span>${escapeHtml(skill.status)}</span></footer>
      </article>`).join("")}</div>`;
}

function render() {
  if (!viewTitles[currentView]) currentView = "dashboard";
  pageTitle.textContent = viewTitles[currentView];
  document.querySelectorAll(".nav-item").forEach((button) => button.classList.toggle("is-active", button.dataset.view === currentView));
  ({ dashboard: renderDashboard, tasks: renderTasks, contents: renderContents, approvals: renderApprovals, skills: renderSkills })[currentView]();
  taskCount.textContent = tasksForUser().length;
  approvalCount.textContent = index.approvals.length;
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
    <div class="timeline"><h3>공정 진행 상태</h3>${content.steps.map((step) => {
      const state = ["approved", "completed"].includes(step.status) ? "is-done" : step.id === content.currentStep ? "is-current" : "";
      return `<div class="timeline-item ${state}"><i class="timeline-dot"></i><strong>${escapeHtml(step.label)}</strong><span>${escapeHtml(step.owner)} · ${escapeHtml(statusLabel(step.status))}</span></div>`;
    }).join("")}</div>`;
  drawerBackdrop.hidden = false;
  drawer.classList.add("is-open");
  drawer.setAttribute("aria-hidden", "false");
}

function closeDrawer() {
  drawer.classList.remove("is-open");
  drawer.setAttribute("aria-hidden", "true");
  setTimeout(() => { drawerBackdrop.hidden = true; }, 220);
}

function bindEvents() {
  document.querySelectorAll(".nav-item").forEach((button) => button.addEventListener("click", () => {
    currentView = button.dataset.view;
    location.hash = currentView;
  }));
  document.querySelector("#mobile-menu").addEventListener("click", () => sidebar.classList.toggle("is-open"));
  userSelect.addEventListener("change", () => {
    currentUser = userSelect.value;
    localStorage.setItem("ba-os-user", currentUser);
    render();
  });
  app.addEventListener("click", (event) => {
    const contentTarget = event.target.closest("[data-content-id]");
    if (contentTarget) openDrawer(contentTarget.dataset.contentId);
    const viewTarget = event.target.closest("[data-go]");
    if (viewTarget) location.hash = viewTarget.dataset.go;
  });
  document.querySelector("#drawer-close").addEventListener("click", closeDrawer);
  drawerBackdrop.addEventListener("click", closeDrawer);
  window.addEventListener("keydown", (event) => { if (event.key === "Escape") closeDrawer(); });
  window.addEventListener("hashchange", () => {
    currentView = location.hash.replace("#", "") || "dashboard";
    render();
  });
}

async function boot() {
  try {
    const response = await fetch("/data/os-index.json", { cache: "no-store" });
    if (!response.ok) throw new Error(`OS index ${response.status}`);
    index = await response.json();
    const owners = index.owners.includes(currentUser) ? index.owners : [currentUser, ...index.owners];
    userSelect.innerHTML = owners.map((owner) => `<option value="${escapeHtml(owner)}" ${owner === currentUser ? "selected" : ""}>${escapeHtml(owner)}</option>`).join("");
    syncTime.textContent = `Index ${formatDate(index.generatedAt)}`;
    bindEvents();
    render();
  } catch (error) {
    console.error(error);
    app.innerHTML = emptyState("Repository 인덱스를 읽지 못했습니다", "배포 빌드와 web/data/os-index.json을 확인해주세요.");
  }
}

boot();
