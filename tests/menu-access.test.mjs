import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import * as zod from "zod";
import * as navigation from "../lib/navigation.ts";

class ApiError extends Error { constructor(status, code, message) { super(message); this.status = status; this.code = code; } }
function load(file, imports) {
  const mod = { exports: {} };
  const source = fs.readFileSync(new URL(`../${file}`, import.meta.url), "utf8");
  const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  vm.runInNewContext(code, { module: mod, exports: mod.exports, require: id => { assert.ok(id in imports, id); return imports[id]; }, Request, Response, URL, Date, Set });
  return mod.exports;
}
const access = load("lib/menu-access.ts", { "./navigation": navigation });
const member = { role: "member", isActive: true, financeAccess: false };

test("company document detail follows an allowed list without opening other menus",()=>{
  assert.equal(access.canOpenMenu(member,"/knowledge/vault",["/knowledge/vault"]),true);
  assert.equal(access.canOpenMenu(member,"/knowledge/doc/example",["/knowledge/vault"]),true);
  assert.equal(access.canOpenMenu(member,"/knowledge/development",["/knowledge/vault"]),false);
  assert.equal(access.canOpenMenu(member,"/knowledge/vault",[]),false);
  assert.equal(access.canOpenMenu(member,"/knowledge/doc/example",["/knowledge/notes"]),true);
  assert.equal(access.canOpenMenu(member,"/knowledge/doc/example",[]),false);
  assert.equal(access.canOpenMenu(member,"/knowledge/development",["/knowledge/notes"]),false);
  assert.equal(access.canOpenMenu(member,"/finance/sales",["/knowledge"]),false);
});

test("menu selection preserves role/data boundaries and always-available destinations", () => {
  assert.equal(access.canOpenMenu(member, "/home", []), true);
  assert.equal(access.canOpenMenu(member, "/settings/account", []), true);
  assert.equal(access.canOpenMenu(member, "/content/scripts", []), false);
  assert.equal(access.canOpenMenu(member, "/content/scripts", ["/content/scripts"]), true);
  assert.equal(access.canOpenMenu(member, "/finance/cards", ["/finance/cards"]), false);
  assert.equal(access.canOpenMenu({ ...member, financeAccess: true }, "/finance/cards", ["/finance/cards"]), true);
  assert.equal(access.canOpenMenu({ ...member, role: "admin" }, "/settings/access", []), true);
  assert.equal(access.canOpenMenu({ ...member, role: "admin", isActive: false }, "/settings/access", null), false);
  assert.equal(access.canOpenMenu(member, "/content/scripts", null), true, "no override retains previous navigation");
});

test("aliases and query-backed menus cannot sidestep page selection", () => {
  assert.equal(access.canOpenMenu(member, "/organization/leave", ["/organization/schedule"]), true);
  assert.equal(access.canOpenMenu(member, "/content/automation", []), false);
  assert.equal(access.canOpenMenu(member, "/knowledge/development?tab=history", ["/knowledge/development"]), false);
  assert.equal(access.canOpenMenu(member, "/knowledge/development?tab=updates", ["/knowledge/development?tab=updates"]), true);
  const matches = navigation.searchNavigation("", false, href => access.canOpenMenu(member, href, ["/settings/access"]));
  assert.ok(matches.some(page => page.href === "/settings/access"), "filter before the eight-result limit");
  assert.ok(matches.every(page => ["/home", "/settings/access", "/settings/account"].includes(page.href)));
});

const adminId = "00000000-0000-4000-8000-000000000001";
const targetId = "00000000-0000-4000-8000-000000000002";
function api({ role = "admin", targetRole = "member", finance = false, active = true, rows = [], queryError = null, writeError = null, stale = false } = {}) {
  const writes = [], reads = [];
  function builder(table) {
    let payload, method;
    const filters = {};
    const query = {
      select() { return query; },
      eq(key, value) { filters[key] = value; return query; },
      insert(value) { payload = value; method = "insert"; return query; },
      update(value) { payload = value; method = "update"; return query; },
      maybeSingle: async () => {
        if (table === "os_profiles") return { data: { id: targetId, role: targetRole, finance_access: finance, is_active: active }, error: null };
        writes.push({ method, payload, filters });
        return { data: stale ? null : { member_id: targetId, allowed_menus: payload.allowed_menus, version: payload.version }, error: writeError };
      },
      then(resolve, reject) { reads.push({ table, filters }); return Promise.resolve({ data: rows, error: queryError }).then(resolve, reject); },
    };
    return query;
  }
  const actor = { id: adminId, role, supabase: { from: builder } };
  const route = load("app/api/v1/members/menu-access/route.ts", {
    "next/server": { NextResponse: Response }, zod,
    "@/lib/http": { ApiError, parseJson: request => request.json(), apiErrorResponse: error => Response.json({ error: { code: error.code } }, { status: error.status ?? 500 }) },
    "@/lib/menu-access": access,
    "@/lib/server/auth": { authenticateRequest: async () => actor },
    "@/lib/supabase/server": { createServiceSupabase: () => ({ from: builder }) },
  });
  return { ...route, writes, reads };
}
const patch = (overrides = {}) => new Request("https://example.test/api/v1/members/menu-access", { method: "PATCH", body: JSON.stringify({ memberId: targetId, allowedMenus: ["/content/scripts"], expectedVersion: 0, ...overrides }) });

