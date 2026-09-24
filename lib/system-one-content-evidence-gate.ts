type Environment = Readonly<Record<string, string | undefined>>;

const deploymentMarkers = ["VERCEL", "VERCEL_ENV", "VERCEL_TARGET_ENV", "VERCEL_URL", "VERCEL_DEPLOYMENT_ID", "VERCEL_GIT_COMMIT_REF"];

function matchesProjectUrl(value: string | undefined, reference: string) {
  return value === `https://${reference}.supabase.co` || value === `https://${reference}.supabase.co/`;
}

// Manual evidence and authenticated production-document summaries do not call
// an external AI provider. Keep their DEV/QA database-isolation gate independent
// of the stricter preflight/JEV experiments.
export function canUseSystemOneContentEvidence(environment: Environment): boolean {
  const configured = (key: string) => Boolean(environment[key]?.trim());
  if (environment.SYSTEM_ONE_PREFLIGHT_ENABLED !== "true" && environment.SYSTEM_ONE_JEV_SHADOW_ENABLED !== "true") return false;
  if (!["development", "qa"].includes(environment.OS_ENVIRONMENT ?? "") || environment.NEXT_PUBLIC_DEMO_MODE !== "false") return false;

  const devRef = environment.SYSTEM_ONE_DEV_SUPABASE_REF ?? "";
  const productionRef = environment.SYSTEM_ONE_PRODUCTION_SUPABASE_REF ?? "";
  if (!/^[a-z]{20}$/.test(devRef) || !/^[a-z]{20}$/.test(productionRef) || devRef === productionRef) return false;
  if (!matchesProjectUrl(environment.NEXT_PUBLIC_SUPABASE_URL, devRef) ||
    (configured("SUPABASE_URL") && !matchesProjectUrl(environment.SUPABASE_URL, devRef))) return false;

  const publicKey = environment.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ??
    environment.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? environment.SUPABASE_ANON_KEY;
  if (!publicKey?.trim()) return false;

  if (deploymentMarkers.some(configured)) {
    if (environment.VERCEL_ENV !== "preview" ||
      (configured("VERCEL_TARGET_ENV") && environment.VERCEL_TARGET_ENV !== "preview") ||
      /^(?:refs\/heads\/)?(?:main|master)$/.test(environment.VERCEL_GIT_COMMIT_REF ?? "")) return false;
  } else if (environment.NODE_ENV !== "development") return false;
  return true;
}
