import { readFile } from "node:fs/promises";

const modes = new Set(["local", "development", "qa", "production"]);
const args = process.argv.slice(2);
const option = (name) => {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
};

const mode = option("--mode") ?? process.env.OS_ENVIRONMENT ?? "local";
const file = option("--file");

if (!modes.has(mode)) {
  console.error(`[env-check] unsupported mode: ${mode}`);
  process.exit(1);
}

const fileValues = new Map();
if (file) {
  let source;
  try {
    source = await readFile(file, "utf8");
  } catch (error) {
    console.error(`[env-check] cannot read ${file}: ${error?.code ?? "unknown error"}`);
    process.exit(1);
  }

  for (const rawLine of source.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const separator = line.indexOf("=");
    if (separator <= 0) continue;
    const key = line.slice(0, separator).trim();
    const value = line.slice(separator + 1).trim().replace(/^(['"])(.*)\1$/, "$2");
    fileValues.set(key, value);
  }
}

const valueFor = (key) => process.env[key]?.trim() || fileValues.get(key)?.trim() || "";
const coreKeys = [
  "NEXT_PUBLIC_SUPABASE_URL",
  "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
  "SUPABASE_SERVICE_ROLE_KEY",
  "OS_INITIAL_PASSWORD",
  "OS_PUBLIC_URL",
  "CRON_SECRET",
];
const integrationGroups = {
  ai: ["OPENAI_API_KEY", "ANTHROPIC_API_KEY"],
  typesafe: ["TYPESAFE_API_KEY"],
  telegram: ["TELEGRAM_BOT_TOKEN", "TELEGRAM_WEBHOOK_SECRET"],
  youtube: ["YOUTUBE_API_KEY", "YOUTUBE_CLIENT_ID", "YOUTUBE_CLIENT_SECRET"],
  advertising: ["META_ADS_ACCESS_TOKEN", "GOOGLE_ADS_DEVELOPER_TOKEN"],
};

const configuredCore = coreKeys.filter((key) => Boolean(valueFor(key)));
const missingCore = coreKeys.filter((key) => !valueFor(key));
const demoMode = valueFor("NEXT_PUBLIC_DEMO_MODE") === "true";
const declaredMode = valueFor("OS_ENVIRONMENT");

if (declaredMode && declaredMode !== mode) {
  console.error(`[env-check] OS_ENVIRONMENT must be ${mode} for this check`);
  process.exit(1);
}

if (mode === "local" && configuredCore.length === 0 && demoMode) {
  console.log("[env-check] local demo environment is ready");
} else if (missingCore.length > 0) {
  console.error(`[env-check] ${mode} is missing required keys: ${missingCore.join(", ")}`);
  process.exit(1);
} else if (mode !== "local" && demoMode) {
  console.error(`[env-check] NEXT_PUBLIC_DEMO_MODE must not be true in ${mode}`);
  process.exit(1);
} else {
  console.log(`[env-check] ${mode} core environment is ready`);
}

for (const [group, keys] of Object.entries(integrationGroups)) {
  const configured = keys.filter((key) => Boolean(valueFor(key))).length;
  const status = configured === 0 ? "not configured" : configured === keys.length ? "configured" : "partial";
  console.log(`[env-check] ${group}: ${status}`);
}
