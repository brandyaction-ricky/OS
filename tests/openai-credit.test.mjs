import assert from "node:assert/strict";
import test from "node:test";
import { creditCycle, sumCosts } from "../lib/openai-credit.ts";

const iso = ({ start, end }) => [start.toISOString().slice(0, 10), end.toISOString().slice(0, 10)];

test("the credit cycle runs from the last renewal day to the next one", () => {
  assert.deepEqual(iso(creditCycle(new Date("2026-10-29T06:00:00Z"), 15)), ["2026-10-15", "2026-11-15"]);
  assert.deepEqual(iso(creditCycle(new Date("2026-10-10T06:00:00Z"), 15)), ["2026-09-15", "2026-10-15"]);
  assert.deepEqual(iso(creditCycle(new Date("2026-01-05T00:00:00Z"), 20)), ["2025-12-20", "2026-01-20"]);
  // a renewal on the 31st falls on the month's last day in shorter months
  assert.deepEqual(iso(creditCycle(new Date("2026-02-28T12:00:00Z"), 31)), ["2026-02-28", "2026-03-31"]);
  assert.deepEqual(iso(creditCycle(new Date("2026-03-01T12:00:00Z"), 1)), ["2026-03-01", "2026-04-01"]);
});

test("spent is the sum of every USD amount in the Costs API page", () => {
  const page = { data: [
    { results: [{ amount: { value: 0.13, currency: "usd" } }, { amount: { value: 1.2, currency: "usd" } }] },
    { results: [] },
    { results: [{ amount: { value: 2, currency: "usd" } }] },
  ], next_page: null };
  assert.equal(Math.round(sumCosts(page) * 100) / 100, 3.33);
  assert.equal(sumCosts({}), 0);
  assert.equal(sumCosts(null), 0);
});
