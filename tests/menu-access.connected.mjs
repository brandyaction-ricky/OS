// Manual connected QA. Credentials must be an untracked, mode-0600 DEV fixture file.
// Never run against production or employee accounts; provisioning/cleanup is separate.
import assert from "node:assert/strict";
import { readFileSync, statSync } from "node:fs";

const path = process.env.MENU_ACCESS_QA_CREDENTIALS;
assert(path, "MENU_ACCESS_QA_CREDENTIALS is required");
assert.equal(statSync(path).mode & 0o077, 0, "fixture file must be private");
const config = JSON.parse(readFileSync(path, "utf8"));
assert.equal(config.environment, "development");
assert.equal(new URL(config.url).hostname, `${config.expectedProjectRef}.supabase.co`);
assert.match(new URL(config.base).hostname, /^brandyaction-[a-z0-9]+-brandyaction-os\.vercel\.app$/);
assert.notEqual(new URL(config.base).hostname, "brandyaction-os.vercel.app");
assert(config.accounts.every(a => a.email.includes("-menu-qa-") && a.email.endsWith("@example.test")));
const accounts = Object.fromEntries(config.accounts.map(a => [a.kind, a]));
const sessions = {};
let checks = 0;

async function request(url, options = {}) {
  const response = await fetch(url, options);
  assert(response.headers.get("content-type")?.includes("application/json"), "expected application JSON, not a protection page");
  return { status: response.status, body: await response.json() };
}
for (const [kind, account] of Object.entries(accounts)) {
  const result = await request(`${config.url}/auth/v1/token?grant_type=password`, {
    method: "POST", headers: { apikey: config.key, "Content-Type": "application/json" },
    body: JSON.stringify({ email: account.email, password: account.password }),
  });
  assert.equal(result.status, 200, `DEV ${kind} sign-in must succeed`);
  sessions[kind] = result.body.access_token;
}
const api = (kind, method = "GET", payload, suffix = "") => request(`${config.base}/api/v1/members/menu-access${suffix}`, {
  method, headers: { ...(kind ? { Authorization: `Bearer ${sessions[kind]}` } : {}), "Content-Type": "application/json" },
  ...(payload ? { body: JSON.stringify(payload) } : {}),
});
const rest = (kind, table, method = "GET", payload, query = "") => request(`${config.url}/rest/v1/${table}${query}`, {
  method, headers: { apikey: config.key, Authorization: `Bearer ${sessions[kind] ?? config.key}`, "Content-Type": "application/json", Prefer: "return=representation" },
  ...(payload ? { body: JSON.stringify(payload) } : {}),
});
const patch = (kind, allowedMenus, expectedVersion, memberId = accounts.member.id) => api(kind, "PATCH", { memberId, allowedMenus, expectedVersion });
const status = (actual, expected, label) => { assert.equal(actual.status, expected, label); checks++; };
const profilesBefore = {};
for (const kind of ["admin", "member", "peer", "finance"]) {
  const result = await rest(kind, "os_profiles", "GET", undefined, `?id=eq.${accounts[kind].id}&select=role,finance_access,is_active`);
  status(result, 200, "profile baseline readable");
  profilesBefore[kind] = result.body;
}

status(await api(null), 401, "anonymous API read denied");
status(await api("inactive"), 403, "inactive API read denied");
status(await api("member", "GET", undefined, "?view=all"), 403, "non-admin bulk read denied");
status(await patch("member", null, 0), 403, "non-admin write denied");
status(await patch("admin", ["/finance/cards"], 0), 400, "finance grant cannot be escalated");
status(await patch("admin", null, 0, accounts.admin.id), 400, "admin lockout blocked");
status(await patch("admin", null, 0, accounts.inactive.id), 404, "inactive target blocked");
status(await patch("admin", ["/unknown"], 0), 400, "unknown menu rejected");
status(await api("admin", "PATCH", { memberId: accounts.member.id, allowedMenus: null, expectedVersion: 0, role: "admin" }), 400, "privileged payload rejected");

const first = await patch("admin", ["/content/topics"], 0);
status(first, 200, "admin saves first policy");
assert.deepEqual(first.body.policy.allowed_menus, ["/home", "/content/topics"]);
assert.equal(first.body.policy.version, 1);
const own = await api("member");
status(own, 200, "own policy API read");
assert.equal(own.body.ready, true);
assert.equal(own.body.policies.length, 1);
assert.equal(own.body.policies[0].member_id, accounts.member.id);
const peer = await api("peer");
status(peer, 200, "peer own API read");
assert.equal(peer.body.policies.length, 0);
const memberRows = await rest("member", "os_member_menu_access");
status(memberRows, 200, "direct own RLS read");
assert.equal(memberRows.body.length, 1);
const peerRows = await rest("peer", "os_member_menu_access");
status(peerRows, 200, "peer direct RLS read");
assert.equal(peerRows.body.length, 0);
for (const kind of ["member", "admin"]) {
  const direct = await rest(kind, "os_member_menu_access", "PATCH", { allowed_menus: null }, `?member_id=eq.${accounts.member.id}`);
  status(direct, 403, `${kind} direct write denied`);
}
const collision = await Promise.all([
  patch("admin", ["/content/topics"], 1),
  patch("admin", ["/organization/tasks"], 1),
]);
assert.deepEqual(collision.map(r => r.status).sort(), [200, 409], "exactly one concurrent update wins"); checks++;
const current = await api("member");
assert.equal(current.body.policies[0].version, 2);
status(await patch("admin", null, 1), 409, "stale version cannot reset");
status(await patch("admin", null, 2), 200, "default reset persists");
assert.equal((await api("member")).body.policies[0].allowed_menus, null);
const finance = await patch("admin", ["/finance/cards"], 0, accounts.finance.id);
status(finance, 200, "existing finance eligibility selectable");
assert.deepEqual((await api("finance")).body.policies[0].allowed_menus, ["/home", "/finance/cards"]);
const all = await api("admin", "GET", undefined, "?view=all");
status(all, 200, "admin reads all settings");
assert(all.body.policies.some(p => p.member_id === accounts.member.id));
assert(all.body.policies.some(p => p.member_id === accounts.finance.id));
for (const kind of ["admin", "member", "peer", "finance"]) {
  const result = await rest(kind, "os_profiles", "GET", undefined, `?id=eq.${accounts[kind].id}&select=role,finance_access,is_active`);
  assert.deepEqual(result.body, profilesBefore[kind], "menu saves must not change account roles or finance eligibility"); checks++;
}
// Leave a deterministic fixture for browser QA. Cleanup removes only these synthetic accounts.
status(await patch("admin", ["/content/topics", "/settings/access"], 3), 200, "browser QA policy prepared");
console.log(`Connected DEV menu-access QA passed (${checks} checks; no production requests).`);
