import { isAuthorizedRequest } from "./session-auth.mjs";

const CONTENT_ID_PATTERN = /^BA-\d{4}$/;
const KINDS = new Set(["master", "subtitle", "thumbnail"]);
const MAX_SIZE = 30 * 1024 * 1024 * 1024;

async function requestBody(request) {
  if (request.body && typeof request.body === "object" && !request.body.getReader) return request.body;
  if (typeof request.json === "function") return request.json();
  let raw = "";
  for await (const chunk of request) raw += chunk;
  return JSON.parse(raw || "{}");
}

function json(payload, status = 200, response = null) {
  if (response?.status) return response.status(status).json(payload);
  return new Response(JSON.stringify(payload), { status, headers: { "content-type": "application/json; charset=utf-8" } });
}

function validAssetId(value) {
  return /^asset:\/\/[A-Za-z0-9][A-Za-z0-9._/-]{2,500}$/.test(String(value || "")) && !String(value).split("/").some((part) => part === "." || part === "..");
}

export default async function handler(request, response) {
  const ready = Boolean(process.env.ASSET_UPLOAD_SESSION_URL && process.env.ASSET_UPLOAD_SERVICE_SECRET);
  if (request.method === "GET") return json({ ok: true, ready, mode: "direct_upload" }, 200, response);
  if (request.method !== "POST") return json({ error: "GET 또는 POST 요청만 허용됩니다." }, 405, response);
  try {
    if (!isAuthorizedRequest(request)) return json({ error: "팀 작업 세션이 필요합니다." }, 401, response);
    if (!ready) return json({ error: "완료본 자산 저장소 연결이 필요합니다." }, 503, response);
    const payload = await requestBody(request);
    if (!CONTENT_ID_PATTERN.test(payload.contentId || "")) throw new Error("Content ID 형식이 올바르지 않습니다.");
    if (!KINDS.has(payload.kind)) throw new Error("지원하지 않는 자산 종류입니다.");
    if (!/^[^/\\\0]{1,180}$/.test(payload.fileName || "")) throw new Error("파일명이 올바르지 않습니다.");
    if (!Number.isSafeInteger(payload.size) || payload.size <= 0 || payload.size > MAX_SIZE) throw new Error("파일 크기가 허용 범위를 벗어났습니다.");
    if (!/^[\w.+-]+\/[\w.+-]+$/.test(payload.contentType || "")) throw new Error("파일 형식이 올바르지 않습니다.");
    const upstream = await fetch(process.env.ASSET_UPLOAD_SESSION_URL, {
      method: "POST",
      signal: AbortSignal.timeout(10_000),
      headers: { authorization: `Bearer ${process.env.ASSET_UPLOAD_SERVICE_SECRET}`, "content-type": "application/json" },
      body: JSON.stringify({ contentId: payload.contentId, kind: payload.kind, fileName: payload.fileName, size: payload.size, contentType: payload.contentType }),
    });
    const result = await upstream.json().catch(() => ({}));
    if (!upstream.ok) throw new Error(result.error || "자산 업로드 세션을 만들지 못했습니다.");
    let uploadUrl;
    try { uploadUrl = new URL(result.uploadUrl); } catch { throw new Error("자산 저장소가 올바른 업로드 URL을 반환하지 않았습니다."); }
    if (uploadUrl.protocol !== "https:" || !validAssetId(result.assetId)) throw new Error("자산 저장소 응답이 안전하지 않습니다.");
    return json({ ok: true, uploadUrl: uploadUrl.href, assetId: result.assetId, headers: result.headers && typeof result.headers === "object" ? result.headers : {} }, 200, response);
  } catch (error) {
    return json({ error: error.message || "업로드를 준비하지 못했습니다." }, 400, response);
  }
}
