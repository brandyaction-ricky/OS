import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import {
  loadSystemOneDocumentBundle,
  recheckSystemOneDocumentBundle,
  SYSTEM_ONE_DOCUMENT_FIELDS,
} from "../lib/server/system-one-document-source.ts";

// These injected synthetic sessions exercise the read boundary, not a live
// Supabase identity, deployed API, actual RLS policy, or semantic AI judgment.
const syntheticId = (number) => `00000000-0000-4000-8000-${String(number).padStart(12, "0")}`;
const actorId = syntheticId(1);
const otherActorId = syntheticId(2);
const sourceId = syntheticId(101);
const criterionId = syntheticId(201);
const time = "2026-01-01T00:00:00.000Z";
const md5 = (value) => createHash("md5").update(value, "utf8").digest("hex");

function principal(fields = {}) {
  return { type: "user", id: actorId, role: "member", team: "Synthetic team", active: true, mustChangePassword: false, ...fields };
}

function row(id, fields = {}) {
  const content = fields.content_md ?? `Synthetic local body ${id}.`;
  return {
    id, title: "Synthetic document", content_md: content, status: "canonical",
    owner_id: actorId, team: "Synthetic team", brand: null, folder: "Synthetic fixtures",
    current_version: 1, content_hash: md5(content), updated_at: time, ...fields,
  };
}

function selection(mutate = () => {}) {
  const value = { source: { id: sourceId, expectedVersion: 1 }, criteria: [{ id: criterionId, expectedVersion: 1 }] };
  mutate(value);
  return value;
}

function harness(fields = {}) {
  const state = {
    principal: principal(), rows: [row(sourceId), row(criterionId)], now: time,
    authError: null, readError: null, authCalls: 0, reads: [], ...fields,
  };
  const deps = {
    authenticate: async () => {
      state.authCalls++;
      if (state.authError) throw state.authError;
      return {
        principal: state.principal,
        readHeads: async (ids) => {
          state.reads.push([...ids]);
          if (state.readError) throw state.readError;
          return state.rows;
        },
      };
    },
    now: () => new Date(state.now),
  };
  return { state, deps };
}

async function ready(testHarness = harness(), input = selection()) {
  const result = await loadSystemOneDocumentBundle(input, testHarness.deps);
  assert.equal(result.status, "ready", JSON.stringify(result));
  return result.bundle;
}

function stopped(result, code) {
  assert.equal(result.status, "stopped");
  assert.equal(result.code, code);
  for (const field of ["bundle", "source", "criteria", "principal", "rows", "content_md"]) {
    assert.equal(field in result, false, `stopped response exposes ${field}`);
  }
  assert.equal(JSON.stringify(result).includes("Synthetic local body"), false);
  assert.equal(JSON.stringify(result).includes("synthetic-private-error-detail"), false);
}

test("document projection is explicit and excludes wildcard or unrelated account fields", () => {
  const fields = typeof SYSTEM_ONE_DOCUMENT_FIELDS === "string" ? SYSTEM_ONE_DOCUMENT_FIELDS.split(",") : [...SYSTEM_ONE_DOCUMENT_FIELDS];
  assert.deepEqual(fields.map((field) => field.trim()).sort(), [
    "id", "title", "content_md", "status", "owner_id", "team", "brand", "folder", "current_version", "content_hash", "updated_at",
  ].sort());
});

test("strict invalid selections fail before authentication or document reads", async () => {
  const mutations = [
    (value) => { value.unexpected = true; },
    (value) => { value.source.unexpected = true; },
    (value) => { value.criteria[0].unexpected = true; },
    (value) => { value.source.id = "not-a-uuid"; },
    (value) => { value.source.expectedVersion = 0; },
    (value) => { value.source.expectedVersion = 1.5; },
    (value) => { value.source.expectedVersion = "1"; },
    (value) => { value.criteria[0].expectedVersion = null; },
    (value) => { value.criteria = []; },
    (value) => { value.criteria = Array.from({ length: 11 }, (_, index) => ({ id: syntheticId(201 + index), expectedVersion: 1 })); },
    (value) => { value.criteria[0].id = value.source.id; },
    (value) => { value.criteria.push({ ...value.criteria[0] }); },
  ];
  for (const mutate of mutations) {
    const fixture = harness();
    stopped(await loadSystemOneDocumentBundle(selection(mutate), fixture.deps), "invalid_input");
    assert.equal(fixture.state.authCalls, 0);
    assert.equal(fixture.state.reads.length, 0);
  }
  for (const value of [null, undefined, [], "synthetic-selection"]) {
    const fixture = harness();
    stopped(await loadSystemOneDocumentBundle(value, fixture.deps), "invalid_input");
    assert.equal(fixture.state.authCalls, 0);
  }
});

