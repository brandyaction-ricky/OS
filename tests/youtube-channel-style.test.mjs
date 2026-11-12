import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { channelBriefText, channelFormats, channelMismatch, channelOf, channelStyleInput, formatOfKind, keepsDefault, nextStyles, pinStyle, purposeCanonTitle, canonChannels, followCanon } from "../lib/youtube-process/channel-style.ts";

// 유쓰 요청 5/8 (2026-11-02): per-channel look pinned to a video with its version; the render PC lays it over a copy of the storyboard.
const style = { id: "11111111-1111-4111-8111-111111111111", name: "마이인", channel: "마이인", tone: { base: "myin", key: "#1F7A4D", ink: "#1B2420", page: "#FFFFFF" }, ending: "talk", logo: true };

test("a changed look gets the next version; an unchanged one keeps it", () => {
  const first = nextStyles([], [style], "유쓰", "2026-11-02T01:00:00Z");
  assert.equal(first[0].version, 1);
  assert.equal(nextStyles(first, [style], "유쓰", "x")[0], first[0], "saving the same look keeps version and time");
  const second = nextStyles(first, [{ ...style, logo: false }], "로건", "2026-11-02T02:00:00Z");
  assert.equal(second[0].version, 2); assert.equal(second[0].by, "로건");
  assert.deepEqual(Object.keys(pinStyle(second[0])).sort(), ["channel", "ending", "id", "logo", "name", "tone", "version"]);
});

test("the upload channel is compared with the style's, only when both are named", () => {
  assert.equal(channelMismatch(style, "브랜디액션"), true);
  assert.equal(channelMismatch(style, "마이인"), false);
  assert.equal(channelMismatch({ channel: "" }, "브랜디액션"), false);
  assert.equal(channelMismatch(null, "브랜디액션"), false);
});

test("the render PC draws a styled copy; the storyboard it keeps and sends back stays as written", async () => {
  const worker = await import(`../tools/youtube-media-worker.mjs?style=${Date.now()}`);
  const root = mkdtempSync(path.join(os.tmpdir(), "myin-style-")), videoDir = path.join(root, "voice"), myinDir = path.join(root, "tools");
  mkdirSync(videoDir); mkdirSync(myinDir);
  const story = { scenes: [{ type: "opening" }, { type: "lib_stage_phone" }, { type: "lib_iceberg", theme: "card" }], ending: "outro" };
  writeFileSync(path.join(videoDir, "myin_storyboard.json"), JSON.stringify(story));
  writeFileSync(path.join(myinDir, "톤앤매너.json"), JSON.stringify({ _설명: "x", forest: { base: "myin", key: "#1F7A4D" } }));
  assert.equal(worker.styleStoryboard(videoDir, myinDir, undefined), "myin_storyboard.json", "no style: the storyboard itself");
  assert.equal(worker.styleStoryboard(videoDir, myinDir, style), "myin_storyboard_styled.json");
  let styled = JSON.parse(readFileSync(path.join(videoDir, "myin_storyboard_styled.json"), "utf8"));
  assert.deepEqual(styled.scenes.map((sc) => sc.theme), [undefined, undefined, "card"], "no tone tool in this package: no theme");
  writeFileSync(path.join(myinDir, "myin_tone.py"), "");
  worker.styleStoryboard(videoDir, myinDir, style);
  styled = JSON.parse(readFileSync(path.join(videoDir, "myin_storyboard_styled.json"), "utf8"));
  assert.deepEqual(styled.scenes.map((sc) => sc.theme), [undefined, "os_channel", "card"], "diagram scenes without their own theme");
  assert.equal(styled.ending, "outro", "the storyboard's own ending wins"); assert.equal(styled.logo, "on");
  const tones = JSON.parse(readFileSync(path.join(myinDir, "톤앤매너.json"), "utf8"));
  assert.deepEqual(tones.os_channel, style.tone); assert.ok(tones.forest, "his tones stay");
  assert.deepEqual(JSON.parse(readFileSync(path.join(videoDir, "myin_storyboard.json"), "utf8")), story, "the kept storyboard is untouched");
});

