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

async function buildIndex() {
  const processRoot = path.join(repositoryRoot, "03_processes");
  const skillRoot = path.join(repositoryRoot, "04_skills");
  const contentRoot = path.join(repositoryRoot, "05_contents");

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
        type: step.type,
        owner: step.default_owner,
        workAction: step.work_action,
        reviewAction: step.review_action,
        nextStep: step.next_step,
      })),
    });
  }

  const skills = [];
  for (const skillId of await directories(skillRoot)) {
    const source = await readFile(path.join(skillRoot, skillId, "SKILL.md"), "utf8");
    const { frontmatter, body } = splitMarkdown(source);
    const metadata = parseTopLevel(frontmatter);
    skills.push({
      id: metadata.skill_id ?? skillId,
      version: metadata.version ?? "-",
      status: metadata.status ?? "-",
      process: metadata.process ?? "-",
      step: metadata.step ?? "-",
      tools: metadata.allowed_tools ?? [],
      inputs: metadata.inputs ?? [],
      outputs: metadata.outputs ?? [],
      purpose: section(body, "PURPOSE"),
    });
  }

  const contents = [];
  for (const contentId of await directories(contentRoot)) {
    if (!/^BA-\d{4}$/.test(contentId)) continue;
    const source = await readFile(path.join(contentRoot, contentId, "CONTENT.md"), "utf8");
    const { frontmatter } = splitMarkdown(source);
    const metadata = parseTopLevel(frontmatter);
    const process = processes.find((item) => item.id === metadata.type);
    contents.push({
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
    });
  }

  contents.sort((a, b) => String(b.updatedAt ?? "").localeCompare(String(a.updatedAt ?? "")));
  const approvals = contents.filter((content) => {
    const current = content.steps.find((step) => step.id === content.currentStep);
    return ["waiting_approval", "review"].includes(content.status) ||
      ["waiting_approval", "review"].includes(current?.status);
  });
  const owners = [...new Set([
    ...contents.map((content) => content.owner),
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
    },
    owners,
    processes,
    contents,
    approvals,
    skills,
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
  `OS index ready: ${index.contents.length} contents, ${index.processes.length} processes, ${index.skills.length} skills`,
);