test("case-normalized UUID duplicates are rejected before authentication", async () => {
  const duplicate = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
  const input = selection((value) => { value.source.id = duplicate; value.criteria[0].id = duplicate.toUpperCase(); });
  const fixture = harness();
  stopped(await loadSystemOneDocumentBundle(input, fixture.deps), "invalid_input");
  assert.equal(fixture.state.authCalls, 0);
});

test("authentication failures, agents, inactive accounts and forced password changes cannot read", async () => {
  const fixtures = [
    harness({ authError: new Error("synthetic-private-error-detail") }),
    harness({ principal: principal({ type: "agent" }) }),
    harness({ principal: principal({ active: false }) }),
    harness({ principal: principal({ mustChangePassword: true }) }),
    harness({ principal: principal({ id: "invalid-actor-id" }) }),
    harness({ principal: principal({ role: "owner" }) }),
    harness({ principal: null }),
  ];
  for (const fixture of fixtures) {
    stopped(await loadSystemOneDocumentBundle(selection(), fixture.deps), "authentication_failed");
    assert.equal(fixture.state.authCalls, 1);
    assert.equal(fixture.state.reads.length, 0);
  }
});

test("only the freshly authenticated session closure reads the exact selected documents", async () => {
  const fixture = harness();
  const bundle = await ready(fixture);
  assert.equal(fixture.state.authCalls, 1);
  assert.deepEqual(fixture.state.reads, [[sourceId, criterionId]]);
  assert.equal(bundle.source.id, sourceId);
  assert.equal(bundle.criteria[0].id, criterionId);
  assert.deepEqual(bundle.principal, principal());
  assert.equal(bundle.checkedAt, time);
  assert.equal(bundle.policyStatus, "unverified");
  assert.equal(bundle.source.state, "head_verified");
  assert.equal(bundle.criteria[0].state, "head_verified");
  assert.equal(typeof bundle.fingerprint, "string");
  assert.ok(bundle.fingerprint.length > 0);
  for (const snapshot of [bundle.source, ...bundle.criteria]) {
    assert.equal(typeof snapshot.fingerprint, "string");
    assert.ok(snapshot.fingerprint.length > 0);
  }
});

test("read order is irrelevant and criterion order follows the explicit selection", async () => {
  const secondCriterionId = syntheticId(202);
  const fixture = harness({ rows: [row(secondCriterionId), row(criterionId), row(sourceId)] });
  const input = selection((value) => { value.criteria.push({ id: secondCriterionId, expectedVersion: 1 }); });
  const bundle = await ready(fixture, input);
  assert.equal(bundle.source.id, sourceId);
  assert.deepEqual(bundle.criteria.map((item) => item.id), [criterionId, secondCriterionId]);
});

test("unclassified source and criterion documents retain an empty folder and remain readable", async (context) => {
  for (const [name, index] of [["source", 0], ["criterion", 1]]) {
    await context.test(name, async () => {
      const fixture = harness();
      fixture.state.rows[index].folder = "";
      const bundle = await ready(fixture);
      const snapshot = index === 0 ? bundle.source : bundle.criteria[0];
      assert.equal(snapshot.folder, "");
      assert.equal(snapshot.state, "head_verified");
    });
  }
});

test("missing, unrequested or duplicate rows withhold the entire bundle", async () => {
  const cases = [
    [], [row(sourceId)], [row(criterionId)],
    [row(sourceId), row(criterionId), row(syntheticId(999))],
    [row(sourceId), row(sourceId)],
    [row(sourceId), row(criterionId), row(criterionId)],
    [row(sourceId), row(syntheticId(999))],
  ];
  for (const rows of cases) {
    stopped(await loadSystemOneDocumentBundle(selection(), harness({ rows }).deps), "unavailable");
  }
});

