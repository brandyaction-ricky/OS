import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { checkRecycle, recycleScript } from "../lib/youtube-process/recycle.ts";

// 롱폼에서 나온 숏폼 (「롱폼 재활용 숏폼 정본」 §1~§2): stretches of a longform's voice, found by phrases, checked, cut on silence.
const speech = "앞에서 본 내용을 정리할게요. 입사 3년 차 마케터가 회의에서 발표하고 있었어요. 그런데 팀장님 얼굴이 갑자기 굳었어요. 마케터는 그걸 바로 알아챘어요. "
  + "다른 팀원들은 아무도 못 봤죠. 그래서 마케터는 발표를 서둘러 끝냈어요. 이게 바로 눈치가 빠른 사람의 하루예요. 오늘은 여기까지예요.";
// one word every 1.2 s: the 22-word stretch is ~26 s, ~21 s at 1.25×
const words = speech.split(" ").map((w, i) => [i * 1.2, i * 1.2 + 1.1, w]);
const part = { from: "입사 3년", to: "끝냈어요", text: "입사 3년 차 마케터가 회의에서 발표하고 있었어요. 그런데 팀장님 얼굴이 갑자기 굳었어요. 마케터는 그걸 바로 알아챘어요. 다른 팀원들은 아무도 못 봤죠. 그래서 마케터는 발표를 서둘러 끝냈어요." };

test("a stand-alone stretch becomes voice times, its length at 1.25×, its 대본 one sentence per line", () => {
  const { shorts, issues } = checkRecycle({ shorts: [{ title: ["눈치 빠른 사람이", "더 지치는 이유"], parts: [part], why: "" }] }, words, speech);
  assert.deepEqual(issues, []);
  assert.equal(shorts[0].parts[0].start, words[4][0]);
  assert.ok(Math.abs(shorts[0].seconds - (shorts[0].parts[0].end - shorts[0].parts[0].start) / 1.25) < 0.1 && shorts[0].seconds >= 20);
  assert.equal(recycleScript(shorts[0].parts).split("\n").length, 5);
});

test("the check sends back what the 정본 rules out: a leaning first word, a phrase not heard, text not in the 원고, a wrong length, a long title", () => {
  const one = (p, title = ["제목"]) => checkRecycle({ shorts: [{ title, parts: [p], why: "" }] }, words, speech).issues.join(" / ");
  assert.match(one({ from: "그런데 팀장님", to: "끝냈어요", text: "그런데 팀장님 얼굴이 갑자기 굳었어요. 마케터는 그걸 바로 알아챘어요. 다른 팀원들은 아무도 못 봤죠. 그래서 마케터는 발표를 서둘러 끝냈어요." }), /그런데/);
  assert.match(one({ ...part, from: "사장님이" }), /못 찾았어요/);
  assert.match(one({ ...part, text: part.text.replace("발표하고", "이야기하고") }), /원고에 그대로/);
  assert.match(one({ from: "입사 3년", to: "굳었어요", text: "입사 3년 차 마케터가 회의에서 발표하고 있었어요. 그런데 팀장님 얼굴이 갑자기 굳었어요." }), /20~50초/);
  assert.match(one(part, ["눈치가 빠른 사람이 더 지치는 이유"]), /12자 이하/);
});

test("the render PC cuts the longform voice inside the nearby silence, joins and speeds it, and makes no new voice", async () => {
  const { snapCuts } = await import("../tools/youtube-media-worker.mjs");
  assert.deepEqual(snapCuts([[10, 20], [30, 35]], [[9.7, 9.95], [20.1, 20.6], [29, 29.5], [35.3, 36]]), [[9.85, 20.3], [29.4, 35.5]]);
  assert.deepEqual(snapCuts([[10, 20]], []), [[9.95, 20.1]]);
  const worker = readFileSync(new URL("../tools/youtube-media-worker.mjs", import.meta.url), "utf8");
  const words = worker.slice(worker.indexOf("export async function processMyinWords(")).split("\nexport ")[0];
  assert.match(words, /if \(job\.recycle\) \{[\s\S]*recycleVoice\(job, voiceDir\)/);
  assert.match(worker, /atempo=1\.25/);
});
