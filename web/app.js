const app = document.querySelector("#app");
const pageTitle = document.querySelector("#page-title");
const userSelect = document.querySelector("#user-select");
const taskCount = document.querySelector("#task-count");
const approvalCount = document.querySelector("#approval-count");
const rawCount = document.querySelector("#raw-count");
const syncTime = document.querySelector("#sync-time");
const sidebar = document.querySelector("#sidebar");
const drawer = document.querySelector("#drawer");
const drawerBackdrop = document.querySelector("#drawer-backdrop");
const drawerContent = document.querySelector("#drawer-content");
const submitModal = document.querySelector("#submit-modal");
const submitBackdrop = document.querySelector("#submit-backdrop");
const submitForm = document.querySelector("#submit-form");
const submitFeedback = document.querySelector("#submit-feedback");
const promoteModal = document.querySelector("#promote-modal");
const promoteBackdrop = document.querySelector("#promote-backdrop");
const promoteForm = document.querySelector("#promote-form");
const promoteFeedback = document.querySelector("#promote-feedback");

const viewTitles = {
  dashboard: "전체 업무 공정",
  tasks: "내가 할 일",
  contents: "콘텐츠 Run",
  approvals: "결재함",
  raw: "Raw Hub",
  wiki: "Wiki",
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
  raw: "Raw",
  promoted: "Wiki 승격됨",
};

let index = null;
let currentView = location.hash.replace("#", "") || "dashboard";
let currentUser = localStorage.getItem("ba-os-user") || "ricky";
let activeSkillFilter = "all";

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

function knowledgeFlow(active) {
  return `<section class="knowledge-flow" aria-label="지식이 실행 규격이 되는 흐름">
    <div class="flow-node ${active === "raw" ? "is-active" : ""}"><span>01</span><strong>Raw</strong><small>개인·회사 작업 기록</small></div><i>→</i>
    <div class="flow-node ${active === "wiki" ? "is-active" : ""}"><span>02</span><strong>Wiki</strong><small>현재 재사용할 정본</small></div><i>→</i>
    <div class="flow-node ${active === "skills" ? "is-active" : ""}"><span>03</span><strong>Skill</strong><small>실행 절차와 품질 기준</small></div>
  </section>`;
}

function rawCards(items) {
  if (!items.length) return emptyState("Raw가 없습니다", "작업 기록을 추가하면 이곳에 표시됩니다.");
  return `<div class="knowledge-grid">${items.map((raw) => {
    const canPromote = raw.owner === currentUser;
    return `<article class="knowledge-card">
      <header><div><span class="eyebrow">${escapeHtml(raw.scope === "company" ? "COMPANY RAW" : `${raw.owner} RAW`)}</span><h3>${escapeHtml(raw.title)}</h3></div>${statusBadge(raw.status)}</header>
      <p>${escapeHtml(raw.excerpt)}</p>
      <div class="knowledge-meta"><span>분류 · ${escapeHtml(raw.category)}</span><span>v${escapeHtml(raw.version)}</span><span>${escapeHtml(formatDate(raw.updatedAt))}</span></div>
      <footer>${ownerBadge(raw.owner)}<button class="promote-action" data-promote-id="${escapeHtml(raw.id)}" ${canPromote ? "" : "disabled"}>${canPromote ? "Wiki로 승격 →" : `${escapeHtml(raw.owner)}만 승격 가능`}</button></footer>
      ${raw.promotedTo ? `<small class="provenance">현재 연결 · ${escapeHtml(raw.promotedTo)}</small>` : ""}
    </article>`;
  }).join("")}</div>`;
}

function renderRaw() {
  const mine = index.rawItems.filter((item) => item.scope !== "company" && item.owner === currentUser);
  const company = index.rawItems.filter((item) => item.scope === "company");
  app.innerHTML = `${knowledgeFlow("raw")}
    <section class="section">${sectionHead("내 Raw", "실무 중 생긴 메모와 시행착오를 쌓고, 재사용할 가치가 생기면 직접 Wiki로 승격합니다.")}${rawCards(mine)}</section>
    <section class="section">${sectionHead("Company Raw", "운영, 의사결정 과정, 회의록과 데이터의 근거 자료입니다.")}${rawCards(company)}</section>`;
}

