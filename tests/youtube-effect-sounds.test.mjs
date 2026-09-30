import assert from "node:assert/strict";
import test from "node:test";
import { effectTrack } from "../tools/render-youtube-scene.mjs";

test("the scene-change whoosh is noise, not a repeating buzz", () => {
  const wav = effectTrack([{ t: 0, kind: "transition" }], 1);
  const samples = Array.from({ length: 20_000 }, (_, i) => wav.readInt16LE(44 + (1_000 + i) * 2));
  const corr = (lag) => samples.slice(lag).reduce((sum, v, i) => sum + v * samples[i], 0);
  // A pitched sound repeats itself; the old generator repeated every 419 samples.
  for (const lag of [419, 838]) assert.ok(Math.abs(corr(lag) / corr(0)) < 0.5, `repeats at lag ${lag}`);
});
