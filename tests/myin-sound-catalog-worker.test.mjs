import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

// The render PC sends the keys his storyboard uses (music_09 · stamp_press · amb_cafe) with names from the package's lists.
test("soundCatalog lists songs from catalog.json and effects · ambience from their files and CREDITS tables", async () => {
  const pkg = mkdtempSync(path.join(os.tmpdir(), "myin-sounds-"));
  for (const dir of ["bgm", "sfx", "amb"]) mkdirSync(path.join(pkg, "assets", dir), { recursive: true });
  writeFileSync(path.join(pkg, "assets", "bgm", "catalog.json"), JSON.stringify([{ no: 9, file: "music_09_B_mid_spoons.mp3", title: "Spoons", artist: "Rod Kim", slot: "사례", bright: "중간" }]));
  writeFileSync(path.join(pkg, "assets", "sfx", "CREDITS.md"), "| 파일 | 원래 이름 | 쓰임 | 길이(초) | 보관함 ID |\n|---|---|---|---|---|\n| sfx_stamp_press_1.mp3 | Stamp hit | 결재 도장 | 1.0 | a |\n| sfx_snap_click_1.mp3 | Mouse click close | Mixkit (mixkit.co, 무료) | 1.4 | mixkit 1 |\n");
  writeFileSync(path.join(pkg, "assets", "amb", "CREDITS.md"), "| 파일 | 원래 이름 | 장소 | 길이(초) | 보관함 ID |\n|---|---|---|---|---|\n| amb_cafe_1.mp3 | Coffee Shop | 카페 | 60 | b |\n");
  for (const file of ["sfx/sfx_stamp_press_1.mp3", "sfx/sfx_stamp_press_2.mp3", "sfx/sfx_snap_click_1.mp3", "amb/amb_cafe_1.mp3", "amb/amb_cafe_2.mp3"]) writeFileSync(path.join(pkg, "assets", file), "");
  const worker = await import(`../tools/youtube-media-worker.mjs?sounds=${Date.now()}`);
  assert.deepEqual(worker.soundCatalog(pkg).items, [
    { kind: "music", key: "music_09", title: "Spoons · Rod Kim", note: "사례 · 중간" },
    { kind: "sfx", key: "snap_click", title: "Mouse click close" },
    { kind: "sfx", key: "stamp_press", title: "결재 도장", note: "Stamp hit" },
    { kind: "amb", key: "amb_cafe", title: "카페", note: "Coffee Shop" },
  ]);
});
