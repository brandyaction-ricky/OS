import assert from "node:assert/strict";
import test from "node:test";
import { applyShortCopy } from "../lib/youtube-process/short.ts";
import { emptyStage } from "../lib/youtube-process/stages.ts";

// 숏폼 내보내기 (owner request 2026-10-25): my AI writes the Short's title and description; a person's words are never overwritten.
const author = { userId: "pd", name: "안저", model: "claude-opus-5-5", jobId: "job" };
const now = "2026-10-25T08:00:00Z";
const copy = { title: "일이 안 맞을 때 먼저 볼 4칸", description: "일 · 역할 · 환경 · 방식 중 무엇이 문제일까요?\n#직장인 #퇴사고민 #강점" };

test("the AI fills an empty title and description and keeps its draft", () => {
  const upload = applyShortCopy(emptyStage("upload", "short"), copy, author, now);
  assert.equal(upload.title, copy.title);
  assert.equal(upload.desc, copy.description);
  assert.deepEqual({ ...upload.descBy }, { ...author, at: now, draft: copy.description, title: copy.title });
});

test("an untouched AI draft is replaced; what a person wrote stays, with the new draft beside it", () => {
  const first = applyShortCopy(emptyStage("upload", "short"), copy, author, now);
  const again = applyShortCopy(first, { title: "새 제목", description: "새 설명 #강점" }, author, now);
  assert.equal(again.title, "새 제목");
  assert.equal(again.desc, "새 설명 #강점");
  const edited = { ...first, title: "PD가 고친 제목" };
  const kept = applyShortCopy(edited, { title: "새 제목", description: "새 설명 #강점" }, author, now);
  assert.equal(kept.title, "PD가 고친 제목");
  assert.equal(kept.desc, "새 설명 #강점", "the description nobody touched still takes the new draft");
  assert.equal(kept.descBy.title, "새 제목");
});

test("a wrong shape comes back as an issue", () => {
  for (const bad of [{ title: "", description: "d" }, { title: "t" }, { ...copy, tags: ["x"] }, { title: "t".repeat(101), description: "d" }])
    assert.throws(() => applyShortCopy(emptyStage("upload", "short"), bad, author, now), error => error.status === 422);
});
