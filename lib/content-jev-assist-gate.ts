type Environment = Readonly<Record<string, string | undefined>>;

function matchesProjectUrl(value: string | undefined, reference: string) {
  return value === `https://${reference}.supabase.co` || value === `https://${reference}.supabase.co/`;
}

/** Independent, fail-closed gate for the opt-in content JEV adviser. */
export function canUseContentJevAssist(environment: Environment): boolean {
  if (environment.CONTENT_JEV_ASSIST_ENABLED !== "true" || environment.OS_ENVIRONMENT !== "production" && environment.OS_ENVIRONMENT !== "qa" || environment.NEXT_PUBLIC_DEMO_MODE !== "false" || !environment.TYPESAFE_API_KEY?.trim()) return false;
  const devRef = environment.SYSTEM_ONE_DEV_SUPABASE_REF ?? "";
  const productionRef = environment.SYSTEM_ONE_PRODUCTION_SUPABASE_REF ?? "";
  if (!/^[a-z]{20}$/.test(devRef) || !/^[a-z]{20}$/.test(productionRef) || devRef === productionRef) return false;
  const expectedRef = environment.OS_ENVIRONMENT === "production" ? productionRef : devRef;
  if (!matchesProjectUrl(environment.NEXT_PUBLIC_SUPABASE_URL, expectedRef)) return false;
  if (environment.SUPABASE_URL && !matchesProjectUrl(environment.SUPABASE_URL, expectedRef)) return false;
  if (!(environment.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? environment.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? environment.SUPABASE_ANON_KEY)?.trim()) return false;
  if (environment.VERCEL_ENV !== (environment.OS_ENVIRONMENT === "production" ? "production" : "preview")) return false;
  if (environment.VERCEL_TARGET_ENV && environment.VERCEL_TARGET_ENV !== environment.VERCEL_ENV) return false;
  const ref = environment.VERCEL_GIT_COMMIT_REF ?? "";
  return environment.OS_ENVIRONMENT === "production"
    ? !ref || /^(?:refs\/heads\/)?(?:main|master)$/.test(ref)
    : Boolean(ref) && !/^(?:refs\/heads\/)?(?:main|master)$/.test(ref);
}
