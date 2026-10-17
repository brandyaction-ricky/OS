import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

// Telegram chats are not checked per document, so every service read that can
// reach a chat must exclude restricted canonical documents.
test("telegram help, baseline, meeting prep and digest only read documents open to every member", async () => {
  const read = path => readFile(new URL(`../${path}`, import.meta.url), "utf8");
  const [webhook, meetingPrep, digest] = await Promise.all([read("app/api/v1/telegram/webhook/route.ts"), read("lib/server/meeting-prep.ts"), read("app/api/v1/telegram/digest/route.ts")]);
  const help = webhook.slice(webhook.indexOf("async function telegramHelp"), webhook.indexOf("async function telegramHelp") + 600);
  assert.match(help, /\.eq\("reader_scope", "all"\)/);
  const baseline = webhook.slice(webhook.indexOf("async function handleOperatingBaselineView"), webhook.indexOf("async function handleOperatingBaselineView") + 900);
  assert.match(baseline, /\.eq\("reader_scope", "all"\)/);
  assert.match(meetingPrep, /주간회의요약[\s\S]{0,200}\.eq\("reader_scope", "all"\)/);
  assert.match(digest, /\.eq\("status", "canonical"\)\.eq\("reader_scope", "all"\)/);
});
