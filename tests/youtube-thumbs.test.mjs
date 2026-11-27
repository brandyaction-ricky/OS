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
  assert.equal(draftMissing(plan, "anim"), "썸네일 A를 후보에서 골라 넣어 주세요");
  // 풀링형 3편 (대표 2026-11-24): a copy too long for the frame says so beside the button.
  const long = { ...plan, thumbs: [{ id: "1", mode: "text", copy: "다괜찮아보이는데왜못고를까요" }, plan.thumbs[1]] };
  assert.match(draftMissing(long, "anim"), /^썸네일 A 문구가 기본형 틀에 안 들어가요\(.*\) — 줄을 나누거나 줄이거나, 인물형 틀로 골라요$/);
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
  assert.match(thumbs, /new ImageResponse\(createElement\(ThumbFrame, \{ style, image, copy, edit: input\.edit, subject \}\)/);
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
  assert.ok(thumbSavedEditSchema.safeParse({ candidate: "6f1c3c1e-8a7b-4b8e-9a51-2f3c4d5e6f70", copy, size: 140, extras: [] }).success);
  assert.equal(thumbSavedEditSchema.safeParse({ copy, accentStyle: "marker" }).success, false, "형광펜 · 밑줄 were dropped: the accent is a 글자색 only");
});

test("제작 keeps the frame edit with each slot: a hand-put finished thumbnail marks it full, and the editor saves through the same frame", () => {
  const stages = read("lib/server/youtube-process-stages.ts");
  assert.match(stages, /thumb: z\.object\(\{ slot: z\.enum\(SLOTS\), path: text\(300\), name: text\(240\), edit: thumbSavedEditSchema\.optional\(\) \}\)/);
  assert.match(stages, /const edit = patch\.thumb\.edit \? \{ \.\.\.patch\.thumb\.edit, full: undefined \} : before \? \{ \.\.\.before, full: true \} : undefined;/);
  assert.match(stages, /edit: \{ candidate: picked\.pick\.candidate, copy: \{ text: picked\.copy, accent: picked\.pick\.accent \?\? "" \}, \.\.\.pickFrame\(picked\.pick\) \}/);
  const thumbs = read("lib/server/youtube-thumbs.ts");
  assert.match(thumbs, /plan_thumb\/\[0-9a-f-\]\{36\}\\\\\.\(png\|jpg\)\$/);
  const make = read("components/youtube-process-make.tsx");
  assert.match(make, />다듬기<\/button>/);
  assert.match(make, /우리 틀로 돌아가기/);
  assert.match(read("components/youtube-thumb-editor.tsx"), /kind: "thumb"/);
  assert.match(read("components/youtube-thumb-picker.tsx"), /고른 것만/);
});

// 피사체 자리: the frame put the whole picture in the room above the title, so a subject on a wide white picture came out small.
test("the AI's subject box puts the subject as tall as the room above the title, centred and sitting on the title", () => {
  const copy = { text: "일요일 밤 11시..", accent: "11시.." };
  const subject = { box: [576, 87, 840, 675], size: [1210, 675] };
  const layout = thumbLayout(copy, style, undefined, subject);
  const k = layout.photoBox.width / 1210;
  const top = layout.photoBox.top + 87 * k, bottom = layout.photoBox.top + 675 * k, middle = layout.photoBox.left + (576 + 840) / 2 * k;
  assert.ok(Math.abs(bottom - layout.clipBottom) <= 1, "it sits on the title");
  assert.ok(Math.abs(top - style.subject.topPx) <= 1, "and fills the room up to the top margin");
  assert.ok(Math.abs(middle - 640) <= 1, "centred");
  const old = thumbLayout(copy, style);
  assert.ok(bottom - top > old.subjectBox.height * 0.6 * 1.2, "much bigger than the whole picture fitted into the room");
  const atTop = thumbLayout(copy, style, undefined, { box: [400, 0, 900, 500], size: [1280, 720] });
  assert.equal(Math.round(atTop.photoBox.top), 0, "a subject cut by the picture's top edge stays on the frame's top edge");
  const zoomed = thumbLayout(copy, style, { photo: { scale: 1.5, x: 0, y: 0, brightness: 1 } }, subject);
  const zk = zoomed.photoBox.width / 1210;
  assert.ok(Math.abs(zoomed.photoBox.left + (576 + 840) / 2 * zk - 640) <= 1, "사진 크기 grows around the subject");
  const server = read("lib/server/youtube-thumbs.ts");
  assert.match(server, /subject: z\.object\(\{ box: z\.tuple\(\[px, px, px, px\]\), size: z\.tuple\(\[px, px\]\) \}\)\.strict\(\)/);
  assert.match(server, /createElement\(ThumbFrame, \{ style, image, copy, edit: input\.edit, subject \}\)/);
  assert.match(read("components/youtube-thumb-picker.tsx"), /subject=\{current\.subject\}/);
});