test("malformed row metadata fails closed without returning a valid sibling document", async () => {
  const mutations = [
    (value) => { value.current_version = 0; },
    (value) => { value.current_version = 1.5; },
    (value) => { value.current_version = "1"; },
    (value) => { value.content_hash = "not-md5"; },
    (value) => { value.updated_at = "yesterday"; },
    (value) => { value.owner_id = "not-a-uuid"; },
    (value) => { value.status = "invented-state"; },
    (value) => { value.content_md = null; },
    (value) => { value.team = null; },
    (value) => { delete value.title; },
    (value) => { value.unrequested_field = "synthetic-extra"; },
  ];
  for (const mutate of mutations) {
    const rows = [row(sourceId), row(criterionId)];
    mutate(rows[1]);
    stopped(await loadSystemOneDocumentBundle(selection(), harness({ rows }).deps), "invalid_metadata");
  }
});

test("a syntactically valid MD5 must match the exact body rather than merely look valid", async () => {
  for (const index of [0, 1]) {
    const rows = [row(sourceId), row(criterionId)];
    rows[index].content_hash = md5("Different synthetic body");
    stopped(await loadSystemOneDocumentBundle(selection(), harness({ rows }).deps), "invalid_metadata");
  }
  const fixture = harness();
  const previous = await ready(fixture);
  fixture.state.rows[0].content_md += " Changed without updating MD5.";
  stopped(await recheckSystemOneDocumentBundle(previous, fixture.deps), "invalid_metadata");
});

test("expected source or criterion version mismatches do not silently accept current heads", async () => {
  for (const index of [0, 1]) {
    const rows = [row(sourceId), row(criterionId)];
    rows[index].current_version = 2;
    stopped(await loadSystemOneDocumentBundle(selection(), harness({ rows }).deps), "stale");
  }
});

test("draft source and criteria require their owner or an administrator", async () => {
  for (const index of [0, 1]) {
    for (const [role, owner, expected] of [["member", actorId, "ready"], ["member", otherActorId, "unavailable"], ["lead", otherActorId, "unavailable"], ["admin", otherActorId, "ready"]]) {
      const rows = [row(sourceId), row(criterionId)];
      rows[index].status = "draft";
      rows[index].owner_id = owner;
      const result = await loadSystemOneDocumentBundle(selection(), harness({ rows, principal: principal({ role }) }).deps);
      if (expected === "ready") assert.equal(result.status, "ready");
      else stopped(result, expected);
    }
  }
});

test("team visibility is rechecked independently of a reader returning the document", async () => {
  const cases = [
    { role: "member", documentTeam: "Synthetic team", expected: "ready" },
    { role: "member", documentTeam: "", expected: "ready" },
    { role: "member", documentTeam: "Other synthetic team", expected: "unavailable" },
    { role: "lead", documentTeam: "Other synthetic team", expected: "ready" },
    { role: "admin", documentTeam: "Other synthetic team", expected: "ready" },
  ];
  for (const index of [0, 1]) {
    for (const item of cases) {
      const rows = [row(sourceId), row(criterionId)];
      rows[index].status = "team";
      rows[index].team = item.documentTeam;
      rows[index].owner_id = otherActorId;
      const result = await loadSystemOneDocumentBundle(selection(), harness({ rows, principal: principal({ role: item.role }) }).deps);
      if (item.expected === "ready") assert.equal(result.status, "ready");
      else stopped(result, item.expected);
    }
  }
});

test("archived source or criteria are unavailable even to owners and administrators", async () => {
  for (const role of ["member", "admin"]) {
    for (const index of [0, 1]) {
      const rows = [row(sourceId), row(criterionId)];
      rows[index].status = "archived";
      stopped(await loadSystemOneDocumentBundle(selection(), harness({ rows, principal: principal({ role }) }).deps), "unavailable");
    }
  }
});

test("a thrown read error is sanitized and does not return a partial bundle", async () => {
  const fixture = harness({ readError: new Error("synthetic-private-error-detail") });
  stopped(await loadSystemOneDocumentBundle(selection(), fixture.deps), "read_failed");
  assert.equal(fixture.state.authCalls, 1);
  assert.equal(fixture.state.reads.length, 1);
});

