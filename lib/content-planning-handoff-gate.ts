type Environment = Readonly<Record<string, string | undefined>>;

function matchesProjectUrl(value: string | undefined, reference: string) {
  return value === `https://${reference}.supabase.co` || value === `https://${reference}.supabase.co/`;
}

// Limits the UI to the explicitly configured production deployment and database.
export function canUseContentPlanningHandoff(environment: Environment): boolean {
  if (environment.CONTENT_PLANNING_HANDOFF_ENABLED !== "true" || environment.OS_ENVIRONMENT !== "production" || environment.NEXT_PUBLIC_DEMO_MODE !== "false") return false;
  const devRef = environment.SYSTEM_ONE_DEV_SUPABASE_REF ?? "";
  const productionRef = environment.SYSTEM_ONE_PRODUCTION_SUPABASE_REF ?? "";
  if (!/^[a-z]{20}$/.test(devRef) || !/^[a-z]{20}$/.test(productionRef) || devRef === productionRef) return false;
  if (!matchesProjectUrl(environment.NEXT_PUBLIC_SUPABASE_URL, productionRef)) return false;
  if (environment.SUPABASE_URL && !matchesProjectUrl(environment.SUPABASE_URL, productionRef)) return false;
  if (!(environment.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? environment.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? environment.SUPABASE_ANON_KEY)?.trim()) return false;
  if (environment.VERCEL_ENV !== "production") return false;
  if (environment.VERCEL_TARGET_ENV && environment.VERCEL_TARGET_ENV !== "production") return false;
  const ref = environment.VERCEL_GIT_COMMIT_REF ?? "";
  return !ref || /^(?:refs\/heads\/)?(?:main|master)$/.test(ref);
}
