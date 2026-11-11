import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { draftMissing } from "../lib/youtube-process/stages.ts";
import { THUMB_STYLES, cleanThumbEdit, thumbAccentParts, thumbLayout, thumbLines, thumbStyleFor } from "../lib/youtube-process/thumb-style.ts";
import { thumbSavedEditSchema } from "../lib/youtube-process/thumb-edit.ts";

// 롱폼 애니메이션 썸네일 자동 제작 1단계 (요청 2026-11-09).
const read = (file) => readFileSync(new URL(`../${file}`, import.meta.url), "utf8");
const style = THUMB_STYLES.anim;

test("the 썸네일 스타일 is kept apart and only the 롱폼 애니메이션 format has one", () => {
  assert.equal(thumbStyleFor("anim")?.id, "anim");
  assert.equal(thumbStyleFor("live"), null);
  assert.equal(style.title.ink, "#1E1D1D");
  assert.equal(style.title.accent, "#212CB0");
  assert.equal(style.title.bottomPx, 50);
});

test("the frame puts the title at 120–170 px in at most two lines, 50 px above the bottom, readable on a phone feed", () => {
  for (const text of ["일요일 밤 우울", "퇴근하면 아무것도 못 해요", "점심 메뉴도\n못 고르겠다면"]) {
    const layout = thumbLayout({ text }, style);
    assert.ok(layout.size >= 120 && layout.size <= 170, `${text}: ${layout.size}px`);
    assert.ok(layout.lines.length <= 2);
    assert.ok(layout.checks.every((check) => check.ok), `${text}: ${layout.checks.filter((c) => !c.ok).map((c) => c.text)}`);
    assert.ok(layout.subjectBox.height > 0 && layout.subjectBox.top + layout.subjectBox.height <= layout.titleTop);
  }
  assert.deepEqual(thumbLines("점심 메뉴도\n못 고르겠다면", style), ["점심 메뉴도", "못 고르겠다면"]);
  const long = thumbLayout({ text: "이건 한 줄로 쓰기에는 너무나도 길어서 줄을 바꿔도 다 들어가지 않는 문구예요" }, style);
  assert.ok(long.checks.some((check) => !check.ok), "a copy that cannot fit is flagged, not shrunk under 120 px");
  assert.deepEqual(thumbAccentParts("못 고르겠다면", "고르겠다면").map((p) => p.accent), [false, true]);
});

test("a 롱폼 애니메이션 기획안 is confirmed with pictures in A and B; other formats keep 글 후보", () => {
  const plan = { titles: [{ id: "a", text: "제목 A" }, { id: "b", text: "제목 B" }], thumbs: [{ id: "1", mode: "text", copy: "문구" }, { id: "2", mode: "text", copy: "문구 2" }],
    opening: "o", body: "b", closing: "c", note: "", extraRefs: [] };
  assert.equal(draftMissing(plan, "live"), "");
  assert.equal(draftMissing(plan, "anim"), "썸네일 A · B 필요");
  const picked = { ...plan, thumbs: plan.thumbs.map((t, i) => ({ ...t, mode: "img", path: `youtube/p/plan_thumb/${i}.png` })) };
  assert.equal(draftMissing(picked, "anim"), "");
});

