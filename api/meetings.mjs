import { timingSafeEqual } from "node:crypto";

const DEFAULT_REPOSITORY = "brandyaction-ricky/OS";
const DEFAULT_BRANCH = "main";
const MAX_AUDIO_BYTES = 2_500_000;
const MAX_TEXT_LENGTH = 1_500_000;
const MEETING_INDEX_PATH = "06_meetings/index.json";
const MEETING_ID_PATTERN = /^MTG-\d{8}-\d{6}$/;
const MEETING_PATH_PATTERN = /^06_meetings\/(?:inbox|organized\/\d{4}|decisions\/\d{4})\/MTG-\d{8}-\d{6}\.md$/;

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

function scalar(value) {
  if (value === null || value === undefined || value === "") return "null";
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return JSON.stringify(String(value));
}

function inlineList(values) {
  return `[${values.map((value) => scalar(value)).join(", ")}]`;
}

function parseFrontmatter(markdown) {
  const lines = String(markdown || "").replace(/\r\n/g, "\n").split("\n");
  if (lines[0] !== "---") return {};
  const end = lines.indexOf("---", 1);
  if (end < 0) return {};
  const fields = {};
  for (const line of lines.slice(1, end)) {
    if (/^\s/.test(line)) continue;
    const match = line.match(/^([A-Za-z0-9_]+):\s*(.*)$/);
    if (!match) continue;
    fields[match[1]] = match[2].replace(/^(?:"(.*)"|'(.*)')$/, "$1$2");
  }
  return fields;
}

function normalizeMeetingDate(value) {
  const text = String(value || "").trim();
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(text)) return `${text}:00+09:00`;
  const date = new Date(text);
  if (Number.isNaN(date.getTime())) throw new Error("회의 일시가 올바르지 않습니다.");
  return date.toISOString();
}

export function meetingPath(id, destination, meetingDate) {
  if (!MEETING_ID_PATTERN.test(id)) throw new Error("Meeting ID 형식이 올바르지 않습니다.");
  if (!['inbox', 'organized', 'decisions'].includes(destination)) throw new Error("저장 위치가 올바르지 않습니다.");
  const year = String(meetingDate).slice(0, 4);
  return destination === "inbox"
    ? `06_meetings/inbox/${id}.md`
    : `06_meetings/${destination}/${year}/${id}.md`;
}

export function buildMeetingMarkdown(payload, { version = 1, createdAt = new Date().toISOString() } = {}) {
  const now = new Date().toISOString();
  const meetingDate = normalizeMeetingDate(payload.meetingDate);
  const status = payload.destination === "decisions" ? "decision" : payload.destination;
  const participants = Array.isArray(payload.participants) ? payload.participants : [];
  return `---
schema_version: "1.0"
id: ${scalar(payload.id)}
entity_type: ${scalar("meeting")}
title: ${scalar(payload.title)}
meeting_date: ${scalar(meetingDate)}
owner: ${scalar(payload.owner)}
participants: ${inlineList(participants)}
status: ${scalar(status)}
location: ${scalar(payload.location || "-")}
process: ${scalar(payload.process)}
content_id: ${scalar(payload.contentId)}
source_type: ${scalar(payload.sourceType)}
transcript_status: ${scalar(payload.transcriptStatus)}
summary_status: ${scalar(payload.summaryStatus)}
version: ${version}
created_at: ${scalar(createdAt)}
updated_at: ${scalar(now)}
updated_by: ${scalar(payload.owner)}
---

# ${payload.title}

${String(payload.body || "").trim()}
`;
}