test("an invalid verification clock cannot create an apparently checked bundle", async () => {
  stopped(await loadSystemOneDocumentBundle(selection(), harness({ now: "invalid-date" }).deps), "invalid_metadata");
});

test("per-document byte limits reject multi-byte overflow rather than counting characters", async () => {
  const boundary = "한".repeat(40000);
  const oversized = `${boundary}한`;
  assert.equal(Buffer.byteLength(boundary), 120000);
  assert.equal(Buffer.byteLength(oversized), 120003);
  for (const index of [0, 1]) {
    const rows = [row(sourceId), row(criterionId)];
    rows[index] = row(rows[index].id, { content_md: boundary });
    assert.equal((await loadSystemOneDocumentBundle(selection(), harness({ rows }).deps)).status, "ready");
    rows[index] = row(rows[index].id, { content_md: oversized });
    stopped(await loadSystemOneDocumentBundle(selection(), harness({ rows }).deps), "invalid_metadata");
  }
});

test("aggregate bundle byte limits reject many individually valid documents", async () => {
  const input = selection((value) => {
    value.criteria = Array.from({ length: 4 }, (_, index) => ({ id: syntheticId(201 + index), expectedVersion: 1 }));
  });
  const rows = [input.source, ...input.criteria].map((item) => row(item.id, { content_md: "x".repeat(110000) }));
  assert.ok(rows.every((item) => Buffer.byteLength(item.content_md) < 120000));
  assert.ok(rows.reduce((total, item) => total + Buffer.byteLength(item.content_md), 0) > 512000);
  stopped(await loadSystemOneDocumentBundle(input, harness({ rows }).deps), "invalid_metadata");
});

test("ready snapshots are detached and deeply immutable", async () => {
  const fixture = harness();
  const input = selection();
  const bundle = await ready(fixture, input);
  const before = JSON.stringify(bundle);
  fixture.state.rows[0].content_md = "Synthetic post-read mutation";
  fixture.state.principal.team = "Mutated synthetic team";
  input.source.expectedVersion = 99;
  assert.equal(JSON.stringify(bundle), before);
  for (const value of [bundle, bundle.source, bundle.criteria, bundle.criteria[0], bundle.principal]) assert.equal(Object.isFrozen(value), true);
  assert.throws(() => { bundle.source.content_md = "Attempted mutation"; }, TypeError);
  assert.throws(() => { bundle.criteria.push(bundle.source); }, TypeError);
  assert.throws(() => { bundle.principal.role = "admin"; }, TypeError);
});

test("rechecks reject forged and serialized-cloned bundles before authentication", async () => {
  const original = await ready();
  for (const forged of [null, {}, { ...original }, structuredClone(original), JSON.parse(JSON.stringify(original))]) {
    const fixture = harness();
    stopped(await recheckSystemOneDocumentBundle(forged, fixture.deps), "invalid_input");
    assert.equal(fixture.state.authCalls, 0);
    assert.equal(fixture.state.reads.length, 0);
  }
});

test("each valid recheck authenticates and reads again but checkedAt alone does not invalidate the fingerprint", async () => {
  const fixture = harness();
  const previous = await ready(fixture);
  fixture.state.now = "2026-01-01T01:00:00.000Z";
  const result = await recheckSystemOneDocumentBundle(previous, fixture.deps);
  assert.equal(result.status, "ready");
  assert.equal(fixture.state.authCalls, 2);
  assert.deepEqual(fixture.state.reads, [[sourceId, criterionId], [sourceId, criterionId]]);
  assert.notEqual(result.bundle.checkedAt, previous.checkedAt);
  assert.equal(result.bundle.fingerprint, previous.fingerprint);
  assert.equal(result.bundle.source.fingerprint, previous.source.fingerprint);
  assert.equal(result.bundle.criteria[0].fingerprint, previous.criteria[0].fingerprint);
});

test("revoked source or criterion access withholds every document on recheck", async () => {
  for (const index of [0, 1]) {
    const fixture = harness();
    const previous = await ready(fixture);
    fixture.state.rows[index].status = "draft";
    fixture.state.rows[index].owner_id = otherActorId;
    stopped(await recheckSystemOneDocumentBundle(previous, fixture.deps), "unavailable");
    assert.equal(fixture.state.authCalls, 2);
  }
});

