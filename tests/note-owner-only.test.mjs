import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const sql = readFileSync("supabase/migrations/20261108090000_note_owner_only.sql", "utf8");

test("나만 보기: no audit grant, no edit or delete by anyone else, the setting ends when the note is shared to the team", () => {
  assert.match(sql, /create trigger os_note_grant_owner_only_guard before insert on public\.os_note_access_grants/);
  assert.match(sql, /create trigger os_documents_owner_only_guard before insert or update or delete on public\.os_documents/);
  assert.match(sql, /auth\.uid\(\) <> old\.owner_id\s+and \(old\.owner_only or \(tg_op = 'UPDATE' and new\.owner_only is distinct from old\.owner_only\)\)/);
  assert.match(sql, /if new\.status not in \('draft', 'archived'\) then new\.owner_only := false; end if;/);
  assert.match(sql, /if p_on then delete from public\.os_note_access_grants where document_id = any\(ids\); end if;/);
  assert.match(sql, /grant execute on function public\.os_set_note_owner_only\(uuid, uuid, boolean\) to service_role;/);
  assert.doesNotMatch(sql, /to authenticated/);
});

test("only the owner turns it on in 공유·링크, and an admin's audit attempt reads as a plain refusal", () => {
  const route = readFileSync("app/api/v1/documents/share/route.ts", "utf8");
  assert.match(route, /service\.rpc\("os_set_note_owner_only", \{ p_actor: actor\.id, p_document: doc\.id, p_on: input\.on \}\)/);
  const workspace = readFileSync("app/api/v1/knowledge/workspace/route.ts", "utf8");
  assert.match(workspace, /OS_NOTE_OWNER_ONLY[^\n]*「나만 보기」로 정한 노트입니다/);
  assert.match(workspace, /reader_scope,owner_only";/);
  const dialog = readFileSync("components/knowledge/document-share-dialog.tsx", "utf8");
  assert.match(dialog, /share\?\.canShareNote && <section><h3>나만 보기<\/h3>/);
});
