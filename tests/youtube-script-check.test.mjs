import assert from "node:assert/strict";
import test from "node:test";
import { checkManuscript, checkScriptBody, sourcedParagraphs } from "../lib/youtube-script-check.ts";

// 원고 검수 정본 관문 1: the OS re-counts the format of a submitted script and its result wins.
const paragraph = (seed) => `${seed} 예를 들어 마케터 3년차 지은이 있습니다. 지은은 하고 싶은 일이 많아서 매일 저녁 새 강의를 결제하고, 주말에는 또 다른 모임에 나갑니다. 그런데 정작 무엇부터 해야 할지는 정하지 못한 채 한 달이 지나갑니다.`;
const manuscript = (title, sections) => [`# ${title}`, "<!-- 축: 남의 1순위 | 중심 근거: 없음 | 역할: 유입형 | 길이: 1분/490자 | 가상 인물: 지은 -->", "",
  ...sections.flatMap(([name, count], s) => [`## ${name}`, "", ...Array.from({ length: count }, (_, i) => [paragraph(`${s}-${i}`), ""]).flat()])].join("\n");

test("a manuscript in the canon format passes and yields narration-only paragraphs", () => {
  // 공백 포함 490자 = 1분 (정본 묶음 v2.0): four paragraphs of 122자 are one minute.
  const result = checkManuscript(manuscript("하고 싶은 게 많은 사람", [["도입", 2], ["우선순위", 2]]), { title: "하고 싶은 게 많은 사람", targetMinutes: 1 });
  assert.deepEqual(result.issues, []);
  assert.deepEqual(result.sections, ["도입", "우선순위"]);
  assert.equal(result.paragraphs.length, 4);
  assert.ok(!result.narration.includes("#") && !result.narration.includes("<!--"));
});

