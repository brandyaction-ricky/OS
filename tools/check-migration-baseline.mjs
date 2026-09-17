import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const migrationsDirectory = path.join(root, "supabase", "migrations");
const manifestPath = path.join(root, "supabase", "migration-baseline.json");

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

export async function inspectMigrationBaseline() {
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  const files = (await readdir(migrationsDirectory))
    .filter((file) => file.endsWith(".sql"))
    .sort();
  const expected = [
    ...(manifest.baseline.file ? [manifest.baseline.file] : []),
    ...manifest.legacyMigrations.map((entry) => entry.file),
  ].sort();
  const errors = [];
  const versions = files.map((file) => file.match(/^(\d{12})_[a-z0-9_]+\.sql$/)?.[1]);

  if (new Set(files).size !== files.length) {
    errors.push("duplicate migration filenames");
  }
  if (versions.some((version) => !version)) {
    errors.push("migration filenames must use a 12-digit version and snake-case name");
  }
  if (new Set(versions).size !== versions.length) {
    errors.push("migration versions must be unique");
  }
  if (files.join("\n") !== expected.join("\n")) {
    errors.push("migration file set differs from the frozen legacy manifest");
  }

  for (const entry of manifest.legacyMigrations) {
    let sql;
    try {
      sql = await readFile(path.join(migrationsDirectory, entry.file), "utf8");
    } catch {
      errors.push(`missing migration: ${entry.file}`);
      continue;
    }
    if (sha256(sql) !== entry.sha256) {
      errors.push(`migration checksum changed: ${entry.file}`);
    }
  }

  const firstMigration = files[0]
    ? await readFile(path.join(migrationsDirectory, files[0]), "utf8")
    : "";
  if (!firstMigration.includes("OS_CORE_SCHEMA_REQUIRED")) {
    errors.push("the first legacy migration no longer guards its core prerequisites");
  }

  const baselineFile = manifest.baseline.file;
  let baselinePresent = false;
  if (baselineFile) {
    baselinePresent = files.includes(baselineFile);
    if (!baselinePresent) errors.push(`declared baseline is missing: ${baselineFile}`);
    if (baselineFile >= manifest.baseline.mustSortBefore) {
      errors.push("the baseline migration must sort before the legacy chain");
    }
    if (!manifest.baseline.sha256) {
      errors.push("the declared baseline must have a frozen checksum");
    } else if (baselinePresent) {
      const baselineSql = await readFile(path.join(migrationsDirectory, baselineFile), "utf8");
      if (sha256(baselineSql) !== manifest.baseline.sha256) {
        errors.push(`baseline checksum changed: ${baselineFile}`);
      }
    }
  }

  return {
    status: manifest.status,
    decision: manifest.decision,
    integrityValid: errors.length === 0,
    readyToApply: manifest.status === "ready" && manifest.decision === "apply" && baselinePresent && errors.length === 0,
    migrationCount: files.length,
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
