import assert from "node:assert/strict";
import test from "node:test";
import { sanitizePublicCopy, sanitizePublicCopyValue } from "../lib/content-safety.ts";

test("유튜브 공개 문안의 금칙어를 일상어로 치환한다", () => {
  assert.equal(sanitizePublicCopy("Gallup CliftonStrengths 갤럽강점 강점검사"), "강점 강점 강점 강점");
  assert.equal(sanitizePublicCopy("대상A 모방욕망 개성화 일반 문장"), "일반 문장");
});

test("발행 키트의 배열과 중첩 문안도 모두 필터링한다", () => {
  assert.deepEqual(sanitizePublicCopyValue({ tags: ["갤럽강점", "커리어"], post: { body: "StrengthsFinder 활용" } }), { tags: ["강점", "커리어"], post: { body: "강점 활용" } });
});
