import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import test from "node:test";

// 모든 버튼 비용 안내 (owner request 2026-10-26: 「모든 페이지에 있는 버튼 하나도 빠짐없이」): a screen that calls a paid API or the
// YouTube Data API carries the shared tag, so a new button cannot ship without one.
const PAID = [
  [/\bgenerateContent\(/, /<ContentGenerationButton\b/, "company Claude generation goes through ContentGenerationButton"],
  [/\b(transcribeMeeting|summarizeMeeting)\(|\/api\/v1\/meeting-summary/, /<CostTag kind="paid"/, "meeting transcription · summary"],
  [/\b(searchYoutubeMarket|resolveYoutubeChannel|createYoutubeUploadSession)\(|\/api\/v1\/youtube\/outlier/, /<CostTag kind="youtube"/, "YouTube Data API"],
  [/action: ?"extract"/, /<CostTag kind=/, "정본 규칙 추출"],
];
const files = dir => readdirSync(dir).flatMap(name => {
  const path = `${dir}/${name}`;
  return statSync(path).isDirectory() ? files(path) : path.endsWith(".tsx") ? [path] : [];
});

// A hook with no button of its own: its callers ask before start() (team/meeting-actions, knowledge/meeting-capture).
const HOOKS = new Set(["components/meeting-recorder.tsx"]);

test("every screen that calls a paid API or YouTube shows the cost tag", () => {
  const missing = [];
  for (const path of files("components").filter(path => !HOOKS.has(path))) {
    const source = readFileSync(path, "utf8");
    for (const [call, tag, what] of PAID) if (call.test(source) && !tag.test(source)) missing.push(`${path}: ${what}`);
  }
  assert.deepEqual(missing, []);
});

test("paid popups say the model and the cost, not who pays", () => {
  const notice = readFileSync("components/cost-notice.tsx", "utf8");
  assert.match(notice, /<dt>모델<\/dt>/);
  assert.match(notice, /<dt>예상 비용<\/dt>/);
  for (const path of files("components")) {
    const source = readFileSync(path, "utf8");
    assert.doesNotMatch(source, /회사 비용은 없어요|회사 AI 비용이 들지 않습니다|누구 비용|바로 받기 · API/, path);
  }
});
