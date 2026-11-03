import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { fromUnsplash, fromWikimedia } from "../lib/myin-photo-sources.ts";

// 유쓰 요청 2/8 보완 (2026-11-03 · 대표: Unsplash + 위키미디어): 사진 후보 찾기, 이 장면만 바꾸기, a preview made before a photo changed.
const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("a candidate shows the source's own thumbnail, the author and the license, and flags one to check", () => {
  const u = fromUnsplash({ id: "abc", width: 6000, height: 4000, urls: { small: "https://images.unsplash.com/photo-1?w=400", raw: "https://images.unsplash.com/photo-1?ixid=x" },
    links: { html: "https://unsplash.com/photos/abc", download_location: "https://api.unsplash.com/photos/abc/download" }, user: { name: "Kim", links: { html: "https://unsplash.com/@kim" } } });
  assert.equal(u.thumb, "https://images.unsplash.com/photo-1?w=400", "hotlinked, as the Unsplash API terms ask");
  assert.match(u.authorPage, /utm_source=brandyaction_os&utm_medium=referral/);
  assert.deepEqual([u.license, u.check], ["Unsplash 라이선스", false]);
  const page = (license, mime = "image/jpeg") => ({ title: "File:A.jpg", imageinfo: [{ thumburl: "https://upload.wikimedia.org/a.jpg", url: "https://upload.wikimedia.org/o.jpg",
    descriptionurl: "https://commons.wikimedia.org/wiki/File:A.jpg", mime, width: 10, height: 10, extmetadata: { LicenseShortName: { value: license }, Artist: { value: "<a href='x'>Lee</a>" } } }] });
  assert.deepEqual([fromWikimedia(page("CC BY 4.0")).check, fromWikimedia(page("Public domain")).check, fromWikimedia(page("CC0")).check], [false, false, false]);
  assert.equal(fromWikimedia(page("CC BY-SA 4.0")).check, true, "share-alike: someone checks before using it");
  assert.equal(fromWikimedia(page("")).license, "사용 조건 확인 필요");
  assert.equal(fromWikimedia(page("CC BY 4.0")).author, "Lee", "the author without the page's markup");
  assert.equal(fromWikimedia(page("CC BY 4.0", "image/svg+xml")), null, "only JPG · PNG · WEBP, as our images");
});

test("[사용하기] looks the photo up again by id, fetches only from the two sources, and keeps its credit", async () => {
  const src = await read("lib/server/myin-photo-candidates.ts");
  const use = src.slice(src.indexOf("export async function applyMyinPhotoCandidate"));
  assert.match(use, /await resolve\(provider, id\)/, "never an address the browser sent");
  assert.match(use, /IMAGE_HOSTS\.has\(new URL\(url\)\.hostname\)/);
  assert.match(use, /saveMyinOurImage\(actor, runId, file, path, credit\)/, "the same path as an uploaded 우리 이미지 (④ restart, stale checks)");
  assert.match(src, /download_location/, "Unsplash is told of each download");
  assert.doesNotMatch(src.slice(src.indexOf("export async function findMyinPhotoCandidates"), src.indexOf("/** The chosen candidate")), /save|upload|PUT/, "looking changes nothing");
});

test("a shared photo changes in one scene only unless all are chosen, and credits follow the photo used", async () => {
  const run = await read("lib/server/myin-run.ts");
  const separate = run.slice(run.indexOf("export async function separateMyinPhoto"), run.indexOf("// ── Stage 4: clips"));
  assert.match(separate, /rename\(story\.scenes\[scene - 1\]\)/, "only that scene's file name changes");
  assert.match(separate, /< 2\) return \{ file, run/, "a photo only one scene uses is changed in place");
  assert.match(separate, /run\.lease && Date\.parse\(run\.lease\.expiresAt\) > Date\.now\(\)\) throw/, "not while a job holds the storyboard");
  assert.match(run, /!run\.ours\?\.\[a\.file\]\)\.map\(\(a\) => `\$\{a\.file\} — /, "a replaced listed photo is not credited");
  assert.match(run, /image\.credit \? \[`\$\{file\} — \$\{image\.credit\.source\}/, "a candidate photo brings its own credit");
  const panel = await read("components/myin-our-images.tsx");
  assert.match(panel, /shared\(photo\) && scene && !allScenes\[photo\.file\]/, "「이 장면만」 is the default for a shared photo");
});

test("a preview made before a photo changed cannot be confirmed; it is made again", async () => {
  const run = await read("lib/server/myin-run.ts");
  assert.match(run.slice(run.indexOf("export async function confirmMyinClips")), /const stale = previewStale\(run\);\s+if \(stale\?\.length\) throw new ApiError\(409, "MYIN_CLIPS_STALE"/);
  assert.match(run, /const previewStale = [^\n]*filter\(\(name\) => name !== "자막"\)/, "a subtitle text edit is checked at 최종 검토, not by a new preview");
  assert.match(run, /const stalePreview = record\.stage === "clips_review" && !run\.clipsReview/);
  const panel = await read("components/myin-v13-panel.tsx");
  assert.match(panel, /disabled=\{Boolean\(busy\) \|\| Boolean\(run\.clipsStale\?\.length\)\}/);
  assert.match(panel, /미리보기 다시 만들기/);
});
