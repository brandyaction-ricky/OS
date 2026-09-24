type Environment = Readonly<Record<string, string | undefined>>;

const deploymentMarkers = ["VERCEL", "VERCEL_ENV", "VERCEL_TARGET_ENV", "VERCEL_URL", "VERCEL_DEPLOYMENT_ID", "VERCEL_GIT_COMMIT_REF"];

function matchesProjectUrl(value: string | undefined, reference: string) {
  return value === `https://${reference}.supabase.co` || value === `https://${reference}.supabase.co/`;
}

// Controls presentation of the user-authored planning/handoff form only.
// API authorization remains the signed-in user's existing OS/RLS boundary.
export function canUseContentPlanningHandoff(environment: Environment): boolean {
  const configured = (key: string) => Boolean(environment[key]?.trim());
  if (environment.CONTENT_PLANNING_HANDOFF_ENABLED !== "true" || environment.NEXT_PUBLIC_DEMO_MODE !== "false") return false;

  const osEnvironment = environment.OS_ENVIRONMENT ?? "";
  if (!["development", "qa", "production"].includes(osEnvironment)) return false;

  const devRef = environment.SYSTEM_ONE_DEV_SUPABASE_REF ?? "";
  const productionRef = environment.SYSTEM_ONE_PRODUCTION_SUPABASE_REF ?? "";
  if (!/^[a-z]{20}$/.test(devRef) || !/^[a-z]{20}$/.test(productionRef) || devRef === productionRef) return false;

  const expectedRef = osEnvironment === "production" ? productionRef : devRef;
  if (!matchesProjectUrl(environment.NEXT_PUBLIC_SUPABASE_URL, expectedRef) ||
    (configured("SUPABASE_URL") && !matchesProjectUrl(environment.SUPABASE_URL, expectedRef))) return false;

  const publicKey = environment.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ??
    environment.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? environment.SUPABASE_ANON_KEY;
  if (!publicKey?.trim()) return false;

  if (deploymentMarkers.some(configured)) {
    const expectedVercelEnv = osEnvironment === "production" ? "production" : "preview";
    if (environment.VERCEL_ENV !== expectedVercelEnv ||
      (configured("VERCEL_TARGET_ENV") && environment.VERCEL_TARGET_ENV !== expectedVercelEnv)) return false;
    const ref = environment.VERCEL_GIT_COMMIT_REF ?? "";
    if (osEnvironment === "production" && ref && !/^(?:refs\/heads\/)?(?:main|master)$/.test(ref)) return false;
    if (osEnvironment !== "production" && /^(?:refs\/heads\/)?(?:main|master)$/.test(ref)) return false;
  } else if (osEnvironment !== "development" || environment.NODE_ENV !== "development") return false;

  return true;
}
