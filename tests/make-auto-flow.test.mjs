import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

// 로건 11-13 (대표 11-16 「자동」): one press after the script, the storyboard confirms itself, the gate loops by itself up to a limit, and the
// make tab is the editor screen with where the video is now.
const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const between = (text, from, to) => text.slice(text.indexOf(from), text.indexOf(to, text.indexOf(from)));
const run = read("lib/server/myin-run.ts");

test("a 롱폼 (and a 숏폼 cut from one) confirms its storyboard by itself unless its 제작 설정 asks for a person; other 숏폼 keep their 확인", () => {
  assert.match(run, /export const autoConfirms = \(run: Pick<MyinRun, "layout" \| "settings" \| "recycle">\) => \(!run\.layout \|\| Boolean\(run\.recycle\)\) && run\.settings\?\.confirm !== "person";/);
  const save = between(run, "export async function saveMyinStoryboard", "/** Who confirms a storyboard");
  assert.match(save, /return autoConfirms\(next\) \? confirmByItself\(service, saved\)\.catch\(/, "a failed self-confirm leaves it at 확인 대기");
  const self = between(run, "async function confirmByItself", "/** ③ drafts go to");
  assert.match(self, /await assertCurrent\(service, run\);/, "a changed 원고 is never confirmed by itself");
  assert.match(self, /name: MYIN_AUTO_CONFIRM_NAME/);
  assert.match(self, /placeStep\(next, /, "placed by the 제작 설정 as a person's 확인 is");
  assert.match(self, /return beginDraft\(service, saved, parse\(saved\)\);/, "③ starts");
});

test("the first storyboard is asked of the starter's AI once the words are ready", () => {
  const words = between(run, "export async function completeMyinWords", "export async function failMyinWords");
  assert.match(words, /resendStoryboard\(run\.sourceId, record\.id, autoConfirms\(run\) \? run\.settings\?\.by \?\? record\.owner_id \?\? undefined : undefined, gptStoryboardFor\(run, record\)\)/);
  assert.match(run, /await module\.resendStoryboard\(sourceId\) \?\? \(first \? module\.requestFirstStoryboard\(sourceId, first\) : null\)/);
  const first = between(read("lib/server/youtube-ai-jobs.ts"), "export async function requestFirstStoryboard", "export async function staffJobStatus");
  assert.match(first, /if \(data\?\.length\) return null;/, "only when none was asked before");
  assert.match(first, /requestStaffJob\(\{ id: ownerId, supabase: service\(\) \}/);
});

test("past three gate rounds the video goes on and marks what is left for a person; a person's 수정 요청 starts the count again", () => {
  assert.match(run, /export const MYIN_GATE_ROUNDS = 3;/);
  const prep = between(run, "export async function completeMyinPrep", "export async function failMyinPrep");
  assert.match(prep, /const rounds = gate\.length \? \(run\.gateRounds \?\? 0\) \+ 1 : 0;/);
  assert.match(prep, /const goOn = gate\.length > 0 && rounds > MYIN_GATE_ROUNDS;/);
  assert.match(prep, /if \(goOn\) next\.prepared!\.needsPerson = gate\.slice\(0, 60\);/);
  assert.match(prep, /gateRounds: rounds, review: \{ decision: "revise"/);
  assert.match(prep, /const rest = goOn \? bundle\.misses\.filter\(\(line\) => !gate\.includes\(line\)\) : bundle\.misses;/, "other misses still stop at prep_ready");
  assert.match(between(run, "export async function reviewMyinStoryboard", "/** ③ drafts go to"), /delete next\.gateRounds;/);
});

test("the paid steps are approved once at the start, by a person, and 「완성」 asks no more", () => {
  assert.match(run, /\.\.\.\(paidOk && actor\.type === "user" \? \{ paidOk: \{ by: actor\.ownerId, name: actor\.name, at: new Date\(\)\.toISOString\(\) \} \} : \{\}\)/, "never an AI key");
  const panel = read("components/myin-v13-panel.tsx");
  assert.match(panel, /const together = fresh && !short && settings\.confirm === "auto";/);
  assert.match(panel, /\.\.\.\(together \? \{ paidOk: true \} : \{\}\)/);
  assert.match(panel, /const finishDraft = async \(target: MyinRun\) => \{\n\s+if \(!target\.paidOk\) \{/);
  assert.match(read("components/editor-screen.tsx"), /if \(beforeFinal\.current && !paidOk && !await cost\.confirm\(/);
});

test("the make tab is the editor screen: in the page once v0 is up, where the video is now under it, the steps folded", () => {
  const panel = read("components/myin-v13-panel.tsx");
  assert.match(panel, /\{folded \? <EditorScreenEntry token=\{accessToken\} projectId=\{sourceId\} title=\{title\}[^\n]*inline paidOk=\{Boolean\(run\?\.paidOk\)\} \/> : null\}\n\s+\{nowCard\}/);
  assert.match(panel, /<summary>단계별로 보기 · 내려받기 · 자막 · 음성 확인 · 장면 의견 · 사운드<\/summary>/);
  assert.match(read("components/youtube-process-make.tsx"), /folded=\{!short\}/, "숏폼 keeps its step cards");
  const screen = read("components/editor-screen.tsx");
  assert.match(screen, /if \(inline && ready\) return <EditorScreen /);
  assert.match(screen, /const timer = window\.setInterval\(\(\) => void read\(\), 30_000\);/, "comes as soon as the scene pictures are up");
  assert.match(read("components/youtube-process.css"), /\.yp-escreen\.yp-escreen-inline\{position:relative;/);
});

test("a final made from v0 as it was keeps v0 as its editor version; the AI chat news tells how the video is being made", () => {
  assert.match(read("lib/server/myin-edit.ts"), /versions: m\.screen\.versions\.map\(\(v\) => v\.name === DRAFT_VERSION \? \{ \.\.\.v, final: finalAt \} : v\)/);
  assert.match(read("lib/myin-edit.ts"), /const out: \{ at: string; kind: string; text: string \}\[\] = \[\.\.\.\(state\.making \?\? \[\]\)\];/);
  assert.match(read("lib/server/myin-edit.ts"), /making: await myinMakingNews\(service, project\.id\)\.catch\(\(\) => \[\]\)/);
  const news = between(run, "export async function myinMakingNews", "/** Short-lived addresses");
  for (const line of ["음성 · 받아쓰기 · 자막이 끝났어요", "OS 검사를 통과해 기획표를 자동으로 확인했어요", "렌더 전 관문에서 걸린 곳을 내 AI가 고쳐요", "장면 그림이 편집 화면 타임라인에 깔렸어요", "사람 확인이 필요해요", "멈췄어요"])
    assert.ok(news.includes(line), line);
});

// 11-16 first real run: the gate's fix went to Logan's AI by itself, yet another viewer's card offered 「내 AI에 보내기」 (a second request).
test("whoever opens the video sees whose AI has the storyboard, not a button that asks their own AI for another", () => {
  const now = between(run, "async function storyboardJobNow", "/**");
  assert.match(now, /\.in\("status", \["backlog", "active"\]\)/);
  assert.match(now, /mine: row\.owner_id === viewer/);
  assert.match(run, /storyboardJob: record\.stage === "words_ready" \? await storyboardJobNow\(sourceId, actor\.id\)\.catch\(\(\) => null\) : null/);
  const panel = read("components/myin-v13-panel.tsx");
  assert.match(panel, /const other = run\.storyboardJob && !run\.storyboardJob\.mine \? run\.storyboardJob : null;/);
  assert.match(panel, /\{other\.name\}님 AI · \{other\.status === "active" \? "쓰는 중" : "가져가기를 기다리는 중"\}/);
});

test("a 숏폼 cut from a longform gets its storyboard from GPT every time it is back at 받아쓰기 끝, from its longform's photos only", () => {
  assert.match(run, /const gptStoryboardFor = \(run: MyinRun, record: OsRecord\) => run\.recycle \?/);
  assert.match(run, /gptFor\s*\n?\s*\? import\("\.\/youtube-gpt-jobs"\)\.then\(\(module\) => module\.requestGptStoryboard\(sourceId, gptFor\)\)/);
  const prep = between(run, "export async function completeMyinPrep", "export async function failMyinPrep");
  assert.match(prep, /await resendStoryboard\(run\.sourceId, record\.id, undefined, gptStoryboardFor\(run, record\)\);/, "after the 렌더 전 관문");
  const review = between(run, "export async function reviewMyinStoryboard", "/** ③ drafts go to");
  assert.match(review, /if \(run\.recycle\) await resendStoryboard\(run\.sourceId, record\.id, undefined, gptStoryboardFor\(run, record\)\);/, "after a 수정 요청");
  const gpt = read("lib/server/youtube-gpt-jobs.ts");
  assert.match(gpt, /export async function requestGptStoryboard\(sourceId: string, ownerId: string\)/);
  assert.match(gpt, /requestStaffJob\(gptActor\(owner\), staffJobRequestSchema\.parse\(\{ task: "storyboard", sourceId \}\), \{ tier \}\)/);
  const jobs = read("lib/server/youtube-ai-jobs.ts");
  assert.match(jobs, /photos: await myinRecyclePhotos\(myin\.run\)/, "the card lists the longform's photos");
  assert.match(jobs, /recycledWebShort\(checkWebShortResult\(/, "a photo not from the longform is sent back");
});

