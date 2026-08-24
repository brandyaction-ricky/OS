import { timingSafeEqual } from "node:crypto";
import { clearSessionCookie, createSessionToken, isSameOriginRequest, sessionContext, sessionCookie } from "./session-auth.mjs";

function safeEqual(left, right) {
  const a = Buffer.from(String(left || ""));
  const b = Buffer.from(String(right || ""));
  return a.length === b.length && timingSafeEqual(a, b);
}

async function requestBody(request) {
  if (request.body && typeof request.body === "object" && !request.body.getReader) return request.body;
  if (typeof request.json === "function") return request.json();
  let raw = "";
  for await (const chunk of request) raw += chunk;
  return JSON.parse(raw || "{}");
}

function respond(payload, status, response, cookie = null) {
  if (response?.status) {
    if (cookie) response.setHeader("set-cookie", cookie);
    return response.status(status).json(payload);
  }
  const headers = { "content-type": "application/json; charset=utf-8" };
  if (cookie) headers["set-cookie"] = cookie;
  return new Response(JSON.stringify(payload), { status, headers });
}

export default async function handler(request, response) {
  if (request.method === "GET") {
    const context = sessionContext(request, process.env);
    return respond({ ok: true, ...context }, 200, response);
  }
  if (request.method === "DELETE") {
    if (!isSameOriginRequest(request)) return respond({ error: "동일 출처 요청만 허용됩니다." }, 403, response);
    return respond({ ok: true, authenticated: false }, 200, response, clearSessionCookie());
  }
  if (request.method !== "POST") return respond({ error: "GET, POST 또는 DELETE 요청만 허용됩니다." }, 405, response);
  try {
    if (!isSameOriginRequest(request)) return respond({ error: "동일 출처 요청만 허용됩니다." }, 403, response);
    if (!process.env.OS_PUSH_SECRET) return respond({ error: "팀 작업 세션 연결이 설정되지 않았습니다." }, 503, response);
    const payload = await requestBody(request);
    if (!safeEqual(payload.code, process.env.OS_PUSH_SECRET)) return respond({ error: "팀 작업 코드가 올바르지 않습니다." }, 401, response);
    const actor = String(payload.actor || "");
    if (!/^[a-z][a-z0-9_-]{1,40}$/.test(actor)) return respond({ error: "작업자 형식이 올바르지 않습니다." }, 400, response);
    return respond({ ok: true, authenticated: true, actor, expiresIn: 8 * 60 * 60 }, 200, response, sessionCookie(createSessionToken(process.env.OS_PUSH_SECRET, actor)));
  } catch (error) {
    return respond({ error: error.message || "팀 작업 세션을 만들지 못했습니다." }, 400, response);
  }
}