test("the OS pins the style at the voice's start and hands it to every drawing step", async () => {
  const run = await readFile(new URL("../lib/server/myin-run.ts", import.meta.url), "utf8");
  assert.match(run, /\.\.\.\(picked \? \{ style: pinStyle\(picked\) \} : \{\}\)/);
  assert.equal(run.match(/\.\.\.styleFor\(run\)/g)?.length, 4, "prep, clips, scene pictures and the full video");
  const runKey = run.slice(run.indexOf("const runKey = digestVoiceValue("), run.indexOf("const id = voiceRunId(runKey)"));
  assert.doesNotMatch(runKey, /style/, "a style never makes a new voice");
  const worker = await readFile(new URL("../tools/youtube-media-worker.mjs", import.meta.url), "utf8");
  assert.equal(worker.match(/STORY: styleStoryboard\(videoDir, myinDir, job\.style\)/g)?.length, 3);
});

// 다채널 1단계 (2026-11-07, OS 문서 「다채널 콘텐츠 운영 설계」): the same list is the 채널 카드; the first card is the 기본 채널.
const brandyaction = { id: "11111111-1111-4111-8111-111111111112", name: "브랜디액션", channel: "브랜디액션", tone: null, ending: "talk", logo: false, version: 1, updatedAt: "2026-11-04T05:49:19.969Z", by: "대표" };
const moonshot = { id: "22222222-2222-4222-8222-222222222222", name: "마케팅 신설", channel: "", tone: null, ending: "talk", logo: false, purpose: "문샷 무료강의 유입", concept: "반복 업무를 AI에 넘기는 법", topics: "자동화 · 에이전트", formats: ["short", "card", "threads"] };

test("a card saved before channels reads as every format; a new one keeps what it was given", () => {
  assert.deepEqual(channelFormats(brandyaction), ["long", "short", "card", "threads"]);
  assert.deepEqual(channelFormats(moonshot), ["short", "card", "threads"]);
  assert.deepEqual(channelFormats(undefined), ["long", "short", "card", "threads"], "no card at all: nothing is hidden");
  assert.deepEqual(["live", "anim", "short", "card"].map(formatOfKind), ["long", "long", "short", "card"]);
  const parsed = channelStyleInput.parse({ id: brandyaction.id, name: "브랜디액션", channel: "브랜디액션", tone: null, ending: "talk", logo: false });
  assert.deepEqual([parsed.purpose, parsed.concept, parsed.topics, parsed.formats], ["", "", "", ["long", "short", "card", "threads"]], "an older client's save keeps every format");
  assert.throws(() => channelStyleInput.parse({ ...moonshot, formats: [] }), /운영 형식/);
});

test("a project without a channel belongs to the 기본 채널; one with a removed channel too", () => {
  const cards = [brandyaction, { ...moonshot, version: 1 }];
  assert.equal(channelOf(cards, undefined), brandyaction);
  assert.equal(channelOf(cards, moonshot.id).name, "마케팅 신설");
  assert.equal(channelOf(cards, "33333333-3333-4333-8333-333333333333"), brandyaction);
  assert.equal(channelOf([], undefined), undefined);
});

test("the 기본 채널 cannot be removed or moved; editing a card's concept is a new version, as a look change is", () => {
  assert.equal(keepsDefault([], [moonshot]), true, "the first save picks the 기본 채널");
  assert.equal(keepsDefault([brandyaction], [brandyaction, moonshot]), true);
  assert.equal(keepsDefault([brandyaction], [moonshot, brandyaction]), false);
  assert.equal(keepsDefault([brandyaction], [moonshot]), false);
  const input = channelStyleInput.parse({ id: brandyaction.id, name: "브랜디액션", channel: "브랜디액션", tone: null, ending: "talk", logo: false });
  assert.equal(nextStyles([brandyaction], [input], "x", "y")[0], brandyaction, "saving an older card unchanged keeps its version");
  const next = nextStyles([brandyaction], [{ ...input, concept: "내 강점이 돈 되는 자리" }], "대표", "2026-11-07T01:00:00Z");
  assert.equal(next[0].version, 2); assert.equal(next[0].concept, "내 강점이 돈 되는 자리");
  assert.deepEqual(Object.keys(pinStyle(next[0])).sort(), ["channel", "ending", "id", "logo", "name", "tone", "version"], "a video still pins only the look");
});

