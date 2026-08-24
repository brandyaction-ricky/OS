import { createHmac, timingSafeEqual } from "node:crypto";

const COOKIE_NAME = "ba_os_session";
const SESSION_SECONDS = 8 * 60 * 60;

function safeEqual(left, right) {
  const a = Buffer.from(String(left || ""));
  const b = Buffer.from(String(right || ""));
  return a.length === b.length && timingSafeEqual(a, b);
}

function signature(value, secret) {
  return createHmac("sha256", secret).update(value).digest("base64url");
}

function cookieHeader(request) {
  return request.headers?.get?.("cookie") || request.headers?.cookie || "";
}

function cookieValue(request, name = COOKIE_NAME) {
  const match = cookieHeader(request).match(new RegExp(`(?:^|;\\s*)${name}=([^;]+)`));
  return match ? decodeURIComponent(match[1]) : "";
}

export function createSessionToken(secret, actor = "team", now = Date.now()) {
  if (!secret) throw new Error("OS 작업 세션 연결이 필요합니다.");
  const payload = Buffer.from(JSON.stringify({ version: 1, actor, expiresAt: now + SESSION_SECONDS * 1000 })).toString("base64url");
  return `${payload}.${signature(payload, secret)}`;
}

export function verifySessionToken(token, secret, now = Date.now()) {
  if (!token || !secret) return null;
  const [payload, suppliedSignature, extra] = String(token).split(".");
  if (!payload || !suppliedSignature || extra || !safeEqual(suppliedSignature, signature(payload, secret))) return null;
  try {
    const decoded = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    if (decoded.version !== 1 || Number(decoded.expiresAt) <= now || !/^[a-z][a-z0-9_-]{1,40}$/.test(decoded.actor || "")) return null;
    return decoded;
  } catch {
    return null;
  }
}

export function isSameOriginRequest(request) {
  const origin = request.headers?.get?.("origin") || request.headers?.origin || "";
  const host = request.headers?.get?.("x-forwarded-host") || request.headers?.["x-forwarded-host"] || request.headers?.get?.("host") || request.headers?.host || "";
  if (!origin || !host) return false;
  try { return new URL(origin).host === String(host).split(",")[0].trim(); } catch { return false; }
}

export function sessionContext(request, env = process.env) {
  const session = verifySessionToken(cookieValue(request), env.OS_PUSH_SECRET);
  return session ? { authenticated: true, actor: session.actor, expiresAt: session.expiresAt } : { authenticated: false, actor: null, expiresAt: null };
}

export function authorizationContext(request, env = process.env, authorization = "") {
  const secret = env.OS_PUSH_SECRET;
  if (!secret) return { authorized: false, actor: null, method: null };
  if (safeEqual(authorization, `Bearer ${secret}`)) return { authorized: true, actor: null, method: "bearer" };
  const session = verifySessionToken(cookieValue(request), secret);
  if (!session || !isSameOriginRequest(request)) return { authorized: false, actor: null, method: null };
  return { authorized: true, actor: session.actor, method: "session", expiresAt: session.expiresAt };
}

export function isAuthorizedRequest(request, env = process.env, authorization = "") {
  return authorizationContext(request, env, authorization).authorized;
}

export function sessionCookie(token) {
  return `${COOKIE_NAME}=${encodeURIComponent(token)}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${SESSION_SECONDS}`;
}

export function clearSessionCookie() {
  return `${COOKIE_NAME}=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0`;
}

export { COOKIE_NAME, SESSION_SECONDS };
