import assert from "node:assert/strict";
import test from "node:test";
import { z } from "zod";
import "../lib/zod-ko.ts";

// 로건 QA 10/30: a staff AI's result came back in English (「body Expected string, received array」) six times.
test("schema problems read in Korean, every field at once", () => {
  const schema = z.object({ body: z.string(), thumbs: z.array(z.number().int().min(1)).min(1), titles: z.array(z.string().min(1)).max(2) }).strict();
  const result = schema.safeParse({ body: ["a"], thumbs: [0], titles: ["a", "b", "c"], extra: 1 });
  assert.equal(result.success, false);
  const lines = result.error.issues.map(issue => `${issue.path.join(".")} ${issue.message}`);
  assert.deepEqual(lines, ["body 글로 써 주세요 — 지금은 목록이에요", "thumbs.0 1 이상이어야 해요", "titles 2개까지예요", " 정해진 칸이 아니에요: extra"]);
  assert.equal(z.object({ a: z.number() }).safeParse({}).error.issues[0].message, "빠졌어요 — 꼭 넣는 칸이에요");
  assert.equal(z.string().min(1, "제목을 써 주세요").safeParse("").error.issues[0].message, "제목을 써 주세요", "a schema's own message wins");
});
