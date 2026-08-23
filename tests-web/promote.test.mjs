import assert from "node:assert/strict";
import test from "node:test";
import { parseMarkdown, updateFrontmatter, validateRawPath, wikiMarkdown } from "../api/promote.mjs";

const rawSource = `---
schema_version: "1.0"
id: raw-jay-edit-v1
entity_type: raw
scope: person
category: practice
owner: jay
title: 편집 메모
status: raw
version: 1
wiki_target: edit-notes
created_at: 2026-08-23T09:00:00+09:00
updated_at: 2026-08-23T09:00:00+09:00
updated_by: jay
---

# 편집 메모

재사용할 작업 순서입니다.`;

test("Raw path only accepts Raw folders", () => {
  assert.equal(validateRawPath("09_raw/people/jay/edit.md"), "09_raw/people/jay/edit.md");
  assert.throws(() => validateRawPath("05_contents/BA-0268/CONTENT.md"));
  assert.throws(() => validateRawPath("09_raw/people/../secret.md"));
});

test("Wiki promotion keeps Raw body and provenance", () => {
  const raw = parseMarkdown(rawSource);
  const output = wikiMarkdown({ raw, actor: "jay", version: 2, wikiType: "practice", wikiId: "edit-notes", summary: "팀 공통 순서", now: "2026-08-23T10:00:00.000Z" });
  assert.match(output, /version: 2/);
  assert.match(output, /source_ids: \[raw-jay-edit-v1\]/);
  assert.match(output, /재사용할 작업 순서입니다/);
  assert.match(output, /팀 공통 순서/);
});

test("Raw is marked promoted without deleting its body", () => {
  const output = updateFrontmatter(rawSource, { status: "promoted", promoted_to: "10_wiki/practice/edit-notes/WIKI_v1.md" });
  assert.match(output, /status: promoted/);
  assert.match(output, /promoted_to: 10_wiki\/practice\/edit-notes\/WIKI_v1.md/);
  assert.match(output, /재사용할 작업 순서입니다/);
});