test("the AI hands each picture in while it holds the job, and a confirm carries the picks into 제작", () => {
  const jobs = read("lib/server/youtube-ai-jobs.ts");
  assert.match(jobs, /z\.object\(\{ action: z\.literal\("upload"\), jobId: z\.string\(\)\.uuid\(\), lease: z\.string\(\)\.uuid\(\), mimeType: z\.enum\(\["image\/png", "image\/jpeg"\]\)/);
  assert.match(jobs, /if \(m\.task !== "thumbs"\) throw new ApiError\(400, "STAFF_AI_JOB_ACTION"/);
  assert.match(jobs, /"THUMB_JOB_OPEN", "후보를 만드는 중이에요\. 끝나면 더 만들 수 있어요\."/);
  assert.match(jobs, /if \(!made\) await keepIssues\(job, m, \(\) => \{ throw new ApiError\(422, "THUMB_NONE_ADDED"/);
  assert.match(read("lib/server/mcp.ts"), /action:z\.enum\(\["claim","complete","fail","upload","add"\]\)/);
  assert.match(read("app/api/v1/content/youtube-automation/ai-jobs/route.ts"), /"image-creative", "thumbs"\] as const/);
  assert.match(read("app/api/v1/content/youtube-automation/ai-jobs/worker/route.ts"), /input\.action === "upload" \|\| input\.action === "add" \? await thumbJobStep\(actor, input\)/);
  const thumbs = read("lib/server/youtube-thumbs.ts");
  assert.match(thumbs, /THUMB_NOT_UPLOADED/);
  assert.match(thumbs, /new ImageResponse\(createElement\(ThumbFrame, \{ style, image, copy, edit: input\.edit \}\)/);
  const stages = read("lib/server/youtube-process-stages.ts");
  assert.match(stages, /if \(project\.yp\.topic\.type === "anim"\) await pickedThumbsToMake\(service, actor, project, stages\.make, plan, now\);/);
  assert.match(stages, /draftMissing\(stages\.plan\.data, project\.yp\.topic\.type\)/);
  assert.match(read("next.config.ts"), /"\/api\/v1\/content\/youtube\/projects\/\[id\]\/thumbs": \["\.\/lib\/cardnews\/fonts\/Pretendard-900\.otf"\]/);
});

test("the picker keeps a picture's first link, and 제작 picks again from the 기획안 without 공식대로 다시 뽑기", () => {
  const picker = read("components/youtube-thumb-picker.tsx");
  assert.match(picker, /if \(c\.url && !urls\.current\.has\(c\.path\)\) urls\.current\.set\(c\.path, c\.url\)/);
  assert.match(picker, /kind: onMake \? "plan_thumb" : "thumb"/);
  const make = read("components/youtube-process-make.tsx");
  assert.match(make, /onRedo=\{project\.yp\.topic\.type === "anim" \? undefined :/);
  assert.match(make, /기획안에서 다시 고르기/);
});

// 2단계: 제작 「최종 썸네일」 다듬기 + 후보 보관함.
test("an edit stays inside the style: size 120–170, photo limits, at most four added lines that must sit inside the frame", () => {
  const clean = cleanThumbEdit({ size: 400, photo: { scale: 9, x: 5000, y: -5000, brightness: 0 },
    extras: Array.from({ length: 6 }, (_, i) => ({ id: `${i}`, text: "실화", color: "red", size: 300, x: 10, y: 10 })) }, style);
  assert.equal(clean.size, 170);
  assert.deepEqual(clean.photo, { scale: 1.6, x: 640, y: -360, brightness: 0.6 });
  assert.equal(clean.extras.length, 4);
  assert.ok(clean.extras.every((x) => x.size === 140));
  assert.deepEqual(cleanThumbEdit(undefined, style), {});
  const copy = { text: "점심 메뉴도\n못 고르겠다면", accent: "고르겠다면" };
  assert.equal(thumbLayout(copy, style, { size: 130 }).size, 130, "a size the PD set is used");
  assert.ok(thumbLayout(copy, style, { size: 400 }).size <= 170, "and never above the style's top");
  const inside = thumbLayout(copy, style, { extras: [{ id: "a", text: "직장인 70%", color: "red", size: 64, x: 60, y: 40 }] });
  assert.ok(inside.checks.find((c) => c.id === "extras").ok);
  const out = thumbLayout(copy, style, { extras: [{ id: "a", text: "직장인 70%", color: "red", size: 64, x: 1200, y: 640 }] });
  assert.equal(out.checks.find((c) => c.id === "extras").ok, false);
  assert.ok(thumbSavedEditSchema.safeParse({ candidate: "6f1c3c1e-8a7b-4b8e-9a51-2f3c4d5e6f70", copy, accentStyle: "marker", extras: [] }).success);
  assert.equal(thumbSavedEditSchema.safeParse({ copy, accentStyle: "glow" }).success, false);
});

test("제작 keeps the frame edit with each slot: a hand-put finished thumbnail marks it full, and the editor saves through the same frame", () => {
  const stages = read("lib/server/youtube-process-stages.ts");
  assert.match(stages, /thumb: z\.object\(\{ slot: z\.enum\(SLOTS\), path: text\(300\), name: text\(240\), edit: thumbSavedEditSchema\.optional\(\) \}\)/);
  assert.match(stages, /const edit = patch\.thumb\.edit \? \{ \.\.\.patch\.thumb\.edit, full: undefined \} : before \? \{ \.\.\.before, full: true \} : undefined;/);
  assert.match(stages, /edit: \{ candidate: picked\.pick\.candidate, copy: \{ text: picked\.copy, accent: picked\.pick\.accent \?\? "" \} \}/);
  const thumbs = read("lib/server/youtube-thumbs.ts");
  assert.match(thumbs, /plan_thumb\/\[0-9a-f-\]\{36\}\\\\\.\(png\|jpg\)\$/);
  const make = read("components/youtube-process-make.tsx");
  assert.match(make, />다듬기<\/button>/);
  assert.match(make, /우리 틀로 돌아가기/);
  assert.match(read("components/youtube-thumb-editor.tsx"), /kind: "thumb"/);
  assert.match(read("components/youtube-thumb-picker.tsx"), /고른 것만/);
});
