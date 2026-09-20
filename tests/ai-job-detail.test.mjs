import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

test("AI job rows open an accessible detail panel with the complete request context", () => {
  const workspace = read("components/organization-v3-workspaces.tsx");
  const styles = read("app/globals.css");

  assert.match(workspace, /const \[selectedJob, setSelectedJob\]/);
  assert.match(workspace, /className="ai-job-row"/);
  assert.match(workspace, /onClick=\{\(\) => setSelectedJob\(job\)\}/);
  assert.match(workspace, /role="dialog"/);
  assert.match(workspace, /aria-modal="true"/);
  for (const label of ["요청 내용", "우선순위", "진행률", "담당 팀", "브랜드", "마감", "최근 변경", "태그"]) {
    assert.match(workspace, new RegExp(label));
  }
  assert.match(workspace, /\^https\?:\\\/\\\//i);
  assert.match(styles, /\.activity-list>\.ai-job-row:focus-visible/);
});
