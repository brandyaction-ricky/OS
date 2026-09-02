import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (file) => readFile(new URL(`../${file}`, import.meta.url), "utf8");

test("employee accounts use exact roster nicknames and a server-only initial password", async () => {
  const [route, config, env, workspace] = await Promise.all([
    read("app/api/v1/members/accounts/route.ts"),
    read("lib/config.ts"),
    read(".env.example"),
    read("components/members-workspace.tsx"),
  ]);
  assert.match(route, /person\.name === input\.nickname/);
  assert.match(route, /auth\.admin\.createUser/);
  assert.match(route, /must_change_password: true/);
  assert.match(route, /role: "member"/);
  assert.match(config, /process\.env\.OS_INITIAL_PASSWORD/);
  assert.match(env, /OS_INITIAL_PASSWORD=/);
  assert.match(workspace, /최초 비밀번호로 계정 발급/);
});

test("password changes reauthenticate, enforce policy and remove the forced-change gate", async () => {
  const [route, security, gate, auth] = await Promise.all([
    read("app/api/v1/account/password/route.ts"),
    read("lib/server/account-security.ts"),
    read("components/password-change-form.tsx"),
    read("lib/server/auth.ts"),
  ]);
  assert.match(route, /signInWithPassword/);
  assert.match(route, /updateUser\(\{ password: input\.newPassword \}\)/);
  assert.match(route, /must_change_password: false/);
  assert.match(route, /password\.changed/);
  assert.match(security, /min\(10/);
  assert.match(security, /\[A-Za-z\]/);
  assert.match(gate, /개인 비밀번호를 먼저 설정/);
  assert.match(auth, /PASSWORD_CHANGE_REQUIRED/);
  assert.match(auth, /allowPasswordChangeRequired/);
});

test("admin reset returns an active account to the initial-password state without exposing the password", async () => {
  const [route, migration, audit] = await Promise.all([
    read("app/api/v1/members/[id]/password-reset/route.ts"),
    read("supabase/migrations/202609020012_account_password_management.sql"),
    read("app/api/v1/audit/route.ts"),
  ]);
  assert.match(route, /actor\.role !== "admin"/);
  assert.match(route, /updateUserById\(targetId, \{ password: initialPassword \}\)/);
  assert.match(route, /must_change_password: true/);
  assert.match(route, /SELF_PASSWORD_RESET_FORBIDDEN/);
  assert.match(migration, /os_security_audit_logs/);
  assert.match(migration, /password\.changed/);
  assert.match(migration, /password\.reset/);
  assert.match(audit, /securityEvents/);
});