test("ordinary users cannot enumerate or change another account menu settings", async () => {
  const route = api({ role: "member" });
  assert.equal((await route.PATCH(patch())).status, 403);
  assert.equal((await route.GET(new Request("https://example.test/api/v1/members/menu-access?view=all"))).status, 403);
  await route.GET(new Request("https://example.test/api/v1/members/menu-access"));
  assert.equal(route.reads[0].filters.member_id, adminId);
  assert.equal(route.writes.length, 0);
});

test("admin cannot restrict administrators, inactive accounts, or elevate finance access", async () => {
  for (const options of [{ targetRole: "admin" }, { active: false }, {}]) {
    const route = api(options);
    const response = await route.PATCH(patch({ allowedMenus: ["/finance/cards"] }));
    assert.ok([400, 404].includes(response.status));
    assert.equal(route.writes.length, 0);
  }
});

test("existing finance eligibility permits saving all seven finance menu choices", async () => {
  const financeMenus = navigation.NAV_STAGES.find(stage => stage.id === "finance").pages.map(page => page.href);
  assert.equal(financeMenus.length, 7);
  const route = api({ finance: true });
  const response = await route.PATCH(patch({ allowedMenus: financeMenus }));
  assert.equal(response.status, 200);
  assert.deepEqual([...route.writes[0].payload.allowed_menus], ["/home", ...financeMenus]);
  assert.equal("finance_access" in route.writes[0].payload, false);
});

test("menu saves validate destinations and reject unrelated privileged fields", async () => {
  for (const input of [{ allowedMenus: ["https://example.test"] }, { role: "admin" }, { financeAccess: true }, { expectedVersion: -1 }]) {
    const route = api();
    assert.equal((await route.PATCH(patch(input))).status, 400);
    assert.equal(route.writes.length, 0);
  }
});

test("first save, updates and reset preserve optimistic versioning without changing profiles", async () => {
  const route = api();
  assert.equal((await route.PATCH(patch())).status, 200);
  assert.deepEqual([...route.writes[0].payload.allowed_menus], ["/home", "/content/scripts"]);
  assert.equal(route.writes[0].method, "insert");
  assert.equal((await route.PATCH(patch({ allowedMenus: null, expectedVersion: 4 }))).status, 200);
  assert.equal(route.writes[1].payload.allowed_menus, null);
  assert.equal(route.writes[1].filters.version, 4);
  assert.equal(route.writes[1].payload.version, 5);
  for (const options of [{ stale: true }, { writeError: { code: "23505" } }]) assert.equal((await api(options).PATCH(patch())).status, 409);
});

test("missing migration disables saving while genuine read outages return errors", async () => {
  const missing = { code: "PGRST205", message: "Could not find public.os_member_menu_access in the schema cache" };
  const route = api({ queryError: missing, writeError: missing });
  assert.equal((await (await route.GET(new Request("https://example.test"))).json()).ready, false);
  assert.equal((await route.PATCH(patch())).status, 503);
  assert.equal((await api({ queryError: { code: "57014", message: "timeout" } }).GET(new Request("https://example.test"))).status, 503);
});

test("HR menu grants never override operator eligibility; own leave remains available", () => {
  assert.equal(access.canOpenMenu(member, "/hr/employees", ["/hr/employees"]), false);
  assert.equal(access.canOpenMenu(member, "/hr/my-leave", []), true);
  assert.equal(access.canOpenMenu({...member, financeAccess:true}, "/hr/employees", []), false);
  assert.equal(access.canOpenMenu({...member, financeAccess:true}, "/hr/employees", ["/hr/employees"]), true);
  assert.equal(access.canOpenMenu({...member, isActive:false}, "/hr/my-leave", null), false);
});

test("disabled HR rollout leaves existing menu configuration choices unchanged", () => {
  const profile = {...member, role:"admin"};
  assert.ok(access.availableMenuGroups(profile).every(g => !g.requiresHr));
  assert.equal(access.availableMenuGroups(profile, true).filter(g => g.requiresHr).length, 1);
});
