import assert from "node:assert/strict";
import test from "node:test";
import { assToSrt } from "../lib/subtitle-files.ts";

// 1단계 자막 내려받기 (owner request 2026-10-28): Logan's ASS as an SRT.
test("Logan's 방송 자막 (ASS) becomes a numbered SRT with millisecond times and plain text", () => {
  const ass = ["[Script Info]", "PlayResX: 1920", "[Events]", "Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text",
    "Dialogue: 0,0:00:00.00,0:00:01.81,Default,,0,0,0,,친구 만나려고 옷까지 갈아입었는데,", "Dialogue: 0,0:01:03.29,1:00:04.13,Default,,0,0,0,,{\\b1}장소{\\b0}\\N옮기자",
    "Dialogue: 0,0:00:05.00,0:00:06.00,Default,,0,0,0,,{\\an8}"].join("\r\n");
  assert.equal(assToSrt(ass), "1\n00:00:00,000 --> 00:00:01,810\n친구 만나려고 옷까지 갈아입었는데,\n\n2\n00:01:03,290 --> 01:00:04,130\n장소\n옮기자\n");
  assert.equal(assToSrt("[Script Info]\n"), "");
});