test("title, head line, sections and length problems are all listed at once", () => {
  const text = manuscript("다른 제목", [["아주 긴 섹션 제목입니다", 1]]).replace("<!-- 축:", "<!-- 메모:");
  const checked = checkManuscript(text, { title: "채택 제목", targetMinutes: 10 });
  const issues = checked.issues.join("\n");
  assert.match(issues, /채택 제목과 다릅니다/);
  assert.match(issues, /머리 블록/);
  assert.match(issues, /섹션\(##\)이 1개/);
  assert.match(issues, /8자 이내/);
  // Length is a note now (owner decision 2026-10-26), not a reason to refuse.
  assert.doesNotMatch(issues, /15%/);
  assert.match(checked.notes.join(), /목표 10분\(4900자\)과 15% 넘게 다릅니다/);
});

test("body rules: paragraph length, banned words, stage cues and unsourced research", () => {
  const issues = checkScriptBody(["짧은 문단입니다.", `${paragraph("a")} 여러분 (웃음)`, `${paragraph("b")} 하버드 연구에 따르면 그렇습니다.`], null, new Set()).issues.join("\n");
  assert.match(issues, /1번 문단 \d+자/);
  assert.match(issues, /2번 문단 2인칭 "여러분"/);
  assert.match(issues, /괄호 지시 "\(웃음\)"/);
  assert.match(issues, /3번 문단에 수치·연구·후기가 있는데/);
  assert.deepEqual(checkScriptBody([`${paragraph("c")} 연구 결과입니다.`], null, new Set([1])).issues, []);
  assert.deepEqual(checkScriptBody([`${paragraph("d")} 회의에서 첫마디를 꺼내고 한마디 더 합니다.`], null).issues, []);
  assert.match(checkScriptBody([`${paragraph("e")} 마디마다 다시 봅니다.`], null).issues.join(), /작업어 "마디"/);
});

// 원고 정본 묶음 v1.6 (원고 검수 정본 v1.3, 2026-10-25): new 작업어, '축'·'결' as concept names, 틀 반복, 정본 겹침, 사슬 낭독.
const body = (...extras) => checkScriptBody(extras.map((extra, i) => `${paragraph(`v${i}`)} ${extra}`), null).issues.join("\n");

test("v1.6 작업어: canon work words and '축'·'결' used as concept names", () => {
  for (const word of ["판정", "관문", "연타", "설득 재료", "재정의", "관통"]) assert.match(body(`오늘 ${word} 얘기를 합니다.`), new RegExp(`작업어 "${word}"`));
  assert.match(body("이 영상의 축은 하나예요."), /작업어 "영상의 축은"/);
  assert.match(body("이걸 저희는 결이라고 불러요."), /작업어 "결이라고 불러요"/);
  assert.match(body("사람마다 서른 개의 결이 있어요."), /작업어 "개의 결이"/);
  assert.equal(body("결국 결과가 달라졌고 축하도 받았어요. 한 가지 결론만 남았고 두 가지 결정이 남았어요."), "");
});

test("v1.6 틀 반복: '~라고 해보죠' four times, '맞아요. 근데' three times", () => {
  const suppose = "옆자리 동료가 있다고 해보죠.";
  assert.match(body(suppose, suppose, suppose, suppose), /틀 반복 "~라고 해보죠" 4회/);
  assert.equal(body(suppose, suppose, suppose), "");
  const concede = "그거 결국 성격 문제 아니냐고요? 맞아요. 근데 조건이 하나 있어요.";
  assert.match(body(concede, concede, concede), /틀 반복 "맞아요. 근데…"로 받는 반론 3회/);
  assert.equal(body(concede, concede), "");
  assert.equal(body("맞아요, 저도 그랬어요.", "맞아요, 저도 그랬어요.", "맞아요, 저도 그랬어요."), "");
});

test("v1.6 정본 겹침: ten characters (spaces removed) shared with the canon, except the allowed phrase", () => {
  const canon = "| ⑫ | \"그래도 저는 이 연구가 좋습니다\" | 저희 진단 받으신 분 중에 이런 분이 있었어요.";
  const issues = (extra) => checkScriptBody([`${paragraph("c")} ${extra}`], null, null, canon).issues.join("\n");
  assert.match(issues("그래도 저는 이 연구가 좋습니다. 이유가 있어요."), /정본 겹침 "그래도 저는 이 연구가 좋습니다"/);
  assert.match(issues("그래도저는 이연구가 좋아요."), /정본 겹침 "그래도저는 이연구가 좋"/);
  assert.equal(issues("이 연구가 좋습니다."), "");
  assert.equal(issues("저희 진단 받으신 분 중에 이런 분이 계셨어요."), "");
  assert.equal(checkScriptBody([`${paragraph("d")} 그래도 저는 이 연구가 좋습니다.`], null).issues.join(), "");
});

test("v1.6 사슬 낭독: four or more links of the IP chain in one paragraph", () => {
  assert.match(body("결핍이 욕구가 되고 행동이 강점이 되고 그게 정체성과 업으로 이어져요."), /사슬 낭독 — .* 6개/);
  assert.match(body("결핍이 욕구가 되고 행동이 강점이 됩니다."), /사슬 낭독 — .* 4개/);
  assert.equal(body("사업과 작업, 업무 얘기에서 결핍과 욕구, 강점을 봅니다."), "");
});

// 로건 피드백 A-4: the 출처 line takes ranges and groups, and a missing one says how to write it.
test("the 출처 line reads one number, ranges and groups before each arrow", () => {
  assert.deepEqual([...sourcedParagraphs(" 3 → 칙센트미하이(1989) | 9~15 → 같은 연구 | 8, 9 → 통계청 ")].sort((a, b) => a - b), [3, 8, 9, 10, 11, 12, 13, 14, 15]);
  assert.deepEqual([...sourcedParagraphs(" 20-22 → 보고서 ")], [20, 21, 22]);
  const study = "1989년 연구에서 직장인 78명이 일주일 동안 기록했습니다. ".repeat(3);
  const sourced = sourcedParagraphs(" 1~2 → 칙센트미하이 ");
  assert.equal(checkScriptBody([study, study, study], null, sourced).issues.filter(issue => /출처 줄/.test(issue)).length, 1);
  assert.match(checkScriptBody([study, study, study], null, sourced).issues.find(issue => /출처 줄/.test(issue)), /3번 문단.*예: <!-- 출처: 3 → .*9~15 → .*8, 9 →/);
});

// 원고 정본 묶음 v1.9 (원고 검수 정본 v1.6, 2026-10-26): how sentences and paragraphs close, against the script's length.
const closing = (endings) => checkScriptBody(endings.map((ending, i) => `${paragraph(`w${i}`)} ${ending}`), null).issues.join("\n");

test("v1.9 흐림 종결: '수 있-' sentence endings at 20 or more per 6,000 characters", () => {
  // Each test paragraph is about 160 characters, so one hedge per paragraph is far above 20 per 6,000.
  assert.match(closing(["다르게 볼 수 있어요.", "그럴 수도 있죠.", "물어볼 수 있겠죠?"]), /흐림 종결 .* 3개 — 6,000자당 [\d.]+회.*걸린 문단 1·2·3번/);
  assert.doesNotMatch(closing(["이 수를 보면 알아요.", "점수 있어요.", "할 수 있어야 해요."]), /흐림/);
  const long = Array.from({ length: 40 }, (_, i) => (i < 3 ? "다르게 볼 수 있어요." : "그날 바로 적었어요."));
  assert.doesNotMatch(closing(long), /흐림/);
});

test("v1.9 요약 종결: a third or more of the paragraphs end on '~거예요·~겁니다·~거죠'", () => {
  assert.match(closing(["그래서 다시 보는 거예요.", "그게 기준인 겁니다.", "다음 장면으로 가요."]), /요약 종결 .* 2개 — 전체 3개의 1\/3 이상.*걸린 문단 1·2번/);
  assert.doesNotMatch(closing(["그래서 다시 보는 거예요.", "다음 장면으로 가요.", "그날 바로 적었어요.", "왜 그랬을까요?"]), /요약/);
  assert.doesNotMatch(closing(["다들 그렇게 하는 거죠?", "다음 장면으로 가요."]), /요약/);
});

test("v1.9 해명 종결: '아니에요·아닙니다' endings outside quotes at 8 or more per 6,000 characters", () => {
  assert.match(closing(["점수를 매기는 방식은 아니에요.", "효과를 검증한 건 아닙니다.", "다음 장면으로 가요."]), /해명 종결 .* 2개 — .*걸린 문단 1·2번/);
  assert.doesNotMatch(closing(["친구가 \"그건 아니에요.\" 하고 웃어요.", "다음 장면으로 가요."]), /해명/);
  assert.doesNotMatch(closing(["다음 장면으로 가요.", "그건 아니라고 봐요."]), /해명/);
});

test("length: 공백 포함 490자 = 1분; more than 15% off is a note to fix the 러닝타임, never a refusal", () => {
  const text = (n) => Array.from({ length: n }, (_, i) => paragraph(`L${i}`));
  assert.deepEqual(checkScriptBody(text(4), 1).notes, []);
  const long = checkScriptBody(text(5), 1);
  assert.deepEqual(long.issues, []);
  assert.match(long.notes.join(), /총 \d+자\(약 1분\) — 목표 1분\(490자\)과 15% 넘게 다릅니다\. 내용에 필요한 길이면 러닝타임을 원고에 맞춰 고칩니다/);
});

test("정본 겹침 skips the owner's own two lines in 말투 정본 §11, which the script they were written for uses verbatim", () => {
  const canon = "| 얻을 것 약속 | (…) | 답은 이렇게 괜찮다고 넘긴 상황에 다 들어있거든요. 이 영상을 다 보시면, 내가 원하는 게 뭔지 알고, 선택하는데 도움을 받을 거예요 | 방향 |";
  const issues = (extra) => checkScriptBody([`${paragraph("o")} ${extra}`], null, null, canon).issues.join("\n");
  assert.doesNotMatch(issues("답은 이렇게 괜찮다고 넘긴 상황에 다 들어 있거든요. 이 영상을 다 보시면, 내가 원하는 게 뭔지 알고, 선택하는 데 도움을 받을 거예요."), /정본 겹침/);
  assert.match(checkScriptBody([`${paragraph("p")} 그래도 저는 이 연구가 좋습니다.`], null, null, `${canon} "그래도 저는 이 연구가 좋습니다"`).issues.join(), /정본 겹침/);
});
