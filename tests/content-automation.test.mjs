import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import {
  DEFAULT_CONTENT_AUTOMATION_SETTINGS,
} from "../lib/content-automation-settings.ts";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("automation settings are safe defaults and contain no credentials", async () => {
  assert.equal(DEFAULT_CONTENT_AUTOMATION_SETTINGS.generationMode, "queue");
  assert.equal(DEFAULT_CONTENT_AUTOMATION_SETTINGS.autoCollect, false);
  const source = await read("lib/content-automation-settings.ts");
  assert.doesNotMatch(source, /secret|token|password/i);
  assert.deepEqual(DEFAULT_CONTENT_AUTOMATION_SETTINGS.enabledChannels, ["youtube", "instagram", "threads"]);
});

test("internal automation screens do not depend on an external contents-auto URL", async () => {
  const [shell, navigation, page] = await Promise.all([
    read("components/app-shell.tsx"),
    read("lib/navigation.ts"),
    read("app/(os)/[stage]/[page]/page.tsx"),
  ]);
  assert.doesNotMatch(shell, /NEXT_PUBLIC_CONTENTS_AUTO_LINKS|external-app-link/);
  for (const route of ["dashboard", "review", "requests", "library", "calendar", "performance", "templates", "settings"]) {
    assert.match(navigation, new RegExp(`/automation/${route}`));
    assert.match(page, new RegExp(`/automation/${route}`));
  }
});

test("live publishing requires a service-only approval checkpoint and separate release flag", async () => {
  const [migration, service] = await Promise.all([
    read("supabase/migrations/20261004131203_content_publication_approval_checkpoints.sql"),
    read("lib/server/channel-publication.ts"),
  ]);
  assert.match(migration, /enable row level security/i);
  assert.match(migration, /revoke all on table public\.os_content_publication_approvals from public, anon, authenticated/i);
  assert.match(migration, /grant all on table public\.os_content_publication_approvals to service_role/i);
  assert.match(service, /PUBLICATION_APPROVAL_CHECKPOINTS_ENABLED/);
  assert.match(service, /META_LIVE_PUBLISH_ENABLED/);
  assert.match(service, /os_content_publication_approvals/);
});

test("YouTube reconnect requests Analytics read scope and collector stores API snapshots", async () => {
  const [oauth, metrics] = await Promise.all([
    read("lib/server/youtube-oauth.ts"),
    read("lib/server/channel-metrics.ts"),
  ]);
  assert.match(oauth, /yt-analytics\.readonly/);
  assert.match(metrics, /youtubeanalytics\.googleapis\.com\/v2\/reports/);
  assert.match(metrics, /YouTube Analytics API/);
  assert.match(metrics, /reconnectRequired/);
});

test("saved automation settings drive generation records, reminder lead time, collection and shorts defaults", async () => {
  const [mode, generation, queue, sync, cron] = await Promise.all([
    read("lib/content-generation-mode.ts"),
    read("lib/server/content-generation.ts"),
    read("lib/server/content-generation-queue.ts"),
    read("lib/server/channel-sync.ts"),
    read("app/api/v1/content/channel-sync/route.ts"),
  ]);
  assert.match(mode, /content_automation_settings/);
  assert.match(generation, /readContentAutomationSettings/);
  assert.match(generation, /voicePreset: automation\?\.shorts\.voicePreset/);
  assert.match(queue, /retryLimit: automation\?\.retryLimit/);
  assert.match(sync, /publishLeadMinutes/);
  assert.match(cron, /settings\.publishLeadMinutes/);
  assert.match(cron, /settings\.enabledChannels/);
});
