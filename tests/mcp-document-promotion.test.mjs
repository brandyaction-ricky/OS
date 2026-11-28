import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = path => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("AI-written (MCP) team documents can be submitted as canon candidates and stuck review documents can be withdrawn", async () => {
  const [editor, review, vault] = await Promise.all([read("components/knowledge/editor.tsx"), read("components/knowledge/canon.tsx"), read("components/knowledge-workspace.tsx")]);
  // The candidate button follows the document's status, not its space (MCP documents have space "ai").
  assert.match(editor, /const canSubmitCandidate = [^;]*current\.status==="team"/);
  assert.doesNotMatch(editor.match(/const canSubmitCandidate = [^;]*;/)[0], /space/);
  // 정본으로 가는 단계 (2026-11-28): the stage row carries the one next step; the request opens only when allowed.
  assert.match(editor, /onRequest=\{\(\)=>canSubmitCandidate&&void transition\("candidate"\)\}/);
  assert.match(editor, /onShare=\{\(\)=>void transition\("share"\)\}/);
  assert.match(editor, /searchParams\?\.get\("candidate"\)==="1"&&canSubmitCandidate/);
  // Approvers see their own candidates and proposals to review.
  assert.match(review, /i\.state==="open"&&mineToDecide\(i\.candidate\.requested_approver_id\)/);
  assert.doesNotMatch(review, /submitted_by!==actor\.ownerId|author_id!==actor\.ownerId/);
  // The vault no longer moves team → review without a candidate; it links to the candidate dialog and can withdraw review.
  assert.match(vault, /team: ""/);
  assert.match(vault, /\/knowledge\/doc\/\$\{selected\.id\}\?candidate=1/);
  assert.match(vault, /selected\?\.status === "review"[\s\S]{0,120}<button onClick=\{\(\) => guardAction\(\(\) => moveStatus\("team"\)\)\}>검토 회수/);
});
