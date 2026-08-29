import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (file) => readFile(new URL(`../${file}`, import.meta.url), "utf8");

test("canonical editing is deliberate, versioned and self-publishable", async () => {
  const [sql, workspace, route] = await Promise.all([read("supabase/migrations/202608290004_knowledge_self_publish.sql"), read("components/knowledge-workspace.tsx"), read("app/api/v1/documents/[id]/versions/route.ts")]);
  assert.match(sql, /status = 'canonical'.*is_active/s);
  assert.match(sql, /os_restore_document_version/);
  assert.match(sql, /v_from in \('draft', 'team', 'review', 'reviewed'\).*p_to = 'canonical'/s);
  assert.match(workspace, /정본 편집/);
  assert.match(workspace, /전 직원과 AI/);
  assert.match(route, /os_get_document_versions/);
});

test("meeting workflow includes prep, transcription and structured actions", async () => {
  const [workspace, summary, prep, transcription] = await Promise.all([read("components/meeting-workspace.tsx"), read("app/api/v1/meeting-summary/route.ts"), read("app/api/v1/meeting-prep/route.ts"), read("app/api/v1/meeting-transcription/route.ts")]);
  assert.match(workspace, /회의 준비/); assert.match(workspace, /녹음 전사/);
  assert.match(summary, /decisions/); assert.match(summary, /pending/); assert.match(summary, /todos/); assert.match(summary, /추측하지 마세요/);
  assert.match(prep, /record_type.*kpi/s); assert.match(transcription, /audio\/transcriptions/);
});

test("growth and phone capture use the transferred business contract", async () => {
  const [performance, telegram] = await Promise.all([read("components/performance-workspaces.tsx"), read("app/api/v1/telegram/webhook/route.ts")]);
  for (const field of ["gross", "cancel", "refund", "net", "orders", "buyers", "source"]) assert.match(performance, new RegExp(field));
  assert.match(performance, /영상 조회/); assert.match(performance, /스토어 방문/);
  for (const command of ["후기", "썸네일기록", "#raw", "인박스", "요약"]) assert.match(telegram, new RegExp(command));
  assert.match(telegram, /wjdgh1346@gmail\.com/);
});
