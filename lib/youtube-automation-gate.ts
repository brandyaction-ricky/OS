type Environment = Readonly<Record<string, string | undefined>>;
const deploymentMarkers = ["VERCEL", "VERCEL_ENV", "VERCEL_TARGET_ENV", "VERCEL_URL", "VERCEL_DEPLOYMENT_ID", "VERCEL_GIT_COMMIT_REF"];

function matchesProjectUrl(value: string | undefined, reference: string) {
  return value === `https://${reference}.supabase.co` || value === `https://${reference}.supabase.co/`;
}

/** The pilot writes only to a verified DEV/QA project and never runs in Production. */
export function canUseYoutubeAutomationPilot(environment: Environment) {
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
