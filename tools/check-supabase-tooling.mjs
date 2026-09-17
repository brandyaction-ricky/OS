import { spawnSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const expectedCliVersion = "2.117.0";

function inspectRuntime(command, executable = command) {
  const result = spawnSync(executable, ["version"], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });

  return {
    command,
    executable,
    installed: !result.error || result.error.code !== "ENOENT",
    operational: result.status === 0,
  };
}

export async function inspectSupabaseTooling() {
  const [packageJson, config] = await Promise.all([
    readFile(path.join(root, "package.json"), "utf8").then(JSON.parse),
    readFile(path.join(root, "supabase", "config.toml"), "utf8"),
  ]);
  const errors = [];
  const cliVersion = packageJson.devDependencies?.supabase;

  if (cliVersion !== expectedCliVersion) {
    errors.push(`Supabase CLI must be pinned to ${expectedCliVersion}`);
  }
  if (!/^project_id = "brandyaction-os"$/m.test(config)) {
    errors.push("local Supabase project_id is missing or unexpected");
  }
  if (!/^major_version = 17$/m.test(config)) {
    errors.push("local PostgreSQL major version must match Production major version 17");
  }
  if (!/^auto_expose_new_tables = false$/m.test(config)) {
    errors.push("local Data API auto exposure must be disabled");
  }
  if (!/\[db\.seed\]\n(?:#.*\n)*enabled = false/m.test(config)) {
    errors.push("local seed execution must remain disabled until a reviewed seed exists");
  }

  const runtimes = [
    inspectRuntime("docker"),
    ...(process.platform === "darwin"
      ? [inspectRuntime("docker-desktop", "/Applications/Docker.app/Contents/Resources/bin/docker")]
      : []),
    inspectRuntime("podman"),
  ];
  const containerRuntime = runtimes.find((runtime) => runtime.operational) ?? null;

  return {
    cliVersion,
    expectedCliVersion,
    configValid: errors.length === 0,
    containerRuntimes: runtimes,
    dumpReady: errors.length === 0 && containerRuntime !== null,
    selectedRuntime: containerRuntime?.executable ?? null,
    errors,
  };
}

async function main() {
  const result = await inspectSupabaseTooling();
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  if (!result.configValid || (process.argv.includes("--require-dump") && !result.dumpReady)) {
    process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