function validateSavePayload(payload) {
  if (!MEETING_ID_PATTERN.test(payload.id || "")) throw new Error("Meeting ID 형식이 올바르지 않습니다.");
  if (!/^[a-z][a-z0-9_-]{1,40}$/.test(payload.owner || "")) throw new Error("작업자 형식이 올바르지 않습니다.");
  if (!String(payload.title || "").trim()) throw new Error("회의 제목을 입력해주세요.");
  if (String(payload.title).length > 160) throw new Error("회의 제목은 160자 이하여야 합니다.");
  if (!Array.isArray(payload.participants) || payload.participants.some((item) => !/^[a-z][a-z0-9_-]{1,40}$/.test(item))) throw new Error("참석자는 직원 ID를 쉼표로 구분해주세요.");
  if (!['manual', 'recording', 'upload'].includes(payload.sourceType)) throw new Error("회의 기록 방식이 올바르지 않습니다.");
  if (!['not_required', 'pending', 'completed', 'failed'].includes(payload.transcriptStatus)) throw new Error("전사 상태가 올바르지 않습니다.");
  if (!['draft', 'completed'].includes(payload.summaryStatus)) throw new Error("요약 상태가 올바르지 않습니다.");
  if (String(payload.body || "").length > MAX_TEXT_LENGTH) throw new Error("회의록은 1.5MB 이하여야 합니다.");
  if (payload.sourcePath && !MEETING_PATH_PATTERN.test(payload.sourcePath)) throw new Error("기존 회의록 경로가 올바르지 않습니다.");
  if (payload.sourcePath && !payload.sourcePath.endsWith(`/${payload.id}.md`)) throw new Error("기존 회의록 경로와 Meeting ID가 일치하지 않습니다.");
}

async function github(path, options = {}) {
  const response = await fetch(`https://api.github.com${path}`, {
    ...options,
    headers: {
      accept: "application/vnd.github+json",
      authorization: `Bearer ${process.env.MEETING_GITHUB_TOKEN}`,
      "x-github-api-version": "2022-11-28",
      "content-type": "application/json",
      ...(options.headers || {}),
    },
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.message || `GitHub API ${response.status}`);
  return body;
}

async function assertPrivateMeetingRepository(repository) {
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository || "")) throw new Error("MEETING_REPOSITORY 형식이 올바르지 않습니다.");
  const metadata = await github(`/repos/${repository}`);
  if (metadata.private !== true) throw new Error("회의록 저장소는 GitHub 비공개 Repository여야 합니다.");
}

