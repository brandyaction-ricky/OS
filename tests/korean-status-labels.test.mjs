import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

test("legacy decision, program, subscription and member codes are rendered in Korean", () => {
  const auditLabels = read("lib/audit-labels.ts");
  const companyLabels = read("lib/company-settings.ts");
  const members = read("components/members-workspace.tsx");
  const finance = read("components/finance-workspace.tsx");
  const workspaces = read("lib/workspace-config.ts");
  const operations = read("components/operations-workspace.tsx");

  assert.match(auditLabels, /program: "프로그램"/);
  assert.match(auditLabels, /completed: "완료"/);
  assert.match(auditLabels, /superseded: "대체됨"/);
  assert.match(companyLabels, /active: "운영 중"/);
  assert.match(companyLabels, /superseded: "대체됨"/);
  assert.match(members, /roleLabel\(selected\.role\)/);
  assert.match(finance, /operatingStatusLabel\(item\.status\)/);
  assert.match(workspaces, /completed: "완료"/);
  assert.match(workspaces, /superseded: "대체됨"/);
  assert.match(operations, /auditStatusLabel\(record\.status, config\.recordType\)/);
});
