import assert from "node:assert/strict";
import test from "node:test";
import { operatingStatusLabel, roleLabel } from "../lib/company-settings.ts";
import { normalizedWorkspaceStatus, workspaceStatusLabel, WORKSPACE_CONFIGS } from "../lib/workspace-config.ts";

test("legacy decision states use the current Korean decision workflow", () => {
  const config = WORKSPACE_CONFIGS["/home/decisions"];
  assert.equal(normalizedWorkspaceStatus(config, "completed"), "decided");
  assert.equal(normalizedWorkspaceStatus(config, "superseded"), "cancelled");
  assert.equal(workspaceStatusLabel(config, "completed"), "결정");
  assert.equal(workspaceStatusLabel(config, "superseded"), "취소");
});

test("member roles and operating statuses have Korean labels", () => {
  assert.equal(roleLabel("member"), "구성원");
  assert.equal(roleLabel("admin"), "관리자");
  assert.equal(operatingStatusLabel("active"), "운영 중");
});
