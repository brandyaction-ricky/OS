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

test("the 업무 표 is read from the registries; a role pointing at non-canon or 자료실 is flagged; 자료실 is a list beside the document", async () => {
  const { parseRegistry, registryIssue, roleGroup } = await import("../lib/knowledge/registry.ts");
  const roles = parseRegistry([
    "| 역할키 | 대상 doc_id | 담당 범위 | 별칭 |", "|---|---|---|---|",
    "| `content.advertising` | `6d38e1f4-4722-4ab1-9b26-cf4b378b3188` | 회사 유료 광고 | 메타광고 |",
    "| `brand.context` | `d92c2bd6-23ed-4cbe-a65e-4f15e9ce816a` | 사업·브랜드 맥락 | 핵심 컨텍스트 |",
    "| not a role | text | x | y |",
  ].join("\n"));
  assert.deepEqual(roles.map(r => [r.key, r.id.slice(0, 8), r.scope]), [["content.advertising", "6d38e1f4", "회사 유료 광고"], ["brand.context", "d92c2bd6", "사업·브랜드 맥락"]]);
  assert.equal(roleGroup("content.advertising.myin"), "콘텐츠 제작");
  assert.equal(roleGroup("diagnosis.report"), "마이인");
  assert.equal(registryIssue("canonical", false), null);
  assert.equal(registryIssue("draft", false), "draft");
  assert.equal(registryIssue("team", false, true), "draft");
  assert.equal(registryIssue("canonical", true), "library");
  assert.equal(registryIssue(undefined, false), "missing");

  const sql = await read("supabase/migrations/20261128130000_document_library.sql");
  assert.match(sql, /create table if not exists public\.os_document_library/);
  assert.match(sql, /if not public\.os_is_admin\(\) then raise exception 'OS_LIBRARY_ADMIN_REQUIRED'/);
  assert.match(sql, /where d\.id=any\(p_ids\) and d\.status='canonical'/);
  assert.doesNotMatch(sql, /update public\.os_documents/);   // the document itself is never touched
  const route = await read("app/api/v1/knowledge/workspace/route.ts");
  assert.match(route, /rpc\("os_set_document_library"/);
});
