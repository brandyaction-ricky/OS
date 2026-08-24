import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(scriptDirectory, "..");
const checkOnly = process.argv.includes("--check");

function parseScalar(rawValue) {
  const value = rawValue.trim();
  if (value === "null" || value === "~") return null;
  if (value === "true") return true;
  if (value === "false") return false;
  if (/^-?\d+(\.\d+)?$/.test(value)) return Number(value);
  if (value.startsWith("[") && value.endsWith("]")) {
    return value
      .slice(1, -1)
      .split(",")
      .map((item) => parseScalar(item))
      .filter((item) => item !== "");
  }
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1);
  }
  return value;
}

function splitMarkdown(text) {
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  if (lines[0] !== "---") return { frontmatter: [], body: text };
  const closing = lines.indexOf("---", 1);
  if (closing < 0) return { frontmatter: [], body: text };
  return {
    frontmatter: lines.slice(1, closing),
    body: lines.slice(closing + 1).join("\n"),
  };
}

function parseTopLevel(frontmatterLines) {
  const result = {};
  for (const line of frontmatterLines) {
    if (/^\s/.test(line)) continue;
    const match = line.match(/^([A-Za-z0-9_]+):(?:\s*(.*))?$/);
    if (!match) continue;
    result[match[1]] = parseScalar(match[2] ?? "");
  }
  return result;
}

function section(body, heading) {
  const lines = body.replace(/\r\n/g, "\n").split("\n");
  const start = lines.findIndex((line) => line.trim() === `## ${heading}`);
  if (start < 0) return "";
  const candidates = lines.slice(start + 1);
  const end = candidates.findIndex((line) => line.startsWith("## "));
  return (end >= 0 ? candidates.slice(0, end) : candidates)
    .find((line) => line.trim() && !line.trim().startsWith("<!--"))
    ?.trim() ?? "";
}

function sectionText(body, heading) {
  const lines = body.replace(/\r\n/g, "\n").split("\n");
  const start = lines.findIndex((line) => line.trim() === `## ${heading}`);
  if (start < 0) return "";
  const candidates = lines.slice(start + 1);
  const end = candidates.findIndex((line) => line.startsWith("## "));
  return (end >= 0 ? candidates.slice(0, end) : candidates).join("\n").trim();
}

function excerpt(body) {
  return body
    .replace(/\r\n/g, "\n")
    .split("\n")
    .filter((line) => line.trim() && !line.startsWith("#") && !line.startsWith("<!--"))
    .slice(0, 2)
    .join(" ")
    .slice(0, 220);
}

function parseProcessSteps(frontmatterLines) {
  const steps = [];
  let current = null;
  let inSteps = false;
  for (const line of frontmatterLines) {
    if (line === "steps:") {
      inSteps = true;
      continue;
    }
    if (!inSteps) continue;
    const start = line.match(/^  - id:\s*(.+)$/);
    if (start) {
      current = { id: parseScalar(start[1]) };
      steps.push(current);
      continue;
    }
    if (!current) continue;
    const field = line.match(/^    ([A-Za-z0-9_]+):\s*(.*)$/);
    if (field && !["outputs", "completion"].includes(field[1])) {
      current[field[1]] = parseScalar(field[2]);
    }
  }
  return steps.sort((a, b) => Number(a.order ?? 0) - Number(b.order ?? 0));
}

async function directories(root) {
  try {
    const entries = await readdir(root, { withFileTypes: true });
    return entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort();
  } catch {
    return [];
  }
}

