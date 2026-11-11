import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { draftMissing } from "../lib/youtube-process/stages.ts";
import { THUMB_STYLES, thumbAccentParts, thumbLayout, thumbLines, thumbStyleFor } from "../lib/youtube-process/thumb-style.ts";

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
  assert.match(thumbs, /new ImageResponse\(createElement\(ThumbFrame, \{ style, image, copy \}\)/);
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
