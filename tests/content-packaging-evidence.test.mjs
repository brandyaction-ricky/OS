import assert from "node:assert/strict";
import test from "node:test";
import { packagingEvidence as read } from "../lib/content-packaging-evidence.ts";

const row = (patch = {}) => ({ id: "package-1", record_type: "content_package", parent_id: "topic-1", version: 1,
  archived_at: null, created_at: "2026-01-01T00:00:00Z", status: "ready",
  metadata: { packageKind: "title_package", result: { titles: [{ text: "Synthetic title", picked: true }], copies: [{ text: "Synthetic copy", picked: true }] } }, ...patch });
test("stored stars never become approval or policy validation", () => {
  const result = read("topic-1", [row()]);
  assert.equal(result.titles.state, "single");
  assert.equal(result.copies.state, "single");
  assert.equal(result.approval, "unverified");
  assert.equal(result.policy, "unverified");
  assert.equal(result.executionAllowed, false);
});
test("unrelated, archived and reference records cannot supply packaging evidence", () => {
  for (const patch of [{ parent_id: "other" }, { record_type: "content_script" }, { archived_at: "2026-01-02" }, { metadata: { packageKind: "market_reference" } }])
    assert.equal(read("topic-1", [row(patch)]).status, "missing");
});
test("newest unselected package never falls back to an older selected package", () => {
  const latest = row({ id: "package-2", created_at: "2026-01-02T00:00:00Z", metadata: { packageKind: "title_package", result: { titles: [], copies: [] } } });
  const result = read("topic-1", [row(), latest]);
  assert.equal(result.package.id, "package-2"); assert.equal(result.titles.state, "missing");
});
test("multiple selections including duplicate text stay ambiguous", () => {
  const data = row(); data.metadata.result.titles.push({ text: "Synthetic title", picked: true });
  assert.equal(read("topic-1", [data]).titles.state, "multiple");
});
test("malformed picked flag and blank picked text are not silently accepted", () => {
  for (const candidate of [{ text: "test", picked: "true" }, { text: " ", picked: true }, { text: {}, picked: true }, null]) {
    const data = row(); data.metadata.result.copies = [candidate];
    assert.equal(read("topic-1", [data]).copies.state, "invalid");
  }
});
test("invalid package metadata and timestamps stay unverified", () => {
  for (const patch of [{ created_at: "bad" }, { version: 0 }, { metadata: { packageKind: "title_package", result: "bad" } }])
    assert.equal(read("topic-1", [row(patch)]).status, "invalid");
});
test("same-time records do not produce an arbitrary winner", () => {
  assert.equal(read("topic-1", [row(), row({ id: "package-2" })]).status, "ambiguous");
});
test("selection changes expose current version and copy mismatch without editing memo", () => {
  const data = row({ version: 4 }); const before = structuredClone(data);
  const result = read("topic-1", [data], "Another synthetic copy");
  assert.equal(result.copyDiffers, true); assert.equal(result.package.version, 4);
  assert.deepEqual(data, before);
  assert.equal(read("topic-1", [data], "  Synthetic copy  ").copyDiffers, false);
  assert.equal(read("topic-1", [data], "").copyDiffers, false);
});
test("excessive or malformed arrays fail closed", () => {
  for (const titles of ["bad", Array(101).fill({ text: "test", picked: false })]) {
    const data = row(); data.metadata.result.titles = titles;
    assert.equal(read("topic-1", [data]).titles.state, "invalid");
  }
});
