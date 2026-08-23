import assert from "node:assert/strict";
import test from "node:test";
import { updateFrontmatter } from "../api/push.mjs";

test("updateFrontmatter updates existing keys and adds new keys", () => {
  const source = `---\nid: BA-0268\nversion: 5\nstatus: in_progress\n---\n\n# Body\n`;
  const output = updateFrontmatter(source, { version: 6, status: "waiting_approval", updated_by: "jay" });
  assert.match(output, /version: 6/);
  assert.match(output, /status: waiting_approval/);
  assert.match(output, /updated_by: jay/);
  assert.match(output, /# Body/);
});

test("updateFrontmatter serializes null lock fields", () => {
  const source = `---\nid: BA-0268\nlocked_by: jay\n---\n`;
  const output = updateFrontmatter(source, { locked_by: null });
  assert.match(output, /locked_by: null/);
});
