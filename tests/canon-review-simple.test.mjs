import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("정본 요청 carries one line of why and the approval is pinned to the version the approver saw", async () => {
  const sql = await read("supabase/migrations/20261128120000_canon_review_simple.sql");
  assert.match(sql, /add column if not exists submit_note text not null default ''/);
  assert.match(sql, /add column if not exists approved_version integer/);
  // decide remembers the version; a changed approved candidate may only be approved again
  assert.match(sql, /approved_version=case when p_decision='approved' then d\.current_version else null end/);
  assert.match(sql, /c\.status='approved' and d\.status='reviewed' and c\.approved_version is distinct from d\.current_version/);
  assert.match(sql, /c\.status='approved' and p_decision<>'approved'/);
  // publish refuses text the approver never saw
  assert.match(sql, /c\.approved_version is not null and c\.approved_version is distinct from d\.current_version[\s\S]{0,80}OS_CANDIDATE_CHANGED_SINCE_APPROVAL/);
  assert.match(sql, /grant execute on function public\.os_candidate_note\(uuid,text\) to authenticated/);

  const route = await read("app/api/v1/knowledge/workspace/route.ts");
  assert.match(route, /parsed\.data\.action==="candidate\.submit"&&typeof parsed\.data\.note==="string"/);
  assert.match(route, /rpc\("os_candidate_note",\{p_id:candidateId,p_note:note\}\)/);
  assert.match(route, /OS_CANDIDATE_CHANGED_SINCE_APPROVAL[\s\S]{0,120}다시 승인해 주세요/);
  assert.match(route, /canonical_publisher/);
});

test("staff see one next step, the request needs only the why line, and the approver approves once", async () => {
  const [stage, editor, review] = await Promise.all([read("components/knowledge/stage.tsx"), read("components/knowledge/editor.tsx"), read("components/knowledge/canon.tsx")]);
  assert.match(stage, /export const STAGES = \["내 초안", "팀 공유", "정본 요청", "정본"\]/);
  assert.match(stage, /status === "review" \|\| status === "reviewed" \? 2/);
  // defaults: the canon publisher approves, the author looks after it, review in 90 days
  assert.match(stage, /approvers\.find\(p => p\.publisher\)/);
  assert.match(editor, /useState\(doc\.review_due_on\?\?inDays\(90\)\)/);
  assert.match(editor, /disabled=\{busy\|\|\(kind==="candidate"&&\(!reason\.trim\(\)\|\|!approver\|\|!due\)\)\}/);
  assert.match(editor, /note:kind==="candidate"\?reason\.trim\(\):undefined/);
  // one button: approve, then register when the approver may register canon
  assert.match(review, /if\(oneStep\)\{await command\(\{action:"candidate\.publish"/);
  assert.match(review, /oneStep\?"정본으로 승인":"검토 승인"/);
  // stale proposals are their own tab and can be closed
  assert.match(review, /stale:p\.status==="open"&&Boolean\(d\)&&p\.base_version!==d!\.current_version/);
  assert.match(review, />제안 닫기</);
  assert.doesNotMatch(review, /작성자·문서 소유자는 자신의 제안을 승인할 수 없습니다/);
});