test("every way a project is made carries its channel; the save keeps the 기본 채널", async () => {
  const read = (file) => readFile(new URL(`../lib/server/${file}`, import.meta.url), "utf8");
  const [process, cards, short, styles] = await Promise.all([read("youtube-process.ts"), read("youtube-process-cards.ts"), read("youtube-process-short-script.ts"), read("youtube-channel-styles.ts")]);
  assert.match(process, /\.\.\.\(input\.channel \? \{ channel: input\.channel \} : \{\}\)/, "a new project keeps the channel picked");
  assert.match(process, /\.\.\.\(channel \? \{ channel \} : \{\}\) \}/, "an edit keeps or changes it");
  assert.equal(process.match(/await assertChannel\(/g)?.length, 2, "create and edit check the channel exists");
  assert.match(short, /channel: longform\.yp\.topic\.channel \?\? null/, "a 숏폼 from a longform takes the longform's channel");
  assert.match(cards, /channel: project\.yp\.topic\.channel \}/, "a 카드뉴스 from a video takes the video's channel");
  assert.match(cards, /\.\.\.\(channel \? \{ channel \} : \{\}\) \}, now\)/);
  assert.match(styles, /if \(!keepsDefault\(current\.styles, input\.styles\)\)/);
  assert.match(styles, /max\(50\)/, "room for 20+ channels");
});

// 다채널 2단계 (2026-11-07): a channel speaks with its own Fish voice; one script is never voiced for two channels.
test("a card's voice is a Fish id or empty, and changing it is a new version", () => {
  const input = channelStyleInput.parse({ id: moonshot.id, name: "퇴사 선배", channel: "", tone: null, ending: "talk", logo: false });
  assert.equal(input.voice, "", "empty = the OS's own voice");
  assert.equal(channelStyleInput.parse({ ...input, voice: " 0123abcdef0123abcdef0123abcdef01 " }).voice, "0123abcdef0123abcdef0123abcdef01");
  assert.throws(() => channelStyleInput.parse({ ...input, voice: "id with spaces" }), /목소리 ID/);
  const first = nextStyles([], [input], "a", "t1");
  assert.equal(nextStyles(first, [{ ...input, voice: "0123abcdef0123abcdef0123abcdef01" }], "b", "t2")[0].version, 2);
});

test("every voice the OS asks Fish for or hands the render PC is the run's channel voice", async () => {
  const [run, say, worker] = await Promise.all([readFile(new URL("../lib/server/myin-run.ts", import.meta.url), "utf8"), readFile(new URL("../lib/server/myin-say.ts", import.meta.url), "utf8"),
    readFile(new URL("../tools/youtube-media-worker.mjs", import.meta.url), "utf8")]);
  assert.equal(run.match(/FISH_VOICE_REFERENCE_ID/g)?.length, 1, "the OS's own voice is read in one place, runVoice");
  assert.match(run, /export const runVoice = \(run\?: \{ voiceReference\?: string \}\) => run\?\.voiceReference \|\| process\.env\.FISH_VOICE_REFERENCE_ID/);
  assert.equal(run.match(/fishVoice\(\)/g), null, "no job gets the default voice by mistake");
  assert.equal(run.match(/fishVoice\(run\)/g)?.length, 3, "words, 구독 대사 and prep jobs");
  assert.match(run, /\.\.\.\(channelVoice \? \{ voiceReference: channelVoice \} : \{\}\)/, "only a channel voice is written on the run");
  assert.ok(run.indexOf("await assertOneChannel(") < run.indexOf('record_type: "ai_job", title: `${input.state.source.title}'), "checked before the run is made");
  assert.match(say, /fishVoice: fishVoice\(meta\)/, "sentence takes speak with the run's voice");
  assert.match(worker, /voice = job\.fishVoice\?\.referenceId\?\.trim\(\)/, "the render PC uses the voice the job brings");
});

