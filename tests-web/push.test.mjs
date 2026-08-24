import assert from "node:assert/strict";
import test from "node:test";
import { artifactMarkdown, parseProcessStep, updateFrontmatter, validateAssetReference, validatePublicCommitText } from "../api/push.mjs";

test("updateFrontmatter updates existing keys and adds new keys", () => {
  const source = `---\nid: BA-0268\nversion: 5\nstatus: in_progress\n---\n\n# Body\n`;
  const output = updateFrontmatter(source, { version: 6, status: "waiting_approval", updated_by: "jay" });
  assert.match(output, /version: 6/);
  assert.match(output, /status: "waiting_approval"/);
  assert.match(output, /updated_by: "jay"/);
  assert.match(output, /# Body/);
});

test("updateFrontmatter serializes null lock fields", () => {
  const source = `---\nid: BA-0268\nlocked_by: jay\n---\n`;
  const output = updateFrontmatter(source, { locked_by: null });
  assert.match(output, /locked_by: null/);
});

test("artifactMarkdown includes the required artifact identity fields", () => {
  const output = artifactMarkdown({
    contentId: "BA-0268",
    process: "longform",
    step: "edit",
    version: 2,
    actor: "jay",
    summary: "편집 결과",
    mode: "submit",
  });
  assert.match(output, /artifact_key: "edit"/);
  assert.match(output, /title: "edit 작업 결과"/);
});

test("artifactMarkdown links v2 to the previous artifact", () => {
  const output = artifactMarkdown({
    contentId: "BA-0268",
    process: "longform",
    step: "script",
    artifactKey: "reading_script",
    version: 2,
    actor: "jay",
    summary: "낭독본 수정",
    mode: "review",
  });
  assert.match(output, /id: BA-0268-reading_script-v2/);
  assert.match(output, /artifact_key: "reading_script"/);
  assert.match(output, /parent_id: "BA-0268-reading_script-v1"/);
});

test("parseProcessStep keeps each multi-output pointer with its artifact", () => {
  const process = `---
steps:
  - id: script
    folder: 03_script
    outputs:
      - key: script
        pointer: latest_script
        required: true
      - key: reading_script
        pointer: latest_reading_script
        required: true
    work_action: 원고 작성
    review_action: 원고 검수
---`;
  assert.deepEqual(parseProcessStep(process, "script").outputs, [
    { key: "script", pointer: "latest_script" },
    { key: "reading_script", pointer: "latest_reading_script" },
  ]);
});

test("artifactMarkdown repairs uploaded frontmatter to schema 1.0", () => {
  const output = artifactMarkdown({
    contentId: "BA-0268",
    process: "longform",
    step: "edit",
    artifactKey: "edit",
    version: 3,
    actor: "jay",
    summary: "편집 결과",
    mode: "submit",
    sourceMarkdown: "---\ncontent_id: BA-0268\nstep: edit\nmalformed: [\ncreated_at: not-a-date\n---\n\n# 결과\n",
  });
  assert.match(output, /schema_version: "1.0"/);
  assert.match(output, /entity_type: artifact/);
  assert.match(output, /artifact_key: "edit"/);
  assert.doesNotMatch(output, /malformed:|not-a-date/);
});

test("public push rejects traversal assets and signed credentials", () => {
  assert.throws(() => validateAssetReference("asset://longform/../secret", "edit"), /\. 또는 \.\./);
  assert.throws(() => validatePublicCommitText("https://storage.example/file?X-Amz-Signature=secret"), /서명형 URL/);
  assert.doesNotThrow(() => validatePublicCommitText("https://youtube.com/watch?v=public"));
});