function meetingBody(markdown) {
  const lines = String(markdown || "").replace(/\r\n/g, "\n").split("\n");
  const end = lines[0] === "---" ? lines.indexOf("---", 1) : -1;
  return end < 0 ? "" : lines.slice(end + 1).join("\n").replace(/^\s*# .+\n/, "").trim();
}

function parsedParticipants(value) {
  const text = String(value || "").trim();
  if (!text.startsWith("[") || !text.endsWith("]")) return [];
  try { return JSON.parse(text); } catch { return []; }
}

function meetingRecord(filePath, source, { includeBody = false } = {}) {
  const metadata = parseFrontmatter(source);
  const body = meetingBody(source);
  return {
    id: metadata.id,
    title: metadata.title || "제목 없는 회의",
    meetingDate: metadata.meeting_date || null,
    owner: metadata.owner || "-",
    participants: parsedParticipants(metadata.participants),
    status: metadata.status || "inbox",
    folder: filePath.split("/")[1] || "inbox",
    location: metadata.location || "-",
    process: metadata.process === "null" ? null : metadata.process,
    contentId: metadata.content_id === "null" ? null : metadata.content_id,
    sourceType: metadata.source_type || "manual",
    transcriptStatus: metadata.transcript_status || "not_required",
    summaryStatus: metadata.summary_status || "draft",
    version: Number(metadata.version || 1),
    updatedAt: metadata.updated_at || null,
    excerpt: body.replace(/[#>*_`\[\]-]/g, " ").replace(/\s+/g, " ").trim().slice(0, 180),
    ...(includeBody ? { body } : {}),
    path: filePath,
  };
}

async function repositoryBlob(repository, sha) {
  const body = await github(`/repos/${repository}/git/blobs/${sha}`);
  if (body.encoding !== "base64" || typeof body.content !== "string") throw new Error("회의 Markdown Blob을 읽을 수 없습니다.");
  return Buffer.from(body.content.replace(/\n/g, ""), "base64").toString("utf8");
}

async function privateMeetingSnapshot() {
  const repository = process.env.MEETING_REPOSITORY;
  if (!repository || !process.env.MEETING_GITHUB_TOKEN) throw new Error("비공개 회의 저장소 연결이 필요합니다.");
  await assertPrivateMeetingRepository(repository);
  const branch = process.env.MEETING_GITHUB_BRANCH || process.env.GITHUB_BRANCH || DEFAULT_BRANCH;
  const ref = await github(`/repos/${repository}/git/ref/heads/${branch}`);
  const headSha = ref.object.sha;
  const headCommit = await github(`/repos/${repository}/git/commits/${headSha}`);
  const tree = await github(`/repos/${repository}/git/trees/${headCommit.tree.sha}?recursive=1`);
  return { repository, branch, headSha, headCommit, treeEntries: tree.tree || [] };
}

export async function listMeetings({ offset = 0, limit = 50 } = {}) {
  const snapshot = await privateMeetingSnapshot();
  const indexEntry = snapshot.treeEntries.find((item) => item.path === MEETING_INDEX_PATH && item.type === "blob");
  if (!indexEntry) return { items: [], nextOffset: null, total: 0 };
  const parsed = JSON.parse(await repositoryBlob(snapshot.repository, indexEntry.sha));
  const allItems = Array.isArray(parsed.items) ? parsed.items : [];
  const safeOffset = Math.max(0, Number(offset) || 0);
  const safeLimit = Math.min(100, Math.max(1, Number(limit) || 50));
  const items = allItems.slice(safeOffset, safeOffset + safeLimit);
  const nextOffset = safeOffset + items.length < allItems.length ? safeOffset + items.length : null;
  return { items, nextOffset, total: allItems.length };
}

export async function readMeeting(filePath) {
  if (!MEETING_PATH_PATTERN.test(filePath || "")) throw new Error("회의록 경로가 올바르지 않습니다.");
  const snapshot = await privateMeetingSnapshot();
  const entry = snapshot.treeEntries.find((item) => item.path === filePath && item.type === "blob");
  if (!entry) throw new Error("회의록을 찾지 못했습니다.");
  const source = await repositoryBlob(snapshot.repository, entry.sha);
  if (source.length > MAX_TEXT_LENGTH) throw new Error("회의록이 허용 크기를 초과했습니다.");
  return meetingRecord(filePath, source, { includeBody: true });
}

export async function saveMeeting(payload) {
  validateSavePayload(payload);
  const repository = process.env.MEETING_REPOSITORY;
  if (!repository) throw new Error("비공개 회의 저장소가 연결되지 않았습니다.");
  if (!process.env.MEETING_GITHUB_TOKEN) throw new Error("비공개 회의 저장소 전용 Token이 연결되지 않았습니다.");
  const meetingDate = normalizeMeetingDate(payload.meetingDate);
  const targetPath = meetingPath(payload.id, payload.destination, meetingDate);
  const snapshot = await privateMeetingSnapshot();
  const { branch, headSha, headCommit, treeEntries } = snapshot;
  const remotePaths = new Set(treeEntries.map((item) => item.path));
  const idPaths = treeEntries.filter((item) => item.type === "blob" && MEETING_PATH_PATTERN.test(item.path) && item.path.endsWith(`/${payload.id}.md`)).map((item) => item.path);
  if (idPaths.length > 1) throw new Error("같은 Meeting ID가 여러 폴더에 있어 저장을 중단했습니다.");
  if (idPaths.length === 1 && !payload.sourcePath) throw new Error("같은 Meeting ID의 기존 문서가 있습니다. 목록에서 해당 문서를 다시 열어주세요.");
  if (idPaths.length === 1 && payload.sourcePath !== idPaths[0]) throw new Error("기존 Meeting ID의 실제 경로와 요청 경로가 일치하지 않습니다.");
  if (!idPaths.length && payload.sourcePath) throw new Error("이동할 기존 회의록을 찾지 못했습니다. 목록을 새로고침해주세요.");
  const sourceExists = payload.sourcePath && remotePaths.has(payload.sourcePath);
  const targetExists = remotePaths.has(targetPath);
  if (targetExists && targetPath !== payload.sourcePath) throw new Error("같은 Meeting ID의 문서가 저장 위치에 이미 있습니다.");

  const existingPath = sourceExists ? payload.sourcePath : targetExists ? targetPath : null;
  const existingEntry = existingPath ? treeEntries.find((item) => item.path === existingPath && item.type === "blob") : null;
  const existingSource = existingEntry ? await repositoryBlob(repository, existingEntry.sha) : "";
  const existing = parseFrontmatter(existingSource);
  if (existingPath && Number(existing.version || 0) !== Number(payload.version || 0)) throw new Error("다른 작업자가 회의록을 먼저 수정했습니다. 목록을 새로고침한 뒤 다시 편집해주세요.");
  if (!existingPath && Number(payload.version || 0) !== 0) throw new Error("기존 회의록을 찾지 못했습니다. 목록을 새로고침해주세요.");
  const version = Math.max(Number(existing.version || 0), Number(payload.version || 0)) + 1;
  const createdAt = existing.created_at || new Date().toISOString();
  const markdown = buildMeetingMarkdown({ ...payload, meetingDate }, { version, createdAt });
  const indexEntry = treeEntries.find((item) => item.path === MEETING_INDEX_PATH && item.type === "blob");
  const indexSource = indexEntry ? await repositoryBlob(repository, indexEntry.sha) : "";
  const currentIndex = indexSource ? JSON.parse(indexSource) : { schemaVersion: "1.0", items: [] };
  const item = meetingRecord(targetPath, markdown);
  const indexItems = [...(Array.isArray(currentIndex.items) ? currentIndex.items : []).filter((entry) => entry.id !== payload.id), item]
    .sort((a, b) => String(b.meetingDate || b.updatedAt || "").localeCompare(String(a.meetingDate || a.updatedAt || "")));
  const nextIndex = `${JSON.stringify({ schemaVersion: "1.0", updatedAt: new Date().toISOString(), items: indexItems }, null, 2)}\n`;
  const [blob, indexBlob] = await Promise.all([
    github(`/repos/${repository}/git/blobs`, { method: "POST", body: JSON.stringify({ content: markdown, encoding: "utf-8" }) }),
    github(`/repos/${repository}/git/blobs`, { method: "POST", body: JSON.stringify({ content: nextIndex, encoding: "utf-8" }) }),
  ]);
  const entries = [
    { path: targetPath, mode: "100644", type: "blob", sha: blob.sha },
    { path: MEETING_INDEX_PATH, mode: "100644", type: "blob", sha: indexBlob.sha },
  ];
  if (sourceExists && payload.sourcePath !== targetPath) entries.push({ path: payload.sourcePath, mode: "100644", type: "blob", sha: null });
  const nextTree = await github(`/repos/${repository}/git/trees`, {
    method: "POST",
    body: JSON.stringify({ base_tree: headCommit.tree.sha, tree: entries }),
  });
  const commit = await github(`/repos/${repository}/git/commits`, {
    method: "POST",
    body: JSON.stringify({
      message: `meeting(${payload.id}): ${payload.destination === "inbox" ? "회의록 저장" : `${payload.destination} 이동`}`,
      tree: nextTree.sha,
      parents: [headSha],
    }),
  });
  await github(`/repos/${repository}/git/refs/heads/${branch}`, {
    method: "PATCH",
    body: JSON.stringify({ sha: commit.sha, force: false }),
  });
  return { path: targetPath, version, commitSha: commit.sha };
}

function extensionFor(mimeType, fileName) {
  const fromName = String(fileName || "").toLowerCase().match(/\.(webm|mp3|mp4|mpeg|mpga|m4a|wav)$/)?.[1];
  if (fromName) return fromName;
  if (mimeType.includes("wav")) return "wav";
  if (mimeType.includes("mpeg")) return "mp3";
  if (mimeType.includes("mp4")) return "m4a";
  return "webm";
}

export async function transcribeAudio(payload) {
  if (!process.env.OPENAI_API_KEY) throw new Error("OpenAI 전사 연결이 아직 완료되지 않았습니다. Vercel에 OPENAI_API_KEY를 설정해주세요.");
  const buffer = Buffer.from(String(payload.audioBase64 || ""), "base64");
  if (!buffer.length) throw new Error("전사할 오디오가 없습니다.");
  if (buffer.length > MAX_AUDIO_BYTES) throw new Error("오디오 구간은 2.5MB 이하여야 합니다.");
  const mimeType = String(payload.mimeType || "audio/webm").split(";")[0];
  const extension = extensionFor(mimeType, payload.fileName);
  const fileName = `meeting-audio.${extension}`;
  const form = new FormData();
  form.append("model", process.env.OPENAI_TRANSCRIBE_MODEL || "gpt-transcribe");
  form.append("language", "ko");
  form.append("file", new Blob([buffer], { type: mimeType }), fileName);
  const response = await fetch("https://api.openai.com/v1/audio/transcriptions", {
    method: "POST",
    headers: { authorization: `Bearer ${process.env.OPENAI_API_KEY}` },
    body: form,
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(result.error?.message || `OpenAI 전사 API ${response.status}`);
  return String(result.text || "").trim();
}

export function responseText(result) {
  if (typeof result.output_text === "string") return result.output_text;
  return (result.output || [])
    .flatMap((item) => item.content || [])
    .filter((item) => item.type === "output_text" && typeof item.text === "string")
    .map((item) => item.text)
    .join("\n")
    .trim();
}

export async function summarizeTranscript(payload) {
  if (!process.env.OPENAI_API_KEY) throw new Error("OpenAI 요약 연결이 아직 완료되지 않았습니다. Vercel에 OPENAI_API_KEY를 설정해주세요.");
  const transcript = String(payload.transcript || "").trim();
  const notes = String(payload.notes || "").trim();
  if (!transcript && !notes) throw new Error("정리할 전사문이나 메모가 없습니다.");
  if (transcript.length + notes.length > 120_000) throw new Error("전사문과 메모의 합계는 120,000자 이하여야 합니다.");
  const input = `회의 제목: ${String(payload.title || "제목 없음")}
참석자: ${String(payload.attendees || "미기재")}

[작성 중 메모]
${notes || "없음"}

[전사 원문]
${transcript || "없음"}`;
  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: { authorization: `Bearer ${process.env.OPENAI_API_KEY}`, "content-type": "application/json" },
    body: JSON.stringify({
      model: process.env.OPENAI_MEETING_MODEL || "gpt-5.6",
      instructions: "당신은 한국 회사의 회의 기록 정리자입니다. 제공된 내용에서 확인되는 사실만 사용하고 추측하지 마세요. 결과는 Markdown 본문만 반환합니다. 반드시 ## 한 줄 요약, ## 핵심 논의, ## 결정사항, ## 액션 아이템, ## 보류·추가 확인, ## 원문 메모·전사 순서를 사용하세요. 결정되지 않은 제안은 결정사항에 넣지 말고, 담당자나 기한을 확인할 수 없으면 '미정'으로 표시하세요. 원문 메모·전사 섹션은 비워 두세요.",
      input,
    }),
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(result.error?.message || `OpenAI 요약 API ${response.status}`);
  const markdown = responseText(result);
  if (!markdown) throw new Error("AI가 회의록 본문을 반환하지 않았습니다.");
  return markdown.replace(/^```(?:markdown)?\s*/i, "").replace(/\s*```$/, "").trim();
}

export default async function handler(request, response) {
  if (request.method !== "POST") return json({ error: "POST 요청만 허용됩니다." }, 405, response);
  if (!process.env.OS_PUSH_SECRET) return json({ error: "OS 작업 코드 연결이 아직 완료되지 않았습니다." }, 503, response);
  const authorization = request.headers.get?.("authorization") || request.headers.authorization || "";
  if (!safeEqual(authorization, `Bearer ${process.env.OS_PUSH_SECRET}`)) return json({ error: "OS 작업 코드가 올바르지 않습니다." }, 401, response);
  try {
    const payload = await requestBody(request);
    if (payload.action === "transcribe") return json({ ok: true, transcript: await transcribeAudio(payload) }, 200, response);
    if (payload.action === "summarize") return json({ ok: true, markdown: await summarizeTranscript(payload) }, 200, response);
    if (payload.action === "list") {
      const listing = await listMeetings({ offset: payload.offset, limit: payload.limit });
      return json({ ok: true, meetings: listing.items, nextOffset: listing.nextOffset, total: listing.total }, 200, response);
    }
    if (payload.action === "read") return json({ ok: true, meeting: await readMeeting(payload.path) }, 200, response);
    if (payload.action === "save") {
      if (!process.env.MEETING_REPOSITORY) return json({ error: "회의록은 공개 OS 저장소에 저장하지 않습니다. 비공개 MEETING_REPOSITORY 연결이 필요합니다." }, 503, response);
      if (!process.env.MEETING_GITHUB_TOKEN) return json({ error: "비공개 회의 저장소 전용 Token이 필요합니다." }, 503, response);
      return json({ ok: true, ...(await saveMeeting(payload)) }, 201, response);
    }
    throw new Error("지원하지 않는 회의 작업입니다.");
  } catch (error) {
    return json({ error: error.message || "회의 작업에 실패했습니다." }, 400, response);
  }
}
