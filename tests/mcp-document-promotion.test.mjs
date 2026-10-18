import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = path => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("AI-written (MCP) team documents can be submitted as canon candidates and stuck review documents can be withdrawn", async () => {
  const [editor, review, vault] = await Promise.all([read("components/knowledge/editor.tsx"), read("components/knowledge/canon.tsx"), read("components/knowledge-workspace.tsx")]);
  // The candidate button follows the document's status, not its space (MCP documents have space "ai").
  assert.match(editor, /const canSubmitCandidate = [^;]*current\.status==="team"/);
  assert.doesNotMatch(editor.match(/const canSubmitCandidate = [^;]*;/)[0], /space/);
  assert.match(editor, /\{canSubmitCandidate&&<button onClick=\{\(\)=>void transition\("candidate"\)\}>정본 후보로 올리기/);
  assert.match(editor, /current\.status==="draft"\?"팀에 공유":"내 노트로 이동"/);
  assert.match(editor, /searchParams\?\.get\("candidate"\)==="1"&&canSubmitCandidate/);
  // The designated approver sees their own candidates and proposals to review.
  assert.match(review, /\(c\.submitted_by!==actor\.ownerId\|\|actor\.designatedApprover===true\)/);
  assert.match(review, /\(p\.author_id!==actor\.ownerId\|\|actor\.designatedApprover===true\)/);
  // The vault no longer moves team → review without a candidate; it links to the candidate dialog and can withdraw review.
  assert.match(vault, /team: ""/);
  assert.match(vault, /\/knowledge\/doc\/\$\{selected\.id\}\?candidate=1/);
  assert.match(vault, /selected\?\.status === "review"[\s\S]{0,120}<button onClick=\{\(\) => guardAction\(\(\) => moveStatus\("team"\)\)\}>검토 회수/);
});
