import assert from "node:assert/strict";
import test from "node:test";
import { vaultMemberOptions } from "../lib/knowledge-vault-members.ts";

const profile = { id: "self", displayName: "리키" };
const member = (id, name, extras = {}) => ({ id, display_name: name, is_active: true, account_connected: true, ...extras });

test("vault uses account IDs for owner filters, shows only roster people, and keeps self first", () => {
  const options = vaultMemberOptions([
    member("other-b", "유쓰"),
    member("self", "ricky-sample", { email: "ricky@example.test" }),
    member("shared", "브랜디액션 공통", { is_shared_account: true }),
    member("qa", "DEV E2E admin"),
    member("unknown", "unknown-login"),
    member("pending", "제이", { account_connected: false }),
    member("inactive", "로건", { is_active: false }),
    member("other-a", "안저"),
    member("unnamed", "", { legal_name: "에릭" }),
    member("no-name", "", { legal_name: "" }),
    member("other-a", "안저"),
  ], profile);
  assert.deepEqual(options, [
    { value: "mine", name: "리키" },
    { value: "member:other-a", name: "안저" },
    { value: "member:unnamed", name: "에릭" },
    { value: "member:other-b", name: "유쓰" },
  ]);
});

test("self remains selectable if the member directory is temporarily unavailable", () => {
  assert.deepEqual(vaultMemberOptions([], profile), [{ value: "mine", name: "리키" }]);
  assert.deepEqual(vaultMemberOptions([], null), []);
});

test("an unmapped login is shown as own account rather than an account ID", () => {
  assert.deepEqual(vaultMemberOptions([], { id: "self", displayName: "dev-user-1", email: "dev@example.test" }), [{ value: "mine", name: "내 계정" }]);
});