// 다채널 2단계 (2): one person connects several YouTube channels; every upload names the channel it goes to.
test("where a video goes up: picked, else its card's channel, else the card's channel name, else the first — on all three upload screens", async () => {
  const read = (file) => readFile(new URL(`../components/${file}`, import.meta.url), "utf8");
  const [styles, upload, short, shorts] = await Promise.all([read("youtube-channel-styles.tsx"), read("youtube-process-upload.tsx"), read("youtube-process-short.tsx"), read("youtube-process-shorts.tsx")]);
  assert.match(styles, /const chosen = rows\.find\(row => row\.channelId === picked\) \?\? rows\.find\(row => card\?\.youtube && row\.channelId === card\.youtube\)\s+\?\? rows\.find\(row => card\?\.channel\.trim\(\) && row\.accountName\.trim\(\) === card\.channel\.trim\(\)\) \?\? rows\[0\];/);
  assert.match(styles, /account: chosen \? \{ connectionOwnerId: chosen\.ownerId, connectionChannelId: chosen\.channelId \} : \{\}/);
  for (const [name, screen] of [["upload", upload], ["short", short], ["shorts", shorts]]) {
    assert.match(screen, /useUploadChannel\((page\.bundle\?\.)?project(\?)?\.yp\.topic\.channel\)/, `${name} uses the shared rule`);
    assert.doesNotMatch(screen, /"\/api\/v1\/channels"/, `${name} no longer picks the first connection on its own`);
  }
  assert.equal(upload.match(/\.\.\.account \}\)/g)?.length, 2, "session and complete send the channel");
  assert.equal(short.match(/\.\.\.account \}\)/g)?.length, 2);
  const card = channelStyleInput.parse({ id: moonshot.id, name: "x", channel: "", tone: null, ending: "talk", logo: false });
  assert.equal(card.youtube, "", "no YouTube channel picked = by name, else the first");
  const first = nextStyles([], [card], "a", "t1");
  assert.equal(nextStyles(first, [{ ...card, youtube: "UCabcdefghijklmnopqrstuv" }], "b", "t2")[0].version, 2, "linking a channel is a new version");
});