function wikiCards(items) {
  if (!items.length) return emptyState("Wiki가 없습니다", "Raw를 승격하면 최신 Wiki가 이곳에 표시됩니다.");
  return `<div class="knowledge-grid">${items.map((wiki) => `<article class="knowledge-card wiki-card">
    <header><div><span class="eyebrow">${escapeHtml(wiki.wikiType === "company" ? "COMPANY WIKI" : "PRACTICE WIKI")}</span><h3>${escapeHtml(wiki.title)}</h3></div><span class="version-pill">v${escapeHtml(wiki.version)}</span></header>
    <p>${escapeHtml(wiki.excerpt)}</p>
    <div class="knowledge-meta"><span>분류 · ${escapeHtml(wiki.category)}</span><span>승격자 · ${escapeHtml(wiki.promotedBy)}</span><span>${escapeHtml(formatDate(wiki.promotedAt))}</span></div>
    <footer>${ownerBadge(wiki.owner)}<span class="source-count">Raw 근거 ${wiki.sourceIds.length}개</span></footer>
  </article>`).join("")}</div>`;
}

function renderWiki() {
  app.innerHTML = `${knowledgeFlow("wiki")}
    <section class="section">${sectionHead("Company Wiki", "현재 회사가 따라야 할 확정된 운영 기준과 의사결정입니다.")}${wikiCards(index.wikiItems.filter((item) => item.wikiType === "company"))}</section>
    <section class="section">${sectionHead("실무 Wiki", "직원이 반복해서 재사용할 수 있는 검증된 실무 지식입니다.")}${wikiCards(index.wikiItems.filter((item) => item.wikiType !== "company"))}</section>`;
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
  const selectedLabel = selectedFolder?.label || selectedCategory?.label || "전체 Skill";
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
        <p>${escapeHtml(skill.purpose || "업무 수행 방법과 결과물 규격을 정의합니다.")}</p>
        <div class="skill-file-meta"><span>담당 · ${escapeHtml(skill.owner)}</span><span>${escapeHtml(skill.process)} / ${escapeHtml(skill.step)}</span><span>도구 ${skill.tools.length}개</span></div>
        <div class="chip-row">${skill.tools.map((tool) => `<span class="chip">${escapeHtml(tool)}</span>`).join("") || '<span class="chip">human</span>'}</div>
        <details class="skill-detail"><summary>실행 규격 펼치기</summary><div><strong>읽을 Context</strong><p>${escapeHtml(skill.readContext || "SKILL.md 참고")}</p><strong>작업 절차</strong><p>${escapeHtml(skill.procedure || "SKILL.md 참고")}</p><strong>Output Contract</strong><p>${escapeHtml(skill.outputContract || "SKILL.md 참고")}</p><strong>품질 기준</strong><p>${escapeHtml(skill.qualityCriteria || "SKILL.md 참고")}</p></div></details>
        <footer><span>${escapeHtml(skill.repositoryPath)}</span><a href="${escapeHtml(skill.downloadUrl)}" download>SKILL.md 받기 ↓</a></footer>
      </div>
    </article>`).join("")}</div>` : emptyState("이 폴더에는 아직 Skill이 없습니다", "새 Skill이 등록되면 폴더에 자동으로 표시됩니다.");
  const connectionRows = visibleSkills.map((skill) => `<tr><td><strong>${escapeHtml(skill.id)}</strong></td><td>${escapeHtml(skill.categoryLabel)} · ${escapeHtml(skill.folderLabel)}</td><td>${escapeHtml(skill.process)} / ${escapeHtml(skill.step)}</td><td>${ownerBadge(skill.owner)}</td><td><span class="status" data-status="${escapeHtml(skill.status)}">${escapeHtml(statusLabel(skill.status))}</span></td></tr>`).join("");

  app.innerHTML = `
    <section class="skill-library-head"><div><p>SKILL LIBRARY</p><h2>업무 스킬</h2><span>AI와 직원이 업무를 수행할 때 사용하는 절차, 결과물 규격과 품질 기준을 폴더별로 관리합니다.</span></div><div class="skill-source"><small>SOURCE OF TRUTH</small><strong>GitHub Cloud</strong><span>버전 · 복구 · 이력 관리</span></div></section>
    <div class="skill-library-layout">
      <aside class="skill-tree-panel">
        <button class="skill-tree-all ${activeSkillFilter === "all" ? "is-active" : ""}" data-skill-filter="all"><span>✦ 전체 Skill</span><em>${index.skills.length}</em></button>
        ${folderTree}
      </aside>
      <section class="skill-browser">
        <header class="skill-browser-head"><div><p>선택한 폴더</p><h2>${escapeHtml(selectedLabel)}</h2><span>${visibleSkills.length}개의 Skill</span></div><span class="folder-path">04_skills / ${escapeHtml(selectedCategory?.id || "all")}${selectedFolder ? ` / ${escapeHtml(selectedFolder.id)}` : ""}</span></header>
        ${cards}
        ${visibleSkills.length ? `<section class="skill-connection"><header><h2>공정 연결 현황</h2><p>각 Skill이 어떤 공정과 담당자에게 연결되어 있는지 확인합니다.</p></header><div class="panel table-wrap"><table class="table"><thead><tr><th>Skill</th><th>폴더</th><th>연결 공정</th><th>담당자</th><th>상태</th></tr></thead><tbody>${connectionRows}</tbody></table></div></section>` : ""}
      </section>
    </div>`;
}

