import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { settingsPlace } from "../lib/myin-local.ts";

const read = (file) => readFileSync(file, "utf8");
const voiced = { words: { voice: { path: "v" } } };

test("제작 설정 places a step on the chooser's computer only where a staff computer can make the video", () => {
  assert.equal(settingsPlace({ place: "local" }, voiced), "local");
  assert.equal(settingsPlace({ place: "pc" }, voiced), "pc");
  assert.equal(settingsPlace(undefined, voiced), "pc", "a video started before the settings keeps the render PC");
  assert.equal(settingsPlace({ place: "local" }, { ...voiced, layout: "short" }), "pc", "숏폼 needs the vertical engine");
  assert.equal(settingsPlace({ place: "local" }, { words: {} }), "pc", "no voice left for staff Macs");
});

test("the start takes the settings and the confirms stop asking", () => {
  const run = read("lib/server/myin-run.ts");
  assert.match(run, /settings: z\.object\(\{ place: z\.enum\(\["pc", "local"\]\), screenCheck: z\.boolean\(\), by: z\.string\(\)\.uuid\(\), name: z\.string\(\), at: z\.string\(\)\.datetime\(\) \}\)\.strict\(\)\.optional\(\)/);
  assert.match(run, /draftPlace\(run, settings \? \{ ownerId: settings\.by, name: settings\.name \} : actor, settingsPlace\(settings, run\)\)/, "「내 컴퓨터」 is the chooser's");
  assert.match(run, /export async function confirmMyinClips\(actor: RequestActor, runId: string, note: string, place\?: "pc" \| "local"\)/);
  const route = read("app/api/v1/content/youtube-automation/myin/route.ts");
  assert.match(route, /action: z\.literal\("settings"\), runId: z\.string\(\)\.uuid\(\), place: z\.enum\(\["pc", "local"\]\), screenCheck: z\.boolean\(\)/);
  assert.match(route, /createMyinRun\(actor, input\.sourceId, input\.styleId, input\.settings\)/);
  const panel = read("components/myin-v13-panel.tsx");
  assert.doesNotMatch(panel, /DraftPlacePicker/, "no step asks where any more");
  assert.match(panel, /settings: short \? \{ \.\.\.settings, place: "pc" \} : settings/);
  assert.match(panel, /action: "clips_ok", runId: run\.id, note \}/);
  assert.match(read("components/myin-make-settings.tsx"), /localStorage\.getItem\(KEY\)/, "a new video starts from the last choice");
});
