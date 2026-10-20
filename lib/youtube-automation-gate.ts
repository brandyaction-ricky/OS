type Environment = Readonly<Record<string, string | undefined>>;
const deploymentMarkers = ["VERCEL", "VERCEL_ENV", "VERCEL_TARGET_ENV", "VERCEL_URL", "VERCEL_DEPLOYMENT_ID", "VERCEL_GIT_COMMIT_REF"];

function matchesProjectUrl(value: string | undefined, reference: string) {
  return value === `https://${reference}.supabase.co` || value === `https://${reference}.supabase.co/`;
}

/**
 * Production opens only on its own switch (owner decision 2026-10-20): the Production deployment, the production project
 * (checked against its reference) and YOUTUBE_AUTOMATION_PRODUCTION_ENABLED. The DEV pilot switch never opens it.
 */
function productionOpen(environment: Environment) {
  const productionRef = environment.YOUTUBE_AUTOMATION_PRODUCTION_SUPABASE_REF ?? "";
  return environment.YOUTUBE_AUTOMATION_PRODUCTION_ENABLED === "true" && environment.OS_ENVIRONMENT === "production"
    && environment.NEXT_PUBLIC_DEMO_MODE === "false" && environment.VERCEL_ENV === "production"
    && /^[a-z]{20}$/.test(productionRef) && matchesProjectUrl(environment.NEXT_PUBLIC_SUPABASE_URL, productionRef);
}

/** The automation writes to a verified DEV/QA project, or to Production when its own switch is on. */
export function canUseYoutubeAutomationPilot(environment: Environment) {
  if (productionOpen(environment)) return true;
  if (environment.YOUTUBE_AUTOMATION_PILOT_ENABLED !== "true" ||
    !["development", "qa"].includes(environment.OS_ENVIRONMENT ?? "") ||
    environment.NEXT_PUBLIC_DEMO_MODE !== "false") return false;
  const devRef = environment.YOUTUBE_AUTOMATION_DEV_SUPABASE_REF ?? "";
  const productionRef = environment.YOUTUBE_AUTOMATION_PRODUCTION_SUPABASE_REF ?? "";
  if (!/^[a-z]{20}$/.test(devRef) || !/^[a-z]{20}$/.test(productionRef) || devRef === productionRef) return false;
  if (!matchesProjectUrl(environment.NEXT_PUBLIC_SUPABASE_URL, devRef) ||
    (environment.SUPABASE_URL?.trim() && !matchesProjectUrl(environment.SUPABASE_URL, devRef))) return false;
  if (deploymentMarkers.some((key) => Boolean(environment[key]?.trim()))) {
    if (environment.VERCEL_ENV !== "preview" ||
      (environment.VERCEL_TARGET_ENV?.trim() && environment.VERCEL_TARGET_ENV !== "preview") ||
      /^(?:refs\/heads\/)?(?:main|master)$/.test(environment.VERCEL_GIT_COMMIT_REF ?? "")) return false;
  } else if (environment.NODE_ENV !== "development") return false;
  return true;
}

/**
 * ② 원고 and ⑦ 발행키트 by the staff member's own AI write only content records (no storage, voice or render), so they open in
 * Production on their own switch. Every other automation route stays behind the gate above.
 */
export function canUseYoutubeStaffScript(environment: Environment) {
  return environment.YOUTUBE_STAFF_SCRIPT_ENABLED === "true" || canUseYoutubeAutomationPilot(environment);
}
