import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

// 유쓰 요청 6/8 (2026-11-02): the list previews switch between PC 홈 · PC 검색 · 추천 옆 목록 · 휴대폰 and show the channel the video goes up on.
const read = path => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("every list preview offers the looks, and switching saves nothing", async () => {
  const media = await read("components/youtube-process-media.tsx");
  for (const label of ["PC 홈", "PC 검색", "추천 옆 목록", "휴대폰"]) assert.match(media, new RegExp(label));
  const picker = media.slice(media.indexOf("export function YtLookPicker"), media.indexOf("// The connected channel"));
  assert.doesNotMatch(picker, /client|save|confirm|adopt|edit\(/, "the picker only changes what this browser shows");
  for (const screen of ["outline", "final", "upload", "confirm"]) {
    const source = await read(`components/youtube-process-${screen}.tsx`);
    assert.match(source, /<YtLookPicker \/>/, `${screen}: the picker sits with its previews`);
  }
});

test("the channel is the connected one, not a fixed name", async () => {
  const media = await read("components/youtube-process-media.tsx");
  assert.doesNotMatch(media, /브랜디액션|"BA"/);
  assert.match(media, /client\.channelName\(\)/);
  assert.match(await read("components/youtube-process-upload.tsx"), /channel=\{uploadChannel\}/, "the upload screen shows the channel it will send to");
});
