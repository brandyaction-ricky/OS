import { timingSafeEqual } from "node:crypto";

const DEFAULT_REPOSITORY = "brandyaction-ricky/OS";
const DEFAULT_BRANCH = "main";
const MAX_TEXT_LENGTH = 1_500_000;

function json(response, status = 200, nodeResponse = null) {
  if (nodeResponse?.status) return nodeResponse.status(status).json(response);
  return new Response(JSON.stringify(response), {
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

function parseFrontmatter(markdown) {
  const lines = markdown.replace(/\r\n/g, "\n").split("\n");
  if (lines[0] !== "---") throw new Error("CONTENT.md Frontmatter가 없습니다.");
  const end = lines.indexOf("---", 1);
  if (end < 0) throw new Error("CONTENT.md Frontmatter가 닫히지 않았습니다.");
  const fields = {};
  for (const line of lines.slice(1, end)) {
    if (/^\s/.test(line)) continue;
    const match = line.match(/^([A-Za-z0-9_]+):\s*(.*)$/);
    if (!match) continue;
    fields[match[1]] = match[2].replace(/^(["'])(.*)\1$/, "$2");
  }
  return { lines, end, fields };
}

function scalar(value) {
  if (value === null || value === undefined || value === "") return "null";
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  const text = String(value);
  return /^[A-Za-z0-9_./:+-]+$/.test(text) ? text : JSON.stringify(text);
}

export function updateFrontmatter(markdown, updates) {
  const parsed = parseFrontmatter(markdown);
  const next = [...parsed.lines];
  const seen = new Set();
  for (let index = 1; index < parsed.end; index += 1) {
    const match = next[index].match(/^([A-Za-z0-9_]+):/);
    if (!match || !(match[1] in updates)) continue;
    next[index] = `${match[1]}: ${scalar(updates[match[1]])}`;
    seen.add(match[1]);
  }
  const additions = Object.entries(updates)
    .filter(([key]) => !seen.has(key))
    .map(([key, value]) => `${key}: ${scalar(value)}`);
  next.splice(parsed.end, 0, ...additions);
  return next.join("\n");
}

function artifactMarkdown({ contentId, process, step, version, actor, summary, assetUrl, checksum, sourceMarkdown, mode }) {
  if (sourceMarkdown) {
    if (sourceMarkdown.length > MAX_TEXT_LENGTH) throw new Error("Markdown 파일은 1.5MB 이하여야 합니다.");
    const parsed = parseFrontmatter(sourceMarkdown);
    if (parsed.fields.content_id !== contentId) throw new Error("업로드한 Markdown의 content_id가 일치하지 않습니다.");
    if (parsed.fields.step !== step) throw new Error("업로드한 Markdown의 step이 현재 단계와 일치하지 않습니다.");
    return updateFrontmatter(sourceMarkdown, {
      id: `${contentId}-${step}-v${version}`,
      entity_type: "artifact",
      content_id: contentId,
      process,
      step,
      owner: actor,
      version,
      is_latest: true,
      created_at: parsed.fields.created_at || new Date().toISOString(),
      updated_at: new Date().toISOString(),
      updated_by: actor,
      status: mode === "review" ? "waiting_approval" : "in_progress",
      approval_status: mode === "review" ? "pending" : "not_required",
    });
  }
  return `---
schema_version: "1.0"
id: ${contentId}-${step}-v${version}
entity_type: artifact
content_id: ${contentId}
process: ${process}
step: ${step}
status: ${mode === "review" ? "waiting_approval" : "in_progress"}
owner: ${actor}
version: ${version}
is_latest: true
created_at: ${new Date().toISOString()}
updated_at: ${new Date().toISOString()}
updated_by: ${actor}
approval_status: ${mode === "review" ? "pending" : "not_required"}
---

# 작업 결과

## 결과 요약

${summary}

## 외부 자산

- asset_url: ${assetUrl || "-"}
- checksum: ${checksum || "-"}
`;
}

function parseProcessStep(markdown, stepId) {
  const lines = markdown.replace(/\r\n/g, "\n").split("\n");
  const start = lines.findIndex((line) => line === `  - id: ${stepId}`);
  if (start < 0) throw new Error("공정에서 현재 단계를 찾을 수 없습니다.");
  const endOffset = lines.slice(start + 1).findIndex((line) => /^  - id: /.test(line));
  const block = lines.slice(start, endOffset < 0 ? undefined : start + 1 + endOffset);
  const field = (name) => block.find((line) => line.startsWith(`    ${name}:`))?.split(":").slice(1).join(":").trim().replace(/^(["'])(.*)\1$/, "$2") || null;
  return {
    folder: field("folder"),
    reviewAction: field("review_action"),
    workAction: field("work_action"),
  };
}

async function github(path, options = {}) {
  const token = process.env.GITHUB_TOKEN;
  const response = await fetch(`https://api.github.com${path}`, {
    ...options,
    headers: {
      accept: "application/vnd.github+json",
      authorization: `Bearer ${token}`,
      "x-github-api-version": "2022-11-28",
      "content-type": "application/json",
      ...(options.headers || {}),
    },
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.message || `GitHub API ${response.status}`);
  return body;
}

async function repositoryFile(repository, path, branch) {
  const body = await github(`/repos/${repository}/contents/${path}?ref=${encodeURIComponent(branch)}`);
  return Buffer.from(body.content, "base64").toString("utf8");
}

export async function commitSubmission(payload) {
  const repository = process.env.GITHUB_REPOSITORY || DEFAULT_REPOSITORY;
  const branch = process.env.GITHUB_BRANCH || DEFAULT_BRANCH;
  const contentPath = `05_contents/${payload.contentId}/CONTENT.md`;
  const ref = await github(`/repos/${repository}/git/ref/heads/${branch}`);
  const headSha = ref.object.sha;
  const contentSource = await repositoryFile(repository, contentPath, headSha);
  const content = parseFrontmatter(contentSource);
  if (content.fields.id !== payload.contentId) throw new Error("Repository의 content_id가 일치하지 않습니다.");
  if (content.fields.current_step !== payload.step) throw new Error(`Remote 최신 단계는 ${content.fields.current_step}입니다. 화면을 새로고침하세요.`);

  const processPath = content.fields.process_path || `03_processes/${content.fields.type}/PROCESS.md`;
  const processSource = await repositoryFile(repository, processPath, headSha);
  const step = parseProcessStep(processSource, payload.step);
  if (!step.folder) throw new Error("현재 단계 폴더를 찾을 수 없습니다.");

  const headCommit = await github(`/repos/${repository}/git/commits/${headSha}`);
  const tree = await github(`/repos/${repository}/git/trees/${headCommit.tree.sha}?recursive=1`);
  const prefix = `05_contents/${payload.contentId}/${step.folder}/${payload.step}_v`;
  const versions = tree.tree
    .map((item) => item.path.match(new RegExp(`^${prefix}(\\d+)\\.md$`))?.[1])
    .filter(Boolean)
    .map(Number);
  const version = Math.max(0, ...versions) + 1;
  const artifactPath = `${prefix}${version}.md`;
  const artifact = artifactMarkdown({ ...payload, process: content.fields.type, version });
  const now = new Date().toISOString();
  const contentVersion = Number(content.fields.version || 0) + 1;
  const updatedContent = updateFrontmatter(contentSource, {
    status: payload.mode === "review" ? "waiting_approval" : "in_progress",
    owner: payload.actor,
    next_owner: payload.mode === "review" ? "ricky" : payload.actor,
    version: contentVersion,
    [`${payload.step}_status`]: payload.mode === "review" ? "waiting_approval" : "in_progress",
    [`latest_${payload.step}`]: `${step.folder}/${payload.step}_v${version}.md`,
    next_action: payload.mode === "review" ? (step.reviewAction || "대표 검수") : (step.workAction || "작업 계속"),
    updated_at: now,
    updated_by: payload.actor,
    locked_by: null,
    locked_step: null,
    locked_at: null,
  });

  const previousRelativePath = content.fields[`latest_${payload.step}`];
  const previousPath = previousRelativePath && previousRelativePath !== "null"
    ? `05_contents/${payload.contentId}/${previousRelativePath}`
    : null;
  const previousSource = previousPath ? await repositoryFile(repository, previousPath, headSha) : null;
  const previousBlobPromise = previousSource
    ? github(`/repos/${repository}/git/blobs`, { method: "POST", body: JSON.stringify({ content: updateFrontmatter(previousSource, { is_latest: false }), encoding: "utf-8" }) })
    : Promise.resolve(null);
  const [artifactBlob, contentBlob, previousBlob] = await Promise.all([
    github(`/repos/${repository}/git/blobs`, { method: "POST", body: JSON.stringify({ content: artifact, encoding: "utf-8" }) }),
    github(`/repos/${repository}/git/blobs`, { method: "POST", body: JSON.stringify({ content: updatedContent, encoding: "utf-8" }) }),
    previousBlobPromise,
  ]);
  const treeEntries = [
    { path: artifactPath, mode: "100644", type: "blob", sha: artifactBlob.sha },
    { path: contentPath, mode: "100644", type: "blob", sha: contentBlob.sha },
  ];
  if (previousPath && previousBlob) treeEntries.push({ path: previousPath, mode: "100644", type: "blob", sha: previousBlob.sha });
  const newTree = await github(`/repos/${repository}/git/trees`, {
    method: "POST",
    body: JSON.stringify({
      base_tree: headCommit.tree.sha,
      tree: treeEntries,
    }),
  });
  const commit = await github(`/repos/${repository}/git/commits`, {
    method: "POST",
    body: JSON.stringify({
      message: `content(${payload.contentId}): ${payload.step} ${payload.mode === "review" ? "승인 요청" : "작업 제출"}`,
      tree: newTree.sha,
      parents: [headSha],
    }),
  });
  await github(`/repos/${repository}/git/refs/heads/${branch}`, {
    method: "PATCH",
    body: JSON.stringify({ sha: commit.sha, force: false }),
  });
  return { commitSha: commit.sha, artifactPath, version, contentVersion };
}

export default async function handler(request, response) {
  if (request.method !== "POST") return json({ error: "POST 요청만 허용됩니다." }, 405, response);
  if (!process.env.GITHUB_TOKEN || !process.env.OS_PUSH_SECRET) {
    return json({ error: "관리자 연결이 아직 완료되지 않았습니다." }, 503, response);
  }
  const authorization = request.headers.get?.("authorization") || request.headers.authorization || "";
  if (!safeEqual(authorization, `Bearer ${process.env.OS_PUSH_SECRET}`)) {
    return json({ error: "OS 작업 코드가 올바르지 않습니다." }, 401, response);
  }
  try {
    const payload = await requestBody(request);
    if (!/^BA-\d{4}$/.test(payload.contentId || "")) throw new Error("유효하지 않은 Content ID입니다.");
    if (!/^[a-z][a-z0-9_-]{1,40}$/.test(payload.step || "")) throw new Error("유효하지 않은 Step입니다.");
    if (!/^[a-z][a-z0-9_-]{1,40}$/.test(payload.actor || "")) throw new Error("유효하지 않은 작업자입니다.");
    if (!['submit', 'review'].includes(payload.mode)) throw new Error("유효하지 않은 제출 방식입니다.");
    if (!String(payload.summary || "").trim()) throw new Error("결과 요약을 입력해주세요.");
    if (String(payload.summary).length > 10_000) throw new Error("결과 요약은 10,000자 이하여야 합니다.");
    if (String(payload.assetUrl || "").length > 2_000) throw new Error("자산 링크가 너무 깁니다.");
    const result = await commitSubmission(payload);
    return json({ ok: true, message: "Repository에 반영했습니다.", ...result }, 201, response);
  } catch (error) {
    return json({ error: error.message || "Push에 실패했습니다." }, 400, response);
  }
}