function render() {
  if (!viewTitles[currentView]) currentView = "dashboard";
  pageTitle.textContent = viewTitles[currentView];
  document.querySelectorAll(".nav-item").forEach((button) => button.classList.toggle("is-active", button.dataset.view === currentView));
  ({ dashboard: renderDashboard, tasks: renderTasks, contents: renderContents, approvals: renderApprovals, raw: renderRaw, wiki: renderWiki, skills: renderSkills })[currentView]();
  taskCount.textContent = tasksForUser().length;
  approvalCount.textContent = index.approvals.length;
  rawCount.textContent = index.rawItems.filter((item) => item.owner === currentUser && item.status === "raw").length;
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

function openPromoteModal(rawId) {
  const raw = index.rawItems.find((item) => item.id === rawId);
  if (!raw || raw.owner !== currentUser) return;
  document.querySelector("#promote-raw-id").value = raw.id;
  document.querySelector("#promote-raw-path").value = raw.path;
  document.querySelector("#promote-description").textContent = `${raw.title} · ${raw.owner} → ${raw.scope === "company" ? "Company Wiki" : "실무 Wiki"}`;
  document.querySelector("#promote-secret").value = sessionStorage.getItem("ba-os-push-secret") || "";
  promoteFeedback.textContent = "";
  promoteFeedback.className = "submit-feedback";
  promoteBackdrop.hidden = false;
  promoteModal.classList.add("is-open");
  promoteModal.setAttribute("aria-hidden", "false");
  document.querySelector("#promote-summary").focus();
}

function closePromoteModal() {
  promoteModal.classList.remove("is-open");
  promoteModal.setAttribute("aria-hidden", "true");
  promoteBackdrop.hidden = true;
}

async function promoteRaw(event) {
  event.preventDefault();
  const button = document.querySelector("#promote-button");
  const secret = document.querySelector("#promote-secret").value;
  button.disabled = true;
  button.textContent = "Wiki 새 버전을 만드는 중…";
  promoteFeedback.textContent = "";
  try {
    const response = await fetch("/api/promote", { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${secret}` }, body: JSON.stringify({ rawId: document.querySelector("#promote-raw-id").value, rawPath: document.querySelector("#promote-raw-path").value, actor: currentUser, summary: document.querySelector("#promote-summary").value.trim() }) });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(result.error || "Wiki 승격에 실패했습니다.");
    sessionStorage.setItem("ba-os-push-secret", secret);
    promoteFeedback.textContent = `Wiki v${result.version} 생성 완료. 자동 배포 후 화면에 반영됩니다.`;
    promoteFeedback.className = "submit-feedback is-success";
    button.textContent = "승격 완료";
  } catch (error) {
    promoteFeedback.textContent = error.message;
    promoteFeedback.className = "submit-feedback is-error";
    button.disabled = false;
    button.textContent = "검토 없이 Wiki로 승격";
  }
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
    const promoteTarget = event.target.closest("[data-promote-id]");
    if (promoteTarget) openPromoteModal(promoteTarget.dataset.promoteId);
    const skillFilter = event.target.closest("[data-skill-filter]");
    if (skillFilter) {
      activeSkillFilter = skillFilter.dataset.skillFilter;
      renderSkills();
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
  document.querySelector("#promote-close").addEventListener("click", closePromoteModal);
  promoteBackdrop.addEventListener("click", closePromoteModal);
  promoteForm.addEventListener("submit", promoteRaw);
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
