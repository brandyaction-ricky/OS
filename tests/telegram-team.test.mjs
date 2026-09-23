import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { actionPreview, isOutdatedEvidence, knowledgeConflictNotice, parseTelegramAction } from "../lib/telegram-team.ts";

const result = (documentId, text, heading = "현재기준") => ({ documentId, chunkId: 1, title: documentId, folder: "02_Wiki", status: "canonical", brand: "", heading, text, score: 1, citation: { documentId, version: 1, chunkId: 1 } });

test("Telegram action commands produce a confirmable OS draft", () => {
  const draft = parseTelegramAction("/업무 랜딩 초안 검토 @worker 2026-09-25", new Date("2026-09-22T00:00:00Z"));
  assert.equal(draft.recordType, "task");
  assert.equal(draft.title, "랜딩 초안 검토");
  assert.equal(draft.assigneeUsername, "worker");
  assert.equal(draft.dueDate, "2026-09-25");
  assert.match(actionPreview(draft), /확인 전에는 저장되지 않습니다/);
});

test("hold and decision commands never become canonical document writes", () => {
  assert.deepEqual({ type: parseTelegramAction("/결정 A안 채택").recordType, status: parseTelegramAction("/결정 A안 채택").status }, { type: "decision", status: "decided" });
  assert.deepEqual({ type: parseTelegramAction("/보류 광고 집행").recordType, status: parseTelegramAction("/보류 광고 집행").status }, { type: "decision", status: "on_hold" });
});

test("outdated evidence is detectable and numeric conflicts are visible", () => {
  const current = result("current", "콘텐츠 하한은 주 2편이다.");
  const other = result("other", "콘텐츠 하한은 주 3편이다.");
  assert.match(knowledgeConflictNotice("하한이 주 몇 편이야?", [current, other]), /수치가 충돌/);
  assert.equal(isOutdatedEvidence(result("old", "더 이상 따르지 않는다. 주 5편")), true);
});

test("Telegram team workflow migration is additive, RLS protected and deduplicated", async () => {
  const sql = await readFile(new URL("../supabase/migrations/20260922003000_telegram_team_workflow.sql", import.meta.url), "utf8");
  assert.match(sql, /add column if not exists response_message_id bigint/);
  assert.match(sql, /add column if not exists profile_id uuid references public\.os_profiles/);
  assert.match(sql, /create table if not exists public\.os_telegram_chats/);
  assert.match(sql, /create table if not exists public\.os_telegram_feedback/);
  assert.match(sql, /alter table public\.os_telegram_chats enable row level security/);
  assert.match(sql, /os_records_telegram_action_turn_idx/);
  assert.doesNotMatch(sql, /^(insert into|copy) /im);
});
