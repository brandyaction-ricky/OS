import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const migrationsDirectory = path.join(root, "supabase", "migrations");
const legacyMigrationsDirectory = path.join(root, "supabase", "migrations-legacy");
const manifestPath = path.join(root, "supabase", "migration-baseline.json");

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function migrationVersion(file) {
  return file.match(/^(\d{12}|\d{14})_[a-z0-9_]+\.sql$/)?.[1] ?? null;
}

function hasPublicObject(sql, kind, name) {
  const escapedName = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const prefix = {
    function: "CREATE OR REPLACE FUNCTION",
    table: "CREATE TABLE IF NOT EXISTS",
    type: "CREATE TYPE",
  }[kind];
  return new RegExp(`${prefix} "public"\\."${escapedName}"`).test(sql);
}

function count(sql, pattern) {
  return sql.match(pattern)?.length ?? 0;
}

export async function inspectMigrationBaseline() {
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  const activeFiles = (await readdir(migrationsDirectory))
    .filter((file) => file.endsWith(".sql"))
    .sort();
  const archivedFiles = (await readdir(legacyMigrationsDirectory))
    .filter((file) => file.endsWith(".sql"))
    .sort();
  const forwardMigrations = manifest.forwardMigrations ?? [];
  const expectedActiveFiles = [
    ...(manifest.baseline.file ? [manifest.baseline.file] : []),
    ...forwardMigrations.map((entry) => entry.file),
  ].sort();
  const expectedArchivedFiles = manifest.legacyMigrations.map((entry) => entry.file).sort();
  const errors = [];
  const allFiles = [...activeFiles, ...archivedFiles];
  const versions = allFiles.map(migrationVersion);

  if (versions.some((version) => !version)) {
    errors.push("migration filenames must use a CLI-compatible version and snake-case name");
  }
  if (new Set(versions).size !== versions.length) {
    errors.push("migration versions must be unique across active and archived files");
  }
  if (activeFiles.join("\n") !== expectedActiveFiles.join("\n")) {
    errors.push("active migration files differ from the baseline manifest");
  }
  if (archivedFiles.join("\n") !== expectedArchivedFiles.join("\n")) {
    errors.push("archived legacy migrations differ from the frozen manifest");
  }

  for (const entry of manifest.legacyMigrations) {
    let sql;
    try {
      sql = await readFile(path.join(legacyMigrationsDirectory, entry.file), "utf8");
    } catch {
      errors.push(`missing archived migration: ${entry.file}`);
      continue;
    }
    if (sha256(sql) !== entry.sha256) {
      errors.push(`archived migration checksum changed: ${entry.file}`);
    }
  }

  for (const entry of forwardMigrations) {
    let sql;
    try {
      sql = await readFile(path.join(migrationsDirectory, entry.file), "utf8");
    } catch {
      errors.push(`missing forward migration: ${entry.file}`);
      continue;
    }
    if (sha256(sql) !== entry.sha256) {
      errors.push(`forward migration checksum changed: ${entry.file}`);
    }
    if (/^(INSERT INTO|COPY) /m.test(sql)) {
      errors.push(`forward migration must not contain row data: ${entry.file}`);
    }
    if (/(postgres(?:ql)?:\/\/|sb_(?:secret|publishable)_[A-Za-z0-9_-]+|eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,})/.test(sql)) {
      errors.push(`forward migration contains a credential-like literal: ${entry.file}`);
    }
  }

  const firstLegacyFile = expectedArchivedFiles[0];
  const firstLegacySql = firstLegacyFile
    ? await readFile(path.join(legacyMigrationsDirectory, firstLegacyFile), "utf8")
    : "";
  if (!firstLegacySql.includes("OS_CORE_SCHEMA_REQUIRED")) {
    errors.push("the first archived legacy migration no longer guards its core prerequisites");
  }

  const baselineFile = manifest.baseline.file;
  const baselinePresent = Boolean(baselineFile && activeFiles.includes(baselineFile));
  let baselineSql = "";
  if (!baselinePresent) {
    errors.push(`declared baseline is missing: ${baselineFile ?? "unset"}`);
  } else {
    baselineSql = await readFile(path.join(migrationsDirectory, baselineFile), "utf8");
    if (sha256(baselineSql) !== manifest.baseline.sha256) {
      errors.push(`baseline checksum changed: ${baselineFile}`);
    }
  }

  if (baselineSql) {
    for (const extension of manifest.baseline.requiredExtensions) {
      if (!baselineSql.includes(`CREATE EXTENSION IF NOT EXISTS "${extension}" WITH SCHEMA "extensions";`)) {
        errors.push(`baseline extension is missing: ${extension}`);
      }
    }
    for (const type of manifest.baseline.requiredTypes) {
      if (!hasPublicObject(baselineSql, "type", type)) errors.push(`baseline type is missing: ${type}`);
    }
    for (const table of manifest.baseline.requiredTables) {
      if (!hasPublicObject(baselineSql, "table", table)) errors.push(`baseline table is missing: ${table}`);
    }
    for (const fn of manifest.baseline.requiredFunctions) {
      if (!hasPublicObject(baselineSql, "function", fn)) errors.push(`baseline function is missing: ${fn}`);
    }

    const tableCount = count(baselineSql, /^CREATE TABLE /gm);
    const rlsCount = count(baselineSql, /^ALTER TABLE .* ENABLE ROW LEVEL SECURITY;/gm);
    const statementCounts = {
      tables: tableCount,
      rlsEnabledTables: rlsCount,
      types: count(baselineSql, /^CREATE TYPE /gm),
      functions: count(baselineSql, /^CREATE OR REPLACE FUNCTION /gm),
      policies: count(baselineSql, /^CREATE POLICY /gm),
      indexes: count(baselineSql, /^CREATE (?:UNIQUE )?INDEX /gm),
      triggers: count(baselineSql, /^CREATE (?:OR REPLACE )?TRIGGER /gm),
      grants: count(baselineSql, /^GRANT /gm),
      revokes: count(baselineSql, /^REVOKE /gm),
      securityDefinerFunctions: count(baselineSql, /SECURITY DEFINER/g),
    };
    for (const [statement, expectedCount] of Object.entries(manifest.baseline.statementCounts)) {
      if (statementCounts[statement] !== expectedCount) {
        errors.push(`baseline ${statement} count differs from the reviewed snapshot`);
      }
    }
    if (rlsCount !== tableCount) {
      errors.push("every public baseline table must enable RLS");
    }
    if (/^(INSERT INTO|COPY) /m.test(baselineSql)) {
      errors.push("baseline must not contain row data statements");
    }
    if (/(postgres(?:ql)?:\/\/|sb_(?:secret|publishable)_[A-Za-z0-9_-]+|eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,})/.test(baselineSql)) {
      errors.push("baseline contains a credential-like literal");
    }

    const privilegedFunctions = baselineSql
      .split(/(?=CREATE OR REPLACE FUNCTION )/)
      .filter((block) => block.startsWith("CREATE OR REPLACE FUNCTION ") && block.includes("SECURITY DEFINER"));
    if (privilegedFunctions.some((block) => !block.includes('SET "search_path" TO'))) {
      errors.push("every SECURITY DEFINER function must set an explicit search_path");
    }
  }

  const pendingApprovalMigrations = forwardMigrations.filter(entry => entry.requiresApproval === true).map(entry => entry.file);
  return {
    status: manifest.status,
    decision: manifest.decision,
    integrityValid: errors.length === 0,
    readyToApply: manifest.status === "ready" && manifest.decision === "apply" && baselinePresent && errors.length === 0 && pendingApprovalMigrations.length === 0,
    pendingApprovalMigrations,
    activeMigrationCount: activeFiles.length,
    archivedMigrationCount: archivedFiles.length,
    baselinePresent,
    errors,
  };
}

async function main() {
  const result = await inspectMigrationBaseline();
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  if (!result.integrityValid || (process.argv.includes("--require-ready") && !result.readyToApply)) {
    process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
