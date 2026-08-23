import { timingSafeEqual } from "node:crypto";

const DEFAULT_REPOSITORY = "brandyaction-ricky/OS";
const DEFAULT_BRANCH = "main";
const RAW_PREFIXES = ["09_raw/people/", "09_raw/company/"];

function json(body, status = 200, nodeResponse = null) {
  if (nodeResponse?.status) return nodeResponse.status(status).json(body);
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json; charset=utf-8" } });
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

export function validateRawPath(rawPath) {
  const value = String(rawPath || "");
  if (!value.endsWith(".md") || value.includes("..") || value.includes("\\") || !RAW_PREFIXES.some((prefix) => value.startsWith(prefix))) {
    throw new Error("유효하지 않은 Raw 경로입니다.");
  }
  return value;
}

export function parseMarkdown(markdown) {
  const lines = String(markdown).replace(/\r\n/g, "\n").split("\n");
  if (lines[0] !== "---") throw new Error("Raw Frontmatter가 없습니다.");
  const end = lines.indexOf("---", 1);
  if (end < 0) throw new Error("Raw Frontmatter가 닫히지 않았습니다.");
  const fields = {};
  for (const line of lines.slice(1, end)) {
    if (/^\s/.test(line)) continue;
    const match = line.match(/^([A-Za-z0-9_]+):\s*(.*)$/);
    if (match) fields[match[1]] = match[2].replace(/^(\[|["'])(.*)(\]|["'])$/, "$2");
  }
  return { lines, end, fields, body: lines.slice(end + 1).join("\n").trim() };
}

function scalar(value) {
  if (value === null || value === undefined || value === "") return "null";
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  const text = String(value);
  return /^[A-Za-z0-9_./:+-]+$/.test(text) ? text : JSON.stringify(text);
}

export function updateFrontmatter(markdown, updates) {
  const parsed = parseMarkdown(markdown);
  const next = [...parsed.lines];
  const seen = new Set();
  for (let index = 1; index < parsed.end; index += 1) {
    const match = next[index].match(/^([A-Za-z0-9_]+):/);
    if (!match || !(match[1] in updates)) continue;
    next[index] = `${match[1]}: ${scalar(updates[match[1]])}`;
    seen.add(match[1]);
  }
  next.splice(parsed.end, 0, ...Object.entries(updates).filter(([key]) => !seen.has(key)).map(([key, value]) => `${key}: ${scalar(value)}`));
  return next.join("\n");
}

export function wikiMarkdown({ raw, actor, version, wikiType, wikiId, summary, now }) {
  const title = raw.fields.title || wikiId;
  const note = String(summary || "").trim();
  return `---
schema_version: "1.0"
id: wiki-${wikiType}-${wikiId}-v${version}
entity_type: wiki
wiki_id: ${wikiId}
wiki_type: ${wikiType}
category: ${raw.fields.category || "practice"}
owner: ${actor}
title: ${JSON.stringify(title)}
status: active
version: ${version}
is_latest: true
source_ids: [${raw.fields.id}]
promoted_by: ${actor}
promoted_at: ${now}
created_at: ${now}
updated_at: ${now}
updated_by: ${actor}
---

${raw.body}
${note ? `\n\n## 승격 메모\n\n${note}` : ""}
`;
}

async function github(path, options = {}) {
  const response = await fetch(`https://api.github.com${path}`, {
    ...options,
    headers: {
      accept: "application/vnd.github+json",
      authorization: `Bearer ${process.env.GITHUB_TOKEN}`,
      "x-github-api-version": "2022-11-28",
      "content-type": "application/json",
      ...(options.headers || {}),
    },
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.message || `GitHub API ${response.status}`);
  return body;
}

async function repositoryFile(repository, filePath, ref) {
  const body = await github(`/repos/${repository}/contents/${filePath}?ref=${encodeURIComponent(ref)}`);
  return Buffer.from(body.content, "base64").toString("utf8");
}

export async function promoteRaw(payload) {
  const repository = process.env.GITHUB_REPOSITORY || DEFAULT_REPOSITORY;
  const branch = process.env.GITHUB_BRANCH || DEFAULT_BRANCH;
  const rawPath = validateRawPath(payload.rawPath);
  const ref = await github(`/repos/${repository}/git/ref/heads/${branch}`);
  const headSha = ref.object.sha;
  const rawSource = await repositoryFile(repository, rawPath, headSha);
  const raw = parseMarkdown(rawSource);
  if (raw.fields.entity_type !== "raw" || raw.fields.id !== payload.rawId) throw new Error("화면의 Raw와 Repository 최신본이 일치하지 않습니다.");
  if (raw.fields.owner !== payload.actor) throw new Error("Raw 작성자만 직접 승격할 수 있습니다.");
  const wikiId = raw.fields.wiki_target;
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(wikiId || "")) throw new Error("Raw의 wiki_target이 유효하지 않습니다.");
  const wikiType = raw.fields.scope === "company" ? "company" : "practice";
  const wikiRoot = `10_wiki/${wikiType}/${wikiId}`;
  const headCommit = await github(`/repos/${repository}/git/commits/${headSha}`);
  const tree = await github(`/repos/${repository}/git/trees/${headCommit.tree.sha}?recursive=1`);
  const versions = tree.tree.map((item) => item.path.match(new RegExp(`^${wikiRoot}/WIKI_v(\\d+)\\.md$`))?.[1]).filter(Boolean).map(Number);
  const version = Math.max(0, ...versions) + 1;
  const wikiPath = `${wikiRoot}/WIKI_v${version}.md`;
  const previousPath = versions.length ? `${wikiRoot}/WIKI_v${Math.max(...versions)}.md` : null;
  const previousSource = previousPath ? await repositoryFile(repository, previousPath, headSha) : null;
  const now = new Date().toISOString();
  const wikiSource = wikiMarkdown({ raw, actor: payload.actor, version, wikiType, wikiId, summary: payload.summary, now });
  const updatedRaw = updateFrontmatter(rawSource, {
    status: "promoted", promoted_to: wikiPath, promoted_by: payload.actor, promoted_at: now, updated_at: now, updated_by: payload.actor,
  });
  const [wikiBlob, rawBlob, previousBlob] = await Promise.all([
    github(`/repos/${repository}/git/blobs`, { method: "POST", body: JSON.stringify({ content: wikiSource, encoding: "utf-8" }) }),
    github(`/repos/${repository}/git/blobs`, { method: "POST", body: JSON.stringify({ content: updatedRaw, encoding: "utf-8" }) }),
    previousSource ? github(`/repos/${repository}/git/blobs`, { method: "POST", body: JSON.stringify({ content: updateFrontmatter(previousSource, { is_latest: false }), encoding: "utf-8" }) }) : Promise.resolve(null),
  ]);
  const entries = [
    { path: wikiPath, mode: "100644", type: "blob", sha: wikiBlob.sha },
    { path: rawPath, mode: "100644", type: "blob", sha: rawBlob.sha },
  ];
  if (previousPath && previousBlob) entries.push({ path: previousPath, mode: "100644", type: "blob", sha: previousBlob.sha });
  const newTree = await github(`/repos/${repository}/git/trees`, { method: "POST", body: JSON.stringify({ base_tree: headCommit.tree.sha, tree: entries }) });
  const commit = await github(`/repos/${repository}/git/commits`, { method: "POST", body: JSON.stringify({ message: `wiki(${wikiId}): ${payload.actor} 직접 승격`, tree: newTree.sha, parents: [headSha] }) });
  await github(`/repos/${repository}/git/refs/heads/${branch}`, { method: "PATCH", body: JSON.stringify({ sha: commit.sha, force: false }) });
  return { commitSha: commit.sha, wikiPath, version };
}

export default async function handler(request, response) {
  if (request.method !== "POST") return json({ error: "POST 요청만 허용됩니다." }, 405, response);
  if (!process.env.GITHUB_TOKEN || !process.env.OS_PUSH_SECRET) return json({ error: "관리자 연결이 아직 완료되지 않았습니다." }, 503, response);
  const authorization = request.headers.get?.("authorization") || request.headers.authorization || "";
  if (!safeEqual(authorization, `Bearer ${process.env.OS_PUSH_SECRET}`)) return json({ error: "OS 작업 코드가 올바르지 않습니다." }, 401, response);
  try {
    const payload = await requestBody(request);
    if (!/^[a-z][a-z0-9_-]{1,80}$/.test(payload.actor || "")) throw new Error("유효하지 않은 작업자입니다.");
    if (!/^raw-[a-z0-9_-]+-v\d+$/.test(payload.rawId || "")) throw new Error("유효하지 않은 Raw ID입니다.");
    if (String(payload.summary || "").length > 3000) throw new Error("승격 메모는 3,000자 이하여야 합니다.");
    const result = await promoteRaw(payload);
    return json({ ok: true, message: "검토 없이 Wiki로 즉시 승격했습니다.", ...result }, 201, response);
  } catch (error) {
    return json({ error: error.message || "Wiki 승격에 실패했습니다." }, 400, response);
  }
}
