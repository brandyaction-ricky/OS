import assert from "node:assert/strict";
import test from "node:test";
import { developmentRequestDbSignal } from "../lib/development-request-db-error.ts";

test("database diagnostics retain only safe SQLSTATE and signal", () => {
  assert.deepEqual(developmentRequestDbSignal({ code: "42501", message: "new row violates row-level security policy for table os_records" }), { sqlstate: "42501", signal: "ROW_LEVEL_SECURITY" });
  assert.deepEqual(developmentRequestDbSignal({ code: "23514", message: "DEVELOPMENT_REQUEST_METADATA_INVALID" }), { sqlstate: "23514", signal: "DEVELOPMENT_REQUEST_METADATA_INVALID" });
  assert.deepEqual(developmentRequestDbSignal({ code: "23514", message: "request body contains private text" }), { sqlstate: "23514", signal: "UNCLASSIFIED" });
  assert.deepEqual(developmentRequestDbSignal(null), { sqlstate: "unknown", signal: "UNCLASSIFIED" });
});