test("인물형 틀 (대표 확정 2026-11-24): photo over the frame, band · blue box · black box from the bottom-left, as on the local tool", () => {
  const layout = thumbLayout({ text: "직무 고민 중이라면\n“다 괜찮아 보이는데..?”\n맞는 직무는 이름에 없습니다" }, style, { frame: "person", flip: true });
  assert.ok(layout.person);
  assert.equal(layout.person.band.text, "직무 고민 중이라면");
  assert.deepEqual(layout.person.boxes.map((b) => [b.text, b.bg, b.top, b.height]), [["“다 괜찮아 보이는데..?”", "#315FFA", 390, 106], ["맞는 직무는 이름에 없습니다", "#000000", 500, 106]]);
  assert.equal(layout.person.band.top, 330);
  assert.deepEqual(layout.photoBox, { left: 0, top: 0, width: 1280, height: 720 });
  assert.ok(layout.checks.every((c) => c.ok), layout.checks.filter((c) => !c.ok).map((c) => c.text).join());
  const slashed = thumbLayout({ text: "직무 고민 중이라면 / “다 괜찮아 보이는데..?” / 맞는 직무는 이름에 없습니다" }, style, { frame: "person" });
  assert.equal(slashed.person.band.text, "직무 고민 중이라면");
  assert.ok(slashed.checks.every((c) => c.ok), slashed.checks.filter((c) => !c.ok).map((c) => c.text).join());
  const two = thumbLayout({ text: "5년 동안 뭐 했지?\n물경력은 역할에서 생깁니다" }, style, { frame: "person" });
  assert.equal(two.person.band, null);
  assert.ok(thumbLayout({ text: "가\n나\n다\n라" }, style, { frame: "person" }).checks.some((c) => !c.ok), "four lines do not fit the 인물형");
  assert.ok(thumbLayout({ text: "아주아주아주아주아주아주아주아주아주아주아주아주 긴 문구" }, style, { frame: "person" }).checks.some((c) => !c.ok));
  assert.deepEqual(cleanThumbEdit({ frame: "person", flip: true, size: 40 }, style), { frame: "person", flip: true, size: 56 });
  assert.ok(thumbSavedEditSchema.safeParse({ frame: "person", flip: true, copy: { text: "a\nb\nc" } }).success);
  const jobs = read("lib/server/youtube-ai-jobs.ts"), thumbs = read("lib/server/youtube-thumbs.ts");
  assert.match(jobs, /frame: z\.literal\("person"\)\.optional\(\), query:/);
  assert.match(thumbs, /if \(frame === "person"\) return personThumbsCard\(/);
  assert.match(thumbs, /!ok && !\(frame && key === "white"\)/);
  // A job sent without the frame (an older screen) still takes person candidates: the AI marks them itself.
  assert.match(thumbs, /frame: z\.literal\("person"\)\.optional\(\), flip: z\.boolean\(\)\.optional\(\),/);
  assert.match(thumbs, /const frame = jobFrame \?\? input\.frame;/);
  assert.match(thumbs, /candidate에 "frame": "person"을 넣고/);
  assert.match(read("components/youtube-thumb-picker.tsx"), /if \(current\?\.frame\) \{ setFrame\(current\.frame\); setFlip\(Boolean\(current\.flip\)\); \}/);
});
