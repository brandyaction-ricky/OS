import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { uploadFinal, reviewOkAt } from "../lib/youtube-process/stages.ts";

// 유쓰 요청 2/8 · 공통 조건 3·4 (2026-11-02): finished videos stay as versions, and one the OS made after the 최종 검토 컨펌 waits as a candidate.
const v = (n, at, source = "myin") => ({ v: n, at, source });

test("the newest final goes up; an OS-made one after the confirm waits, a hand-put file does not", () => {
  const finals = [v(1, "2026-11-01T01:00:00.000Z"), v(2, "2026-11-01T05:00:00.000Z")];
  assert.equal(uploadFinal(finals, null).v, 2, "before the confirm: the newest");
  const ok = reviewOkAt({ state: "ok", decidedAt: "2026-11-01T03:00:00.000Z" });
  assert.equal(uploadFinal(finals, ok).v, 1, "made after the confirm: a candidate");
  assert.equal(uploadFinal([...finals, v(3, "2026-11-01T06:00:00.000Z", "upload")], ok).v, 3, "put in by hand after the confirm (lateMakeOk)");
  assert.equal(uploadFinal([{ ...v(1, "2026-11-01T01:00:00.000Z", "short"), aspect: "1:1" }], null), null, "a feed ad never goes up as the Short");
  assert.equal(reviewOkAt({ state: "wait", decidedAt: "x" }), null);
});

test("making the video again keeps the earlier one, and the upload names what it sent", async () => {
  const run = await readFile(new URL("../lib/server/myin-run.ts", import.meta.url), "utf8");
  assert.doesNotMatch(run, /delete next\.final/, "no finished video is dropped");
  assert.match(run, /function retireFinal[\s\S]*run\.finals = \[\.\.\.\(run\.finals \?\? \[\]\), run\.final\]/);
  const stages = await readFile(new URL("../lib/server/youtube-process-stages.ts", import.meta.url), "utf8");
  assert.doesNotMatch(stages, /row\.stage === "final_ready" && row\.metadata\?\.final/, "a run's versions show in every stage");
  const upload = await readFile(new URL("../lib/server/youtube-process-upload.ts", import.meta.url), "utf8");
  assert.match(upload, /FINAL_CHANGED/);
  assert.match(upload, /finalAt: final\.at/);
});
