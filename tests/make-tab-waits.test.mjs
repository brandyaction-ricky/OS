import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

// Staff test 11-06 on the 제작 tab: a refusal nobody saw, a storyboard request that waited for a hand, a preview nobody heard of.
const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const run = read("lib/server/myin-run.ts");
const between = (text, from, to) => text.slice(text.indexOf(from), text.indexOf(to, text.indexOf(from)));

test("a refusal of any step's button stays on screen while the steps are", () => {
  const css = read("components/youtube-production-steps.css");
  assert.match(css, /\.yt-steps > \.inline-alert \{ position: sticky; bottom: 12px;/);
  const panel = read("components/myin-v13-panel.tsx");
  assert.match(panel, /\{error \? <p className="inline-alert danger" role="alert">\{error\}<\/p> : null\}\n {2}<\/div>;\n\}/, "the alert is the steps' own last child");
});

test("words ready again send the storyboard to whoever asked for it last", () => {
  const words = between(run, "export async function completeMyinWords", "export async function failMyinWords");
  assert.match(words, /if \(stage === "words_ready"\) await resendStoryboard\(run\.sourceId, record\.id\);/, "an edited 원고's new voice or fixed sentences");
  const gate = between(run, "if (gate.length) {", "return { runId: record.id, stage: \"words_ready\"");
  assert.match(gate, /await resendStoryboard\(run\.sourceId, record\.id\);/, "렌더 전 관문's 수정 요청");
  const jobs = read("lib/server/youtube-ai-jobs.ts");
  const resend = between(jobs, "export async function resendStoryboard", "export async function staffJobStatus");
  assert.match(resend, /\.eq\("metadata->>task", "storyboard"\)[\s\S]*\.order\("created_at", \{ ascending: false \}\)\.limit\(1\)/);
  assert.match(resend, /if \(!last\?\.owner_id \|\| meta\(last\)\.executor\) return null;/, "nothing asked before, or a GPT one: not sent");
  assert.match(resend, /requestStaffJob\(\{ id: last\.owner_id, supabase: service\(\) \}/, "the same person's own request, so their AI takes it");
});

test("finished preview drafts tell the storyboard's confirmer and the PD, with a notice reason the database already takes", () => {
  const clips = between(run, "export async function completeMyinClips", "export async function confirmMyinClips");
  assert.match(clips, /await notify\(\[run\.review\?\.by, project\?\.assignee_id\][^\n]*"ai_result", run\.sourceId, `preview:\$\{record\.id\}:/);
  assert.ok(clips.indexOf("notify(") > clips.indexOf('"clips_review", next)'), "after the drafts are saved");
  assert.match(read("supabase/migrations/20261015130000_youtube_process_v1.sql"), /'ai_result','computer_silent','publish_due','yt_confirm_request'/);
});
