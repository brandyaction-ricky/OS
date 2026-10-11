type DatabaseError = { code?: string | null; message?: string | null } | null;

// Database diagnostics must never include request text, row values, or PostgREST details.
export function developmentRequestDbSignal(error: DatabaseError) {
  const sqlstate = typeof error?.code === "string" && /^[A-Z0-9]{5}$/.test(error.code)
    ? error.code : "unknown";
  const message = error?.message ?? "";
  const signal = /^[A-Z][A-Z0-9_]{2,80}$/.test(message) ? message
    : /row.level security/i.test(message) ? "ROW_LEVEL_SECURITY"
    : /permission denied/i.test(message) ? "PERMISSION_DENIED"
    : /foreign key/i.test(message) ? "FOREIGN_KEY"
    : /check constraint/i.test(message) ? "CHECK_CONSTRAINT"
    : "UNCLASSIFIED";
  return { sqlstate, signal };
}
