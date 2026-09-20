import assert from "node:assert/strict";
import test from "node:test";
import { createMockInput, MOCK_SCENARIOS } from "../lib/system-one-fixtures.ts";
import { runMockJudgment } from "../lib/system-one.ts";

test("ten synthetic scenarios exercise configured behavior, not semantic model accuracy", () => {
  const expected = {
    ready: ["succeeded", "adopt"], missing_revision: ["succeeded", "hold"],
    revise: ["succeeded", "revise"], conflict: ["succeeded", "human_review"],
    forbidden: ["succeeded", "block"], metadata: ["stopped", null],
    injection: ["succeeded", "adopt"], timeout: ["failed", null],
    invalid_output: ["failed", null], budget: ["failed", null],
  };
  assert.equal(MOCK_SCENARIOS.length, 10);
  for (const scenario of MOCK_SCENARIOS) {
    const result = runMockJudgment(createMockInput(scenario.id), {
      id: "fixture-run", at: "2026-01-01T00:00:00.000Z", failure: scenario.failure,
    });
    assert.deepEqual([result.status, result.judgment], expected[scenario.id]);
    if (result.status === "succeeded") {
      assert.equal(result.executionAllowed, false);
      assert.equal(result.accuracy, null);
      assert.equal(result.modelCost, null);
    }
  }
});

test("fixture creation returns independent data and rejects unknown selections", () => {
  const changed = createMockInput("ready");
  changed.source.version++;
  changed.criteria[0].document.access = "denied";
  assert.equal(createMockInput("ready").source.version, 1);
  assert.equal(createMockInput("ready").criteria[0].document.access, "allowed");
  assert.throws(() => createMockInput("unexpected"), /Unknown mock scenario/);
});
