const app = document.querySelector("#app");
const pageTitle = document.querySelector("#page-title");
const userSelect = document.querySelector("#user-select");
const taskCount = document.querySelector("#task-count");
const approvalCount = document.querySelector("#approval-count");
const peopleCount = document.querySelector("#people-count");
const syncTime = document.querySelector("#sync-time");
const sidebar = document.querySelector("#sidebar");
const drawer = document.querySelector("#drawer");
const drawerBackdrop = document.querySelector("#drawer-backdrop");
const drawerContent = document.querySelector("#drawer-content");
const submitModal = document.querySelector("#submit-modal");
const submitBackdrop = document.querySelector("#submit-backdrop");
const submitForm = document.querySelector("#submit-form");
const submitFeedback = document.querySelector("#submit-feedback");

const viewTitles = {
  dashboard: "전체 업무 공정",
  tasks: "내가 할 일",
  contents: "콘텐츠 Run",
  approvals: "결재함",
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
};

let index = null;
let currentView = location.hash.replace("#", "") || "dashboard";
let currentUser = localStorage.getItem("ba-os-user") || "ricky";
let activeSkillFilter = "all";
let activeWikiFilter = "all";

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
      <div class="hero-copy"><p class="hero-kicker">SHARED CONTEXT OPERATING SYSTEM</p><h2>각자의 맥락을 회사의 실행력으로</h2><p>개인 Obsidian에서 정리한 Wiki를 회사 공정과 연결하고, 각자의 AI가 필요한 최신 맥락을 불러와 일하게 합니다.</p></div>
      <div class="hero-side"><strong>${summary.activeCount}</strong><span>현재 진행 중인 Content Run</span></div>
    </section>
    <section class="stat-grid">
      <article class="stat-card"><header><span>진행 중</span><i>→</i></header><strong>${summary.activeCount}</strong><small>완료·보관 제외</small></article>
      <article class="stat-card"><header><span>직원 Workspace</span><i>◫</i></header><strong>${summary.peopleCount}</strong><small>업무·Wiki·Skill 연결</small></article>
      <article class="stat-card"><header><span>공유 Wiki</span><i>▣</i></header><strong>${summary.wikiCount}</strong><small>회사 OS 최신 정본</small></article>
      <article class="stat-card"><header><span>Access Skill</span><i>✦</i></header><strong>${summary.skillCount}</strong><small>맥락 불러오기 규칙</small></article>
    </section>
    <section class="section">${sectionHead("OS가 일하는 방식", "개인의 맥락 관리와 회사 공정 실행을 분리하고 최신 Wiki로 연결합니다.")}${osContextFlow()}</section>
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
  if (!viewTitles[currentView]) currentView = "dashboard";
  pageTitle.textContent = viewTitles[currentView];
  document.querySelectorAll(".nav-item").forEach((button) => button.classList.toggle("is-active", button.dataset.view === currentView));
  ({ dashboard: renderDashboard, tasks: renderTasks, contents: renderContents, approvals: renderApprovals, people: renderPeople, wiki: renderWiki, skills: renderSkills })[currentView]();
  taskCount.textContent = tasksForUser().length;
  approvalCount.textContent = index.approvals.length;
  peopleCount.textContent = index.people.length;
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
      <a class="primary-action" href="${escapeHtml(content.workPackageUrl || "#")}" download="${escapeHtml(content.id)}_WORK_PACKAGE.md" ${content.workPackageUrl ? "" : 'aria-disabled="true"'}>↓ 작업 시작</a>
      <button class="secondary-action" data-submit-mode="submit" data-content-id="${escapeHtml(content.id)}">↑ 작업 제출</button>
      <button class="review-action" data-submit-mode="review" data-content-id="${escapeHtml(content.id)}">◇ 승인 요청</button>
    </div>
    <p class="work-help">작업 시작은 최신 Context와 Skill을 내려받고, 제출·승인 요청은 결과 정보를 Repository에 기록합니다.</p>
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
  document.querySelector("#submit-content-id").value = content.id;
  document.querySelector("#submit-step").value = content.currentStep;
  document.querySelector("#submit-mode").value = mode;
  document.querySelector("#submit-title").textContent = mode === "review" ? "승인 요청" : "작업 제출";
  document.querySelector("#submit-description").textContent = `${content.id} · ${content.currentStep} · ${currentUser}`;
  document.querySelector("#submit-secret").value = sessionStorage.getItem("ba-os-push-secret") || "";
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
  });
  drawerContent.addEventListener("click", (event) => {
    const submitTarget = event.target.closest("[data-submit-mode]");
    if (submitTarget) openSubmitModal(submitTarget.dataset.contentId, submitTarget.dataset.submitMode);
  });
  document.querySelector("#drawer-close").addEventListener("click", closeDrawer);
  drawerBackdrop.addEventListener("click", closeDrawer);
  document.querySelector("#submit-close").addEventListener("click", closeSubmitModal);
  submitBackdrop.addEventListener("click", closeSubmitModal);
  submitForm.addEventListener("submit", submitWork);
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
