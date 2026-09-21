import assert from "node:assert/strict";
import test from "node:test";
import { reviewContextChanges, reviewContextFailure, reviewContextSchema } from "../lib/content-review-context.ts";
const fixture = () => ({ status: "ready", policyStatus: "unverified", judgment: null, executionAllowed: false,
  source: { id: "00000000-0000-4000-8000-000000000001", version: 1 }, registryVersion: 1, referenceCount: 2, packageCount: 0,
  markers: { source: "a".repeat(64), criteria: "b".repeat(64), bundle: "c".repeat(64) } });
test("review response rejects forged approval and malformed markers", () => {
  assert.equal(reviewContextSchema.safeParse(fixture()).success, true);
  for (const extra of [{ executionAllowed: true }, { policyStatus: "verified" }, { judgment: "pass" }, { packageCount: 101 }, { markers: {} }, { privateBody: "bad" }]) {
    assert.equal(reviewContextSchema.safeParse({ ...fixture(), ...extra }).success, false);
  }
});
test("review comparison describes source, criteria, package count and opaque bundle changes", () => {
  const before = fixture(); assert.deepEqual(reviewContextChanges(before, fixture()), []);
  const after = fixture(); after.markers = { source: "d".repeat(64), criteria: "e".repeat(64), bundle: "f".repeat(64) }; after.packageCount++;
  const changes = reviewContextChanges(before, after); assert.equal(changes.length, 4);
  assert.match(changes.join(" "), /제작 형식/); assert.match(changes.join(" "), /기준 문서/);
  assert.match(changes.join(" "), /접근 범위/);
});
test("different source and unknown failures never become successful review", () => {
  const after = fixture(); after.source.id = "00000000-0000-4000-8000-000000000002";
  assert.match(reviewContextChanges(fixture(), after)[0], /다른 주제/);
  for (const code of ["stale", "missing_role", "unavailable", "read_failed", "PRIVATE"]) {
    const message = reviewContextFailure(code); assert.ok(message.length > 20); assert.equal(message.includes("PRIVATE"), false);
  }
});