test("a criterion disappearing from the fresh read invalidates the complete previous bundle", async () => {
  const fixture = harness();
  const previous = await ready(fixture);
  fixture.state.rows = [row(sourceId)];
  stopped(await recheckSystemOneDocumentBundle(previous, fixture.deps), "unavailable");
});

test("same-version readable metadata and body changes are stale rather than silently accepted", async () => {
  const mutations = [
    (value) => { value.status = "review"; },
    (value) => { value.team = "Different synthetic team"; },
    (value) => { value.owner_id = otherActorId; },
    (value) => { value.title = "Changed synthetic title"; },
    (value) => { value.folder = "Different synthetic folder"; },
    (value) => { value.brand = "Different synthetic brand"; },
    (value) => { value.updated_at = "2026-01-01T01:00:00.000Z"; },
    (value) => { value.content_md += " Changed body."; value.content_hash = md5(value.content_md); },
  ];
  for (const index of [0, 1]) {
    for (const mutate of mutations) {
      const fixture = harness();
      const previous = await ready(fixture);
      mutate(fixture.state.rows[index]);
      assert.equal(fixture.state.rows[index].current_version, 1);
      stopped(await recheckSystemOneDocumentBundle(previous, fixture.deps), "stale");
    }
  }
});

test("same-version team changes that revoke visibility are unavailable rather than stale-readable", async () => {
  for (const index of [0, 1]) {
    const fixture = harness();
    fixture.state.rows[index].status = "team";
    fixture.state.rows[index].owner_id = otherActorId;
    const previous = await ready(fixture);
    fixture.state.rows[index].team = "Other synthetic team";
    stopped(await recheckSystemOneDocumentBundle(previous, fixture.deps), "unavailable");
  }
});

test("a version change in source or criterion invalidates recheck", async () => {
  for (const index of [0, 1]) {
    const fixture = harness();
    const previous = await ready(fixture);
    fixture.state.rows[index].current_version = 2;
    stopped(await recheckSystemOneDocumentBundle(previous, fixture.deps), "stale");
  }
});

test("a different authenticated actor cannot reopen another actor's issued bundle", async () => {
  const fixture = harness();
  const previous = await ready(fixture);
  fixture.state.principal = principal({ id: otherActorId });
  stopped(await recheckSystemOneDocumentBundle(previous, fixture.deps), "unavailable");
});

test("same-actor role or team changes invalidate the principal fingerprint even while documents stay readable", async () => {
  for (const fields of [{ role: "lead" }, { role: "admin" }, { team: "Different synthetic team" }]) {
    const fixture = harness();
    const previous = await ready(fixture);
    fixture.state.principal = principal(fields);
    stopped(await recheckSystemOneDocumentBundle(previous, fixture.deps), "stale");
  }
});

test("a role downgrade that removes team visibility is unavailable rather than merely stale", async () => {
  const fixture = harness({ principal: principal({ role: "lead" }) });
  fixture.state.rows[1].status = "team";
  fixture.state.rows[1].team = "Other synthetic team";
  fixture.state.rows[1].owner_id = otherActorId;
  const previous = await ready(fixture);
  fixture.state.principal = principal({ role: "member" });
  stopped(await recheckSystemOneDocumentBundle(previous, fixture.deps), "unavailable");
});

test("disabled or password-change-required actors fail authentication on recheck", async () => {
  for (const fields of [{ active: false }, { mustChangePassword: true }, { type: "agent" }]) {
    const fixture = harness();
    const previous = await ready(fixture);
    fixture.state.principal = principal(fields);
    stopped(await recheckSystemOneDocumentBundle(previous, fixture.deps), "authentication_failed");
    assert.equal(fixture.state.authCalls, 2);
    assert.equal(fixture.state.reads.length, 1);
  }
});

test("a fresh reader failure on recheck never falls back to cached document bodies", async () => {
  const fixture = harness();
  const previous = await ready(fixture);
  fixture.state.readError = new Error("synthetic-private-error-detail");
  stopped(await recheckSystemOneDocumentBundle(previous, fixture.deps), "read_failed");
  assert.equal(fixture.state.authCalls, 2);
  assert.equal(fixture.state.reads.length, 2);
});
