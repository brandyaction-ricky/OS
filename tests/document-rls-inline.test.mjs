import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const sql = readFileSync("supabase/migrations/20261029090000_document_rls_inline.sql", "utf8");
const policy = name => sql.slice(sql.indexOf(`alter policy ${name}`)).split(/\n\);/)[0];

test("document read policies call no per-row rule function and look up readers once per query", () => {
  for (const name of ["os_documents_select", "workspace_documents_read"]) {
    const body = policy(name);
    assert.doesNotMatch(body, /os_workspace_document_row_read|os_canonical_reader\(/, name);
    for (const flag of ["auth.uid", "os_is_admin", "os_is_active_member", "os_is_partner", "os_workspace_my_note_grants", "os_my_reader_documents"])
      for (const use of body.matchAll(new RegExp(`public\\.${flag}\\(\\)|${flag.replace(".", "\\.")}\\(\\)`, "g")))
        assert.equal(body.slice(use.index - 8, use.index).includes("select"), true, `${name}: ${flag} must be an InitPlan (select ...)`);
  }
  assert.match(sql, /grant execute on function public\.os_my_reader_documents\(\) to authenticated, service_role/);
  assert.doesNotMatch(sql, /\b(insert|update|delete)\b\s+(into|public\.|from)/i);
});
