import assert from "node:assert/strict";
import test from "node:test";
import { effectTrack } from "../tools/render-youtube-scene.mjs";

test("scene-change sounds play at most once every 4 seconds", () => {
  const wav = effectTrack([{ t: 0, kind: "transition" }, { t: 1, kind: "transition" }, { t: 5, kind: "transition" }], 6);
  const loudness = (from) => Array.from({ length: 4_800 }, (_, i) => Math.abs(wav.readInt16LE(44 + (Math.round(from * 48_000) + i) * 2))).reduce((a, b) => Math.max(a, b));
  assert.ok(loudness(0) > 1_000, "first change sounds");
  assert.ok(loudness(1.35) < 50, "a change 1 s later stays silent");
  assert.ok(loudness(5) > 1_000, "a change 5 s later sounds again");
});
