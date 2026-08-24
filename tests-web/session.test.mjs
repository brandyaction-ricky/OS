import assert from "node:assert/strict";
import test from "node:test";

import {
  authorizationContext,
  COOKIE_NAME,
  createSessionToken,
  isSameOriginRequest,
  sessionCookie,
  SESSION_SECONDS,
  verifySessionToken,
} from "../api/session-auth.mjs";

const SECRET = "test-only-os-push-secret";
const NOW = Date.parse("2026-08-24T06:00:00.000Z");

function requestWith({ token = "", origin = "https://brandyaction-os.vercel.app", host = "brandyaction-os.vercel.app" } = {}) {
  return {
    headers: {
      cookie: token ? `${COOKIE_NAME}=${encodeURIComponent(token)}` : "",
      origin,
      host,
    },
  };
}

test("session token verifies its actor and fixed expiry", () => {
  const token = createSessionToken(SECRET, "jay", NOW);
  const session = verifySessionToken(token, SECRET, NOW + 1_000);
  assert.equal(session.actor, "jay");
  assert.equal(session.expiresAt, NOW + SESSION_SECONDS * 1_000);
  assert.equal(verifySessionToken(token, "different-secret", NOW + 1_000), null);
});

test("session token expires at the boundary", () => {
  const token = createSessionToken(SECRET, "jay", NOW);
  assert.notEqual(verifySessionToken(token, SECRET, NOW + SESSION_SECONDS * 1_000 - 1), null);
  assert.equal(verifySessionToken(token, SECRET, NOW + SESSION_SECONDS * 1_000), null);
});

test("session cookie is HttpOnly, Secure, strict same-site, and bounded", () => {
  const cookie = sessionCookie("signed-token");
  assert.match(cookie, new RegExp(`^${COOKIE_NAME}=`));
  assert.match(cookie, /; HttpOnly/);
  assert.match(cookie, /; Secure/);
  assert.match(cookie, /; SameSite=Strict/);
  assert.match(cookie, new RegExp(`; Max-Age=${SESSION_SECONDS}$`));
});

test("cookie authorization requires a same-origin request", () => {
  const token = createSessionToken(SECRET, "jay");
  const env = { OS_PUSH_SECRET: SECRET };
  const accepted = authorizationContext(requestWith({ token }), env);
  assert.deepEqual({ authorized: accepted.authorized, actor: accepted.actor, method: accepted.method }, { authorized: true, actor: "jay", method: "session" });

  const crossOrigin = authorizationContext(requestWith({ token, origin: "https://attacker.example" }), env);
  assert.equal(crossOrigin.authorized, false);
  const missingOrigin = authorizationContext(requestWith({ token, origin: "" }), env);
  assert.equal(missingOrigin.authorized, false);
});

test("same-origin helper rejects missing or cross-site origins", () => {
  assert.equal(isSameOriginRequest(requestWith()), true);
  assert.equal(isSameOriginRequest(requestWith({ origin: "" })), false);
  assert.equal(isSameOriginRequest(requestWith({ origin: "https://attacker.example" })), false);
});

test("legacy bearer remains authorized without a browser origin", () => {
  const context = authorizationContext({ headers: {} }, { OS_PUSH_SECRET: SECRET }, `Bearer ${SECRET}`);
  assert.deepEqual(context, { authorized: true, actor: null, method: "bearer" });
  assert.equal(authorizationContext({ headers: {} }, { OS_PUSH_SECRET: SECRET }, "Bearer wrong").authorized, false);
});
