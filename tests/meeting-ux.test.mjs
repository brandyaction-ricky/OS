import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("meetings live on one screen: the old 회의록 menu is gone and its links open 회의·결정", async () => {
  const [nav, list, detail] = await Promise.all([read("lib/navigation.ts"), read("app/(os)/knowledge/meetings/page.tsx"), read("app/(os)/knowledge/meetings/[id]/page.tsx")]);
  assert.doesNotMatch(nav, /label: "회의록", href: "\/knowledge\/meetings"/);
  assert.match(list, /redirect\("\/organization\/meetings"\)/);
  assert.match(detail, /redirect\(`\/organization\/meetings\?meeting=\$\{encodeURIComponent/);
});

test("team meeting notes save themselves and the screen is not remounted by its own saves", async () => {
  const [workspace, actions, prep] = await Promise.all([read("components/team/team-workspace-v1.tsx"), read("components/team/meeting-actions.tsx"), read("components/team/prep-actions.tsx")]);
  assert.match(workspace, /<TeamMeetingDetail key=\{selectedMeeting\.id\}/);
  assert.match(actions, /window\.setTimeout\(\(\) => void autosaveRef\.current\(\), 1500\)/);
  assert.match(actions, /params\.get\("record"\) === "1"/);
  assert.match(prep, /export function QuickMeetingStart/);
  assert.match(workspace, /reason: "빈 회의 정리"/);
});

test("a live meeting shows one step at a time, each with one main button (owner request 2026-11-12)", async () => {
  const actions = await read("components/team/meeting-actions.tsx");
  assert.match(actions, /if \(wizardOn\) return wizard;/);
  assert.match(actions, /\["준비", "회의 · 녹음", "정리 확인", "검토 · 확정"\]/);
  for (const button of ["● 녹음하며 회의 시작", "회의 끝내기 · 자동 정리", "다음: 검토 · 확정 →"]) assert.ok(actions.includes(button), button);
  // the rarely used controls fold away under one line instead of sitting beside the steps
  assert.match(actions, /<summary>회의 정보 바꾸기 · 내려받기 · 삭제<\/summary>/);
});
