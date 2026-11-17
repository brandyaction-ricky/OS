import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { NOTIFICATION_REASONS } from "../lib/notifications.ts";

// 음성 시작 알림 (2026-11-17): a voice that waited for the render PC notifies who started it when it starts.
const read = (file) => readFileSync(new URL(`../${file}`, import.meta.url), "utf8");

test("the guard as deployed gains only yt_voice_start, next to yt_upload in both lists; running it again changes nothing", () => {
  const sql = read("supabase/migrations/20261117220000_notification_voice_start.sql");
  assert.match(sql, /pg_get_functiondef\('public\.os_notification_guard\(\)'::regprocedure\)/, "reads the deployed definition, never an old copy");
  assert.match(sql, /if position\('''yt_voice_start''' in def\) > 0 then return; end if;/);
  assert.match(sql, /<> 2 then\s*\n\s*raise exception/, "an unexpected guard stops the migration instead of a silent change");
  assert.match(sql, /execute replace\(def, '''yt_upload''', '''yt_upload'',''yt_voice_start'''\);/);
  // The repo's guard has exactly the two lists the migration extends.
  const guard = read("supabase/migrations/20261015130000_youtube_process_v1.sql");
  assert.equal(guard.split("'yt_upload'").length - 1, 2);
});

test("the notice has a label, and only a voice that waited ten minutes or more sends one, once per claim", () => {
  assert.equal(NOTIFICATION_REASONS.yt_voice_start, "음성 만들기 시작");
  const run = read("lib/server/myin-run.ts");
  assert.match(run, /const VOICE_START_NOTICE_MS = 10 \* 60_000;/);
  assert.match(run, /if \(claimed\) return \{ record: claimed, run: parse\(claimed\), lease, waitedSince: candidate\.updated_at \};/);
  assert.match(run, /if \(Date\.now\(\) - Date\.parse\(claimed\.waitedSince\) >= VOICE_START_NOTICE_MS\)\s*\n\s*await notify\(\[record\.owner_id, run\.paidOk\?\.by\]/);
  assert.match(run, /"yt_voice_start", run\.sourceId, `voice-start:\$\{record\.id\}:\$\{lease\.token\}`\)\s*\n\s*\.catch\(\(\) => undefined\);/, "a notice that fails never stops the voice");
});