test("a YouTube connection is (person, channel): the key, every token, status and disconnect name the channel", async () => {
  const [migration, rollback, oauth, routeFile, testRoute, uploadServer, cta, metrics] = await Promise.all([
    "../supabase/migrations/20261107120000_youtube_connections_per_channel.sql", "../supabase/rollback/20261107120000_youtube_connections_per_channel.down.sql",
    "../lib/server/youtube-oauth.ts", "../app/api/v1/youtube/oauth/route.ts", "../app/api/v1/youtube/oauth/test/route.ts", "../lib/server/youtube-process-upload.ts",
    "../lib/server/youtube-cta.ts", "../lib/server/youtube-channel-analytics.ts"].map((file) => readFile(new URL(file, import.meta.url), "utf8")));
  assert.match(migration, /add constraint os_youtube_connections_pkey primary key \(owner_id, channel_id\);/);
  assert.match(rollback, /add constraint os_youtube_connections_pkey primary key \(owner_id\);/);
  assert.match(oauth, /channelId \? query\.eq\("channel_id", channelId\) : query\.order\("connected_at", \{ ascending: true \}\)\.limit\(1\)/, "no channel named = the person's first, as before");
  assert.doesNotMatch(oauth, /CHANNEL_REPLACEMENT_REQUIRED/, "a second channel is added, not refused");
  assert.match(oauth, /const existing = await loadYoutubeConnection\(ownerId, channel\.id\);/);
  assert.match(oauth, /\.eq\("owner_id", ownerId\)\.eq\("channel_id", connection\.channel_id\);\n  if \(error\) throw new ApiError\(500, "YOUTUBE_TOKEN_SAVE_FAILED"/, "a refreshed token is saved on its own channel");
  assert.match(oauth, /\.delete\(\)\.eq\("owner_id", ownerId\)\.eq\("channel_id", connection\.channel_id\)/, "disconnect removes one channel");
  assert.match(routeFile, /\.eq\("owner_id", actor\.id\)\.eq\("channel_id", connection\.channel_id\)/, "team sharing changes one channel");
  assert.match(routeFile, /await disconnectYoutube\(ownerId, channelId\)/);
  assert.match(testRoute, /authorizeYoutubeConnection\(actor, ownerId, input\.channelId\)/);
  assert.equal(uploadServer.match(/authorizeYoutubeConnection\(actor, ownerId, input\.connectionChannelId\)/g)?.length, 5, "longform, its check, processing and both Shorts steps");
  assert.doesNotMatch(uploadServer, /getYoutubeAccessToken\(ownerId\)|youtubeConnectionStatus\(ownerId\)/);
  assert.match(cta, /const ownerId = change\.connectionOwnerId \?\? input\.ownerId \?\? actor\.id;/, "an undo uses the connection the change went through");
  assert.match(metrics, /getYoutubeAccessToken\(connection\.owner_id, connection\.channel_id\)/, "metrics read each channel with its own token");
});

// 다채널 3단계: another channel's AI work reads its card and its 목적 정본 first; the 기본 채널 reads what it always read.
test("a channel's brief names its card and its 목적 정본 by doc_id, and says the 정본 wins over the 마이인 ones", () => {
  assert.equal(purposeCanonTitle(" 문샷 무료강의 유입 "), "목적 정본 — 문샷 무료강의 유입");
  const canon = { id: "44444444-4444-4444-8444-444444444444", title: purposeCanonTitle("문샷 무료강의 유입") };
  const text = channelBriefText({ ...moonshot, version: 1, updatedAt: "", by: "" }, canon);
  assert.match(text, /^## 이 영상의 채널 — 「마케팅 신설」 \(먼저 읽기\)/);
  assert.match(text, /- 목적 정본: 「목적 정본 — 문샷 무료강의 유입」 \(doc_id: 44444444-4444-4444-8444-444444444444\)/, "GPT pastes it in by this doc_id");
  assert.match(text, /- 운영 형식: 숏폼 · 카드뉴스 · 스레드/);
  assert.match(text, /내용이 목적 정본과 다르면 목적 정본이 이깁니다\. 마이인 진단 · 마이인 링크 · 마이인 전용 표현은 이 채널에 쓰지 않습니다\./);
  assert.doesNotMatch(channelBriefText({ ...brandyaction, purpose: "x" }, canon), /컨셉|주제 축/, "empty card lines are left out");
});

test("every AI job and the second review read the channel; the 기본 채널 and a channel without its 정본 are handled before the job is taken", async () => {
  const read = (file) => readFile(new URL(file, import.meta.url), "utf8");
  const [server, jobs, review, review2] = await Promise.all([read("../lib/server/channel-canon.ts"), read("../lib/server/youtube-ai-jobs.ts"),
    read("../lib/server/youtube-script-review2.ts"), read("../lib/youtube-script-review2.ts")]);
  assert.match(server, /if \(!card \|\| card\.id === styles\[0\]\.id\) return null;/, "the 기본 채널 adds nothing");
  assert.match(server, /"CHANNEL_PURPOSE_MISSING"/); assert.match(server, /"CHANNEL_CANON_MISSING"/);
  assert.match(jobs, /if \(input\.task !== "image-creative"\) await channelContext\(input\.task === "niche" \? null : input\.sourceId\);\n  for \(const job of imageJobs \?\? await openJobs/, "a request without the 정본 fails at once");
  const claim = jobs.slice(jobs.indexOf("export async function claimStaffJob"), jobs.indexOf("async function claimJob("));
  assert.ok(claim.indexOf("channelContext(") < claim.indexOf("await claimJob("), "read before the job is taken");
  assert.match(claim, /const instructions = channel \? `\$\{channel\.text\}\\n\\n\$\{claimed\.instructions\}` : claimed\.instructions;/);
  assert.match(claim, /return byGpt \? \{ \.\.\.claimed, instructions \} : \{ \.\.\.claimed, instructions: `\$\{instructions\}\\n\\n\$\{REPORT_NOTE\}` \};/, "staff AI and GPT both");
  assert.match(review, /const channel = await channelContext\(project\.id\);/);
  assert.match(review2, /=== \[이 영상의 채널\] ===/);
  const { review2Prompt } = await import("../lib/youtube-script-review2.ts");
  const video = { title: "제목", thumbCopy: "", script: "첫 문단" };
  assert.doesNotMatch(review2Prompt({ review: "r", tone: "t" }, video).prefix, /이 영상의 채널/, "the 기본 채널's review is as before");
  assert.match(review2Prompt({ review: "r", tone: "t" }, video, { text: "채널 글", title: "목적 정본 — x", content: "정본 본문" }).prefix,
    /=== \[원고 말투 정본\] ===\nt\n\n=== \[이 영상의 채널\] ===\n채널 글\n\n=== \[목적 정본 — x\] ===\n정본 본문$/);
});

// 다채널 2단계 (3): one person connects several Instagram and Threads accounts; every use names the account.
test("an Instagram / Threads connection is (person, platform, account): key, Threads claim, tokens, share and disconnect", async () => {
  const read = (file) => readFile(new URL(file, import.meta.url), "utf8");
  const [migration, rollback, original, oauth, route, threads, threadsRoute, comments, metrics, publication, publish] = await Promise.all([
    "../supabase/migrations/20261107150000_meta_connections_per_account.sql", "../supabase/rollback/20261107150000_meta_connections_per_account.down.sql",
    "../supabase/migrations/20261029052357_threads_personal_api_publication.sql", "../lib/server/meta-oauth.ts", "../app/api/v1/meta/[action]/route.ts",
    "../lib/server/threads-publication.ts", "../app/api/v1/content/automation/threads-publication/[id]/route.ts", "../lib/server/channel-comments.ts",
    "../lib/server/channel-metrics.ts", "../lib/server/channel-publication.ts", "../app/api/v1/content/publish/route.ts"].map(read));
  assert.match(migration, /add constraint os_meta_connections_pkey primary key \(owner_id, platform, external_account_id\);/);
  assert.match(rollback, /add constraint os_meta_connections_pkey primary key \(owner_id, platform\);/);
  const claim = (sql) => sql.slice(sql.indexOf("function public.os_threads_publication_claim("), sql.indexOf("end $$;", sql.indexOf("function public.os_threads_publication_claim(")));
  assert.equal(claim(migration).replace("\n    and external_account_id=p_external_account_id;", ";"), claim(original), "the claim body is the original's but for the account in its lookup");
  assert.equal(claim(rollback), claim(original), "the rollback puts the original body back");
  assert.match(oauth, /: await query\.order\("connected_at", \{ ascending: true \}\)\.limit\(1\)\.maybeSingle\(\);/, "no account named = the person's first, as before");
  assert.match(oauth, /\.find\(row => metaAccountKey\(row\) === accountKey\)/, "a screen names an account by its key, never the platform id");
  assert.doesNotMatch(oauth, /CHANNEL_REPLACEMENT_REQUIRED/, "a second account is added, not refused");
  assert.equal(oauth.match(/\.eq\("external_account_id", connection\.external_account_id\)/g)?.length, 2, "test and refresh write their own account");
  assert.equal(route.match(/\.eq\("external_account_id", connection\.external_account_id\)/g)?.length, 2, "share and disconnect touch one account");
  assert.match(threads, /authorizeMetaConnection\(actor, input\.accountOwnerId, "threads", "use", input\.accountKey\)/);
  assert.match(threadsRoute, /accountKey: z\.string\(\)\.regex\(\/\^\[0-9a-f\]\{24\}\$\/\)\.optional\(\)/);
  assert.match(comments, /loadMetaConnection\(account\.ownerId,account\.platform as "instagram"\|"threads",account\.accountKey\)/);
  assert.match(metrics, /loadMetaConnection\(account\.ownerId,account\.platform,account\.accountKey\)/);
  for (const source of [publication, publish]) assert.match(source, /settings\.account\.platform,"use",settings\.account\.accountKey\)/);
});

// 2026-11-08 대표: the 기본 채널 card showed marketing examples; a card's 목적 · channel come from the 정본, not typed.
test("a 목적 정본's 「채널 카드」 table gives the channels to pick; ⛔ cells stay empty", () => {
  const md = "# 목적 정본 — x\n\n## 10. 열린 질문\n| a | b |\n\n## 11. 채널 카드\n\n| 채널 | 컨셉 | 주제 축 |\n|---|---|---|\n| 퇴사선배윤익 | 강사가 직접 해 본 자동화 | ⛔ |\n| ⛔ 마케팅 신설 | ⛔ | ⛔ |\n\n## 근거\n| 표 | 아님 |\n";
  assert.deepEqual(canonChannels(md), [{ name: "퇴사선배윤익", concept: "강사가 직접 해 본 자동화", topics: "" }], "a row without a decided name is left out");
  assert.deepEqual(canonChannels("# 정본\n본문만"), []);
});

test("the editor picks 목적 from the OS 목적 정본 list and fills a channel from its table; the 기본 채널 shows the 마이인 정본, no examples", async () => {
  const read = (file) => readFile(new URL(file, import.meta.url), "utf8");
  const [editor, route] = await Promise.all([read("../components/youtube-channel-styles.tsx"), read("../app/api/v1/content/youtube/channel-styles/route.ts")]);
  assert.match(route, /purposes: await purposeCanons\(\)/);
  assert.match(editor, /<span>목적 <span className="yp-hint">필수 · OS의 목적 정본 문서에서 골라요<\/span><\/span><select/); assert.doesNotMatch(editor, /datalist|placeholder="예\)/);
  assert.match(editor, /index === 0 \? <dl className="yp-kv"><dt>목적<\/dt><dd>마이인 진단 유입<\/dd>/);
  // same frame as the other 채널/링크 관리 tabs: a yp-card per channel, the look folded away, no inline style
  assert.match(editor, /<section key=\{style\.id\} className="yp-card">/); assert.match(editor, /<details className="yp-chstyle-more">/);
  assert.doesNotMatch(editor.slice(editor.indexOf("export function ChannelStyleEditor")), /style=\{\{/);
  assert.match(editor, /if \(pick\) set\(index, pick\)/);
});

// 대표 2026-11-08 「정본은 언제든 편하게 바꿀 수 있게」: the 정본 table is the one place; a picked channel follows it, in the AI brief and on the card.
test("a card named like a 정본 row follows that row; renamed in the 정본, it keeps its own until picked again", async () => {
  const channels = canonChannels("## 11. 채널 카드\n| 채널 | 컨셉 | 주제 축 |\n|---|---|---|\n| 퇴사선배윤익 | 새 컨셉 | ⛔ |\n");
  assert.deepEqual(followCanon({ name: " 퇴사선배윤익 ", concept: "예전 컨셉", topics: "예전 축" }, channels), { name: " 퇴사선배윤익 ", concept: "새 컨셉", topics: "" });
  const other = { name: "다른 채널", concept: "내 컨셉", topics: "" };
  assert.equal(followCanon(other, channels), other);
  const [server, editor] = await Promise.all(["../lib/server/channel-canon.ts", "../components/youtube-channel-styles.tsx"].map(file => readFile(new URL(file, import.meta.url), "utf8")));
  assert.match(server, /const followed = followCanon\(card, canon\.channels\);\n  return \{ card: followed, canon, text: channelBriefText\(followed, canon\) \};/);
  assert.match(editor, /고치기<\/Link> <span className="yp-hint">고치면 이 채널에 바로 반영돼요/);
});
