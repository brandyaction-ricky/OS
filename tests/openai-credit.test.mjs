import assert from "node:assert/strict";
import test from "node:test";
import { creditCycle, creditForecast, dailyCosts, sumCosts } from "../lib/openai-credit.ts";

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

test("daily costs keep each bucket's UTC day", () => {
  const page = { data: [
    { start_time: Date.UTC(2026, 10, 1) / 1000, results: [{ amount: { value: 1.5, currency: "usd" } }] },
    { start_time: Date.UTC(2026, 10, 2) / 1000, results: [] },
  ] };
  assert.deepEqual(dailyCosts(page), [{ day: "2026-11-01", usd: 1.5 }, { day: "2026-11-02", usd: 0 }]);
  assert.deepEqual(dailyCosts(null), []);
});

test("the forecast uses the last 7 days' pace and only counts days inside the cycle", () => {
  const daily = [{ day: "2026-11-01", usd: 10 }, { day: "2026-11-02", usd: 4 }];
  // two days into a cycle that began on 11-01: 14 dollars over 2 days = 7 a day; 70 left lasts 10 days
  const early = creditForecast({ remaining: 70, start: "2026-11-01T00:00:00.000Z", end: "2026-12-01T00:00:00.000Z", daily, now: new Date("2026-11-02T12:00:00Z") });
  assert.deepEqual(early.days.slice(-2), ["2026-11-01", "2026-11-02"]);
  assert.equal(early.weekUsd, 14);
  assert.equal(early.perDay, 7);
  assert.equal(early.runOutAt, "2026-11-12T12:00:00.000Z");
  // plenty left: it lasts past the renewal, so no run-out date
  // a day before the cycle began is not part of this cycle's pace
  assert.equal(creditForecast({ remaining: 70, start: "2026-11-01T00:00:00.000Z", end: "2026-12-01T00:00:00.000Z", daily: [...daily, { day: "2026-10-31", usd: 50 }], now: new Date("2026-11-02T12:00:00Z") }).weekUsd, 14);
  assert.equal(creditForecast({ remaining: 400, start: "2026-11-01T00:00:00.000Z", end: "2026-12-01T00:00:00.000Z", daily, now: new Date("2026-11-02T12:00:00Z") }).runOutAt, null);
  // nothing spent this week
  const idle = creditForecast({ remaining: 50, start: "2026-10-01T00:00:00.000Z", end: "2026-11-01T00:00:00.000Z", daily: [], now: new Date("2026-10-20T00:00:00Z") });
  assert.equal(idle.perDay, 0);
  assert.equal(idle.runOutAt, null);
});