async function markdownFiles(root) {
  const results = [];
  async function visit(directory) {
    let entries = [];
    try {
      entries = await readdir(directory, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const absolute = path.join(directory, entry.name);
      if (entry.isDirectory()) await visit(absolute);
      if (entry.isFile() && entry.name.endsWith(".md")) results.push(absolute);
    }
  }
  await visit(root);
  return results.sort();
}

async function readIfExists(filePath) {
  try {
    return await readFile(filePath, "utf8");
  } catch {
    return "";
  }
}

function quoteBlock(title, source) {
  if (!source) return "";
  return `\n\n---\n\n# ${title}\n\n${source.trim()}\n`;
}

async function writeWorkPackage(content, process, source, metadata, skillPathById, skills, wikiItems) {
  if (checkOnly) return null;
  const step = process?.steps.find((item) => item.id === content.currentStep);
  if (!step) return null;

  const files = [];
  const addFile = async (label, relativePath) => {
    if (!relativePath) return;
    const text = await readIfExists(path.join(repositoryRoot, relativePath));
    if (text) files.push({ label, path: relativePath, text });
  };

  await addFile("회사 Context", "01_company/context/COMPANY.md");
  await addFile("브랜드 Context", `02_brands/${content.brandId}/context/BRAND.md`);
  await addFile("콘텐츠 현재 상태", `05_contents/${content.id}/CONTENT.md`);
  await addFile("공정 정의", `03_processes/${content.type}/PROCESS.md`);
  if (step.skillId) await addFile("현재 단계 Skill", skillPathById.get(step.skillId));
  const activeSkill = skills.find((skill) => skill.id === step.skillId);
  for (const wikiId of activeSkill?.wikiSources ?? []) {
    const wiki = wikiItems.find((item) => item.wikiId === wikiId);
    if (wiki) await addFile(`최신 Wiki · ${wiki.title}`, wiki.path);
  }
  for (const pointer of step.inputPointers ?? []) {
    const relative = metadata[pointer];
    if (relative) await addFile(`입력 · ${pointer}`, `05_contents/${content.id}/${relative}`);
  }

  const header = `---
schema_version: "1.0"
entity_type: work_package
content_id: ${content.id}
step: ${content.currentStep}
owner: ${content.owner}
generated_at: ${new Date().toISOString()}
---

# ${content.id} 작업 패키지

- 콘텐츠: ${content.title}
- 현재 단계: ${step.label ?? step.id}
- 작업자: ${content.owner}
- 다음 행동: ${content.nextAction}
- Skill: ${step.skillId ?? "human"}

이 파일을 작업 도구(Codex, Claude Code, Obsidian 등)에 전달하고 작업하세요.
완료 후 BrandyAction OS의 **작업 제출** 버튼으로 결과 요약과 자산 링크를 등록합니다.`;
  const workPackage = `${header}${files.map((file) => quoteBlock(`${file.label} · ${file.path}`, file.text)).join("")}\n`;
  const outputDirectory = path.join(repositoryRoot, "web", "workspaces", content.id);
  await mkdir(outputDirectory, { recursive: true });
  await writeFile(path.join(outputDirectory, "WORK_PACKAGE.md"), workPackage, "utf8");
  return `/workspaces/${content.id}/WORK_PACKAGE.md`;
}

async function buildIndex() {
  const processRoot = path.join(repositoryRoot, "03_processes");
  const skillRoot = path.join(repositoryRoot, "04_skills");
  const contentRoot = path.join(repositoryRoot, "05_contents");
  const peopleRoot = path.join(repositoryRoot, "08_people");
  const wikiRoot = path.join(repositoryRoot, "10_wiki");
  const categorySource = await readFile(path.join(skillRoot, "CATEGORIES.json"), "utf8");
  const categoryRegistry = JSON.parse(categorySource).categories ?? [];

  const processes = [];
  for (const processId of await directories(processRoot)) {
    const source = await readFile(path.join(processRoot, processId, "PROCESS.md"), "utf8");
    const { frontmatter } = splitMarkdown(source);
    const metadata = parseTopLevel(frontmatter);
    processes.push({
      id: metadata.process_id ?? processId,
      version: metadata.version ?? "-",
      status: metadata.status ?? "-",
      firstStep: metadata.first_step ?? null,
      steps: parseProcessSteps(frontmatter).map((step) => ({
        id: step.id,
        order: step.order,
        label: step.label,
        folder: step.folder,
        type: step.type,
        owner: step.default_owner,
        skillId: step.skill_id,
        inputPointers: step.input_pointers ?? [],
        workAction: step.work_action,
        reviewAction: step.review_action,
        nextStep: step.next_step,
      })),
    });
  }

  const skills = [];
  const skillPathById = new Map();
  const skillFiles = (await markdownFiles(skillRoot)).filter((filePath) => path.basename(filePath) === "SKILL.md");
  for (const skillPath of skillFiles) {
    const source = await readFile(skillPath, "utf8");
    const { frontmatter, body } = splitMarkdown(source);
    const metadata = parseTopLevel(frontmatter);
    const skillId = metadata.skill_id ?? path.basename(path.dirname(skillPath));
    const relativeSkillPath = path.relative(skillRoot, skillPath).replaceAll(path.sep, "/");
    if (skillPathById.has(skillId)) throw new Error(`중복 Skill ID입니다: ${skillId}`);
    skillPathById.set(skillId, `04_skills/${relativeSkillPath}`);
    const process = processes.find((item) => item.id === metadata.process);
    const processStep = process?.steps.find((item) => item.id === metadata.step);
    if (!checkOnly) {
      const outputDirectory = path.join(repositoryRoot, "web", "library", skillId);
      await mkdir(outputDirectory, { recursive: true });
      await writeFile(path.join(outputDirectory, "SKILL.md"), source, "utf8");
    }
    skills.push({
      id: metadata.skill_id ?? skillId,
      skillType: metadata.skill_type ?? "os_context_loader",
      version: metadata.version ?? "-",
      status: metadata.status ?? "-",
      process: metadata.process ?? "-",
      step: metadata.step ?? "-",
      tools: metadata.allowed_tools ?? [],
      inputs: metadata.inputs ?? [],
      outputs: metadata.outputs ?? [],
      purpose: section(body, "PURPOSE"),
      readContext: sectionText(body, "READ CONTEXT"),
      procedure: sectionText(body, "PROCEDURE"),
      outputContract: sectionText(body, "OUTPUT CONTRACT"),
      qualityCriteria: sectionText(body, "QUALITY CRITERIA"),
      handoff: sectionText(body, "HANDOFF"),
      owner: metadata.owner ?? processStep?.owner ?? "-",
      wikiSources: metadata.wiki_sources ?? [],
      categoryId: metadata.category_id ?? "unclassified",
      categoryLabel: metadata.category_label ?? "미분류",
      folderId: metadata.folder_id ?? "general",
      folderLabel: metadata.folder_label ?? "일반",
      repositoryPath: `04_skills/${relativeSkillPath}`,
      downloadUrl: `/library/${skillId}/SKILL.md`,
    });
  }

  const skillCategories = categoryRegistry
    .sort((a, b) => Number(a.order ?? 0) - Number(b.order ?? 0))
    .map((category) => ({
      ...category,
      count: skills.filter((skill) => skill.categoryId === category.id).length,
      folders: (category.folders ?? [])
        .sort((a, b) => Number(a.order ?? 0) - Number(b.order ?? 0))
        .map((folder) => ({
          ...folder,
          count: skills.filter((skill) => skill.categoryId === category.id && skill.folderId === folder.id).length,
        })),
    }));

  const wikiItems = [];
  for (const filePath of await markdownFiles(wikiRoot)) {
    const source = await readFile(filePath, "utf8");
    const { frontmatter, body } = splitMarkdown(source);
    const metadata = parseTopLevel(frontmatter);
    if (metadata.entity_type !== "wiki" || metadata.is_latest === false) continue;
    wikiItems.push({
      id: metadata.id,
      wikiId: metadata.wiki_id,
      title: metadata.title ?? "제목 없음",
      wikiType: metadata.wiki_type ?? "company",
      process: metadata.process ?? null,
      step: metadata.step ?? null,
      category: metadata.category ?? "-",
      owner: metadata.owner ?? "-",
      status: metadata.status ?? "active",
      version: metadata.version ?? 1,
      sourceIds: metadata.source_ids ?? [],
      promotedBy: metadata.promoted_by ?? null,
      promotedAt: metadata.promoted_at ?? null,
      updatedAt: metadata.updated_at ?? null,
      excerpt: excerpt(body),
      path: path.relative(repositoryRoot, filePath).replaceAll(path.sep, "/"),
    });
  }
  wikiItems.sort((a, b) => String(b.updatedAt ?? "").localeCompare(String(a.updatedAt ?? "")));

  const contents = [];
  for (const contentId of await directories(contentRoot)) {
    if (!/^BA-\d{4}$/.test(contentId)) continue;
    const source = await readFile(path.join(contentRoot, contentId, "CONTENT.md"), "utf8");
    const { frontmatter } = splitMarkdown(source);
    const metadata = parseTopLevel(frontmatter);
    const process = processes.find((item) => item.id === metadata.type);
    const content = {
      id: metadata.id ?? contentId,
      title: metadata.title ?? "제목 없음",
      type: metadata.type ?? "-",
      brandId: metadata.brand_id ?? "-",
      status: metadata.status ?? "-",
      currentStep: metadata.current_step ?? "-",
      owner: metadata.owner ?? "-",
      nextOwner: metadata.next_owner ?? null,
      nextAction: metadata.next_action ?? "-",
      updatedAt: metadata.updated_at ?? null,
      steps: (process?.steps ?? []).map((step) => ({
        id: step.id,
        label: step.label,
        owner: step.owner,
        status: metadata[`${step.id}_status`] ?? "-",
      })),
    };
    content.workPackageUrl = await writeWorkPackage(content, process, source, metadata, skillPathById, skills, wikiItems);
    contents.push(content);
  }

  contents.sort((a, b) => String(b.updatedAt ?? "").localeCompare(String(a.updatedAt ?? "")));
  const approvals = contents.filter((content) => {
    const current = content.steps.find((step) => step.id === content.currentStep);
    return ["waiting_approval", "review"].includes(content.status) ||
      ["waiting_approval", "review"].includes(current?.status);
  });
  const people = [];
  for (const personId of await directories(peopleRoot)) {
    const workspacePath = path.join(peopleRoot, personId, "WORKSPACE.md");
    const workspaceSource = await readIfExists(workspacePath);
    if (!workspaceSource) continue;
    const { frontmatter, body } = splitMarkdown(workspaceSource);
    const metadata = parseTopLevel(frontmatter);
    const assignedSteps = metadata.assigned_steps ?? [];
    const assignedProcessSteps = processes.flatMap((process) => process.steps
      .filter((step) => step.owner === personId || assignedSteps.includes(step.id))
      .map((step) => ({ process: process.id, id: step.id, label: step.label, skillId: step.skillId })));
    const skillIds = [...new Set(assignedProcessSteps.map((step) => step.skillId).filter(Boolean))];
    people.push({
      id: personId,
      title: metadata.title ?? `${personId} Workspace`,
      role: metadata.role ?? "-",
      status: metadata.status ?? "active",
      assignedProcesses: metadata.assigned_processes ?? [],
      assignedSteps: assignedProcessSteps,
      skillIds,
      wikiCount: wikiItems.filter((wiki) => wiki.owner === personId).length,
      currentTasks: contents.filter((content) => content.owner === personId && !["completed", "archived"].includes(content.status)).map((content) => ({ id: content.id, title: content.title, nextAction: content.nextAction })),
      description: excerpt(body),
      path: path.relative(repositoryRoot, workspacePath).replaceAll(path.sep, "/"),
    });
  }
  people.sort((a, b) => a.id.localeCompare(b.id));
  const owners = [...new Set([
    ...contents.map((content) => content.owner),
    ...people.map((person) => person.id),
    ...wikiItems.map((item) => item.owner),
    ...processes.flatMap((process) => process.steps.map((step) => step.owner)),
  ].filter((owner) => owner && owner !== "-"))].sort();

  return {
    schemaVersion: "1.0",
    generatedAt: new Date().toISOString(),
    summary: {
      contentCount: contents.length,
      activeCount: contents.filter((item) => !["completed", "archived"].includes(item.status)).length,
      approvalCount: approvals.length,
      skillCount: skills.length,
      peopleCount: people.length,
      wikiCount: wikiItems.length,
    },
    owners,
    processes,
    contents,
    approvals,
    skills,
    skillCategories,
    wikiItems,
    people,
  };
}

const index = await buildIndex();
if (!index.processes.length) throw new Error("공정 정의를 찾지 못했습니다.");
if (!index.skills.length) throw new Error("Skill 정의를 찾지 못했습니다.");

if (!checkOnly) {
  const outputDirectory = path.join(repositoryRoot, "web", "data");
  await mkdir(outputDirectory, { recursive: true });
  await writeFile(
    path.join(outputDirectory, "os-index.json"),
    `${JSON.stringify(index, null, 2)}\n`,
    "utf8",
  );
}

console.log(
  `OS index ready: ${index.contents.length} contents, ${index.processes.length} processes, ${index.skills.length} access skills, ${index.people.length} people, ${index.wikiItems.length} wiki`,
);
