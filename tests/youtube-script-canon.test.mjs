import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { runInNewContext } from "node:vm";
import test from "node:test";
import ts from "typescript";
import * as scriptCheck from "../lib/youtube-script-check.ts";
import * as myinScript from "../lib/myin-script.ts";

// 손으로 고친 원고 (owner request 2026-10-26): the 구성안 → 제작 move and a v13 음성 start count 관문 1 on the 원고 as spoken.
class ApiError extends Error { constructor(status, code, message) { super(message); this.status = status; this.code = code; } }
const source = await readFile(new URL("../lib/server/youtube-script-canon.ts", import.meta.url), "utf8");
const compiled = { exports: {} };
const modules = { "@/lib/http": { ApiError }, "@/lib/youtube-script-check": scriptCheck, "@/lib/myin-script": myinScript };
runInNewContext(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText,
  { module: compiled, exports: compiled.exports, require: (name) => modules[name], process: { env: {} } });
const { assertSpokenScript, SCRIPT_CANON } = compiled.exports;

const canon = SCRIPT_CANON.map((title) => ({ title, content_md: "| ⑫ 정본 예문 흉내 | \"그래도 저는 이 연구가 좋습니다\" |" }));
const supabase = (docs) => ({ from: () => ({ select: () => ({ in: () => { const result = Promise.resolve({ data: docs, error: null }); result.eq = () => result; return result; } }) }) });
const paragraph = (seed) => `${seed} 민지는 약속 시간이 밀릴 때마다 괜찮다고 말해요. 그런데 집에 와서는 오늘도 내 시간을 남이 정했다는 생각에 한참 앉아 있어요. 그래서 다음 약속부터는 시간을 바꾸기 전에 자기한테도 물어봐 달라고 먼저 말해 두기로 했어요.`;
const script = (...extras) => ["# 내가 원하는 것", "", "## 도입", "", ...extras.map((extra, i) => `${paragraph(i)} ${extra}`.trim()).flatMap((line) => [line, ""]),
  "## 출처", "", "1 → 짧은 줄", ""].join("\n");

test("a hand-edited 원고 that keeps 관문 1 passes; headings and the 출처 section are not spoken", async () => {
  await assertSpokenScript(supabase(canon), script("", ""), null);
});

test("a hand edit that breaks 관문 1 is refused with the paragraphs to fix", async () => {
  await assert.rejects(assertSpokenScript(supabase(canon), script("", "그래도 저는 이 연구가 좋습니다. 그럴 수도 있죠."), null), (error) => {
    assert.equal(error.status, 422);
    assert.equal(error.code, "SCRIPT_FORMAT_INVALID");
    assert.match(error.message, /2번 문단 정본 겹침 "그래도 저는 이 연구가 좋습니다/);
    assert.match(error.message, /흐림 종결 .*걸린 문단 2번/);
    return true;
  });
});

test("without the four 원고 정본 the count is not made up", async () => {
  await assert.rejects(assertSpokenScript(supabase(canon.slice(1)), script(""), null), (error) => error.code === "SCRIPT_CANON_UNAVAILABLE");
});
