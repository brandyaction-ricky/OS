type Environment = Readonly<Record<string, string | undefined>>;

const externalCredentials = [
  "OPENAI_API_KEY", "ANTHROPIC_API_KEY", "CLAUDE_API_KEY",
  "TELEGRAM_BOT_TOKEN", "TELEGRAM_WEBHOOK_SECRET",
  "YOUTUBE_API_KEY", "YOUTUBE_CLIENT_ID", "YOUTUBE_CLIENT_SECRET", "YOUTUBE_TOKEN_ENCRYPTION_KEY",
  "META_ADS_ACCESS_TOKEN", "GOOGLE_ADS_DEVELOPER_TOKEN", "GOOGLE_ADS_CLIENT_ID",
  "GOOGLE_ADS_CLIENT_SECRET", "GOOGLE_ADS_REFRESH_TOKEN",
  "GITHUB_TOKEN", "GH_TOKEN", "OS_PUSH_SECRET", "OS_AGENT_TOKEN",
];
const deploymentMarkers = ["VERCEL", "VERCEL_ENV", "VERCEL_TARGET_ENV", "VERCEL_URL", "VERCEL_DEPLOYMENT_ID", "VERCEL_GIT_COMMIT_REF"];

function matchesProjectUrl(value: string | undefined, reference: string) {
  return value === `https://${reference}.supabase.co` || value === `https://${reference}.supabase.co/`;
}

// Verify both project identities before enabling. Configuration agreement is not
// independent proof of DEV isolation. This gate protects only this endpoint.
export function canUseSystemOnePreflight(environment: Environment): boolean {
  const configured = (key: string) => Boolean(environment[key]?.trim());
  if (environment.SYSTEM_ONE_PREFLIGHT_ENABLED !== "true" ||
    !["development", "qa"].includes(environment.OS_ENVIRONMENT ?? "") ||
    environment.NEXT_PUBLIC_DEMO_MODE !== "false") return false;
  const devRef = environment.SYSTEM_ONE_DEV_SUPABASE_REF ?? "";
  const productionRef = environment.SYSTEM_ONE_PRODUCTION_SUPABASE_REF ?? "";
  if (!/^[a-z]{20}$/.test(devRef) || !/^[a-z]{20}$/.test(productionRef) || devRef === productionRef) return false;
  if (!matchesProjectUrl(environment.NEXT_PUBLIC_SUPABASE_URL, devRef) ||
    (configured("SUPABASE_URL") && !matchesProjectUrl(environment.SUPABASE_URL, devRef))) return false;
  // Match lib/config's nullish precedence, including explicitly blank aliases.
  const publicKey = environment.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ??
    environment.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? environment.SUPABASE_ANON_KEY;
  if (!publicKey?.trim()) return false;
  if (deploymentMarkers.some(configured)) {
    if (environment.VERCEL_ENV !== "preview" ||
      (configured("VERCEL_TARGET_ENV") && environment.VERCEL_TARGET_ENV !== "preview") ||
      /^(?:refs\/heads\/)?(?:main|master)$/.test(environment.VERCEL_GIT_COMMIT_REF ?? "")) return false;
  } else if (environment.NODE_ENV !== "development") return false;
  return !externalCredentials.some(configured);
}
