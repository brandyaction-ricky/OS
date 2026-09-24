type LocalEnvironment = Readonly<Record<string, string | undefined>>;

const deploymentMarkers = ["VERCEL", "VERCEL_ENV", "VERCEL_URL", "VERCEL_DEPLOYMENT_ID"];
const connectionKeys = [
  "DATABASE_URL", "DIRECT_URL",
  "OPENAI_API_KEY", "ANTHROPIC_API_KEY", "CLAUDE_API_KEY",
  "OS_INITIAL_PASSWORD", "OS_AGENT_TOKEN", "OS_PUBLIC_URL", "CRON_SECRET",
  "TELEGRAM_BOT_TOKEN", "TELEGRAM_WEBHOOK_SECRET",
  "YOUTUBE_API_KEY", "YOUTUBE_CLIENT_ID", "YOUTUBE_CLIENT_SECRET", "YOUTUBE_TOKEN_ENCRYPTION_KEY",
  "META_ADS_ACCESS_TOKEN", "GOOGLE_ADS_DEVELOPER_TOKEN", "GOOGLE_ADS_CLIENT_ID",
  "GOOGLE_ADS_CLIENT_SECRET", "GOOGLE_ADS_REFRESH_TOKEN",
  "E2E_TEST_EMAIL", "E2E_TEST_PASSWORD",
];

// Call only from the server page. Demo mode alone is not a safe isolation gate:
// existing OS demo helpers can return true even when live credentials are set.
export function canUseSystemOneMock(environment: LocalEnvironment): boolean {
  if (environment.NODE_ENV !== "development"
    || environment.OS_ENVIRONMENT !== "local"
    || environment.NEXT_PUBLIC_DEMO_MODE !== "true") return false;

  const configured = (key: string) => Boolean(environment[key]?.trim());
  if (deploymentMarkers.some(configured) || connectionKeys.some(configured)) return false;

  // Include public, server-only, legacy and future Supabase credential aliases;
  // even one partial connection value closes the local-only sandbox.
  return !Object.keys(environment).some((key) => /^(?:NEXT_PUBLIC_)?SUPABASE_/.test(key) && configured(key));
}
