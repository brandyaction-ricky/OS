import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import { teamBusiness } from "../lib/team/business.ts";

const source = await readFile(new URL("../lib/server/meeting-telegram.ts", import.meta.url), "utf8");
const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
const mod = { exports: {} };
runInNewContext(`(function(require,module,exports){${code}\n})`)((name) => name === "@/lib/team/business" ? { teamBusiness } : {}, mod, mod.exports);
const { meetingTelegramText } = mod.exports;

const row = { id: "m1", title: "1030 에듀", brand: "브랜디액션 에듀", starts_at: "2026-10-30T02:06:00Z", metadata: { summary: "### MVP QA\n- 기수생 3기 대상", items: [
  { kind: "decision", text: "MVP는 3기에게 먼저 연다", state: "accepted" },
  { kind: "task", text: "웨비나 PPT를 만든다", state: "accepted", ownerId: "u1", dueOn: "2026-11-05" },
  { kind: "task", text: "후기 정리한다", state: "accepted" },
  { kind: "open", text: "상세 페이지 방향", state: "pending" },
  { kind: "decision", text: "버린 항목", state: "discarded" },
] } };

test("a confirmed meeting reads as summary, decisions, tasks with owner and date, open items and a link", () => {
  const text = meetingTelegramText(row, { u1: "제이" }, "https://os.example");
  assert.match(text, /^📋 회의 확정 · 1030 에듀\n.*브랜디에듀/);
  assert.match(text, /■ MVP QA\n- 기수생 3기 대상/);
  assert.match(text, /✅ 결정 1\n- MVP는 3기에게 먼저 연다/);
  assert.match(text, /📌 업무 2\n- 웨비나 PPT를 만든다 · 제이 · 11\/05까지\n- 후기 정리한다 · 담당 미정/);
  assert.match(text, /❓ 다음 회의로 1\n- 상세 페이지 방향/);
  assert.ok(!text.includes("버린 항목"));
  assert.ok(text.endsWith("OS에서 보기: https://os.example/organization/meetings?meeting=m1"));
});

test("a long summary is cut so the lists and the link still fit Telegram", () => {
  const text = meetingTelegramText({ ...row, metadata: { ...row.metadata, summary: "가".repeat(9000) } }, {}, "https://os.example");
  assert.ok(text.length <= 3900);
  assert.match(text, /…\n\n✅ 결정 1/);
  assert.ok(text.endsWith("meeting=m1"));
});

test("only a confirmed meeting is shared, never one for attendees only, and a failed send never fails the confirm", async () => {
  assert.match(source, /row\.metadata\.visibility === "attendees"/);
  const route = await readFile(new URL("../app/api/v1/team/command/route.ts", import.meta.url), "utf8");
  assert.match(route, /parsed\.data\.action === "meeting\.review"[^\n]*after\(\(\) => shareConfirmedMeeting\(id, origin\)\.catch/);
  const hook = await readFile(new URL("../app/api/v1/telegram/webhook/route.ts", import.meta.url), "utf8");
  assert.match(hook, /meeting_share_business: business\?\.key \?\? null/);
  assert.match(source, /\.eq\("meeting_share_business", business\)/);
});

test("AI to-dos nobody took on and nobody dated start as 결정; 나중에 이어서 goes back to the meeting", async () => {
  const screen = await readFile(new URL("../components/team/meeting-actions.tsx", import.meta.url), "utf8");
  assert.match(screen, /kind: ownerId \|\| dueOn \? "task" as const : "decision" as const/);
  assert.match(screen, /await onChanged\(\); router\.push\(`\/organization\/meetings\?meeting=\$\{encodeURIComponent\(meeting\.id\)\}`\);/);
  assert.match(screen, /담당·기한 없는 업무 \{loose\.length\}개 → 결정으로/);
});
