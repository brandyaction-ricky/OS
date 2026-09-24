type Environment = Readonly<Record<string, string | undefined>>;

function matchesProjectUrl(value: string | undefined, reference: string) {
  return value === `https://${reference}.supabase.co` || value === `https://${reference}.supabase.co/`;
}

/** QA Preview only. This gate is independent from packaging JEV and all DEV feature gates. */
export function canUseContentTopicJevAssist(environment: Environment): boolean {
  if (environment.CONTENT_TOPIC_JEV_ASSIST_ENABLED !== "true"
    || environment.OS_ENVIRONMENT !== "qa"
    || environment.NEXT_PUBLIC_DEMO_MODE !== "false"
    || !environment.TYPESAFE_API_KEY?.trim()) return false;
  const devRef = environment.CONTENT_TOPIC_JEV_DEV_SUPABASE_REF ?? "";
  if (!/^[a-z]{20}$/.test(devRef) || !matchesProjectUrl(environment.NEXT_PUBLIC_SUPABASE_URL, devRef)) return false;
  if (environment.SUPABASE_URL && !matchesProjectUrl(environment.SUPABASE_URL, devRef)) return false;
  if (!(environment.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? environment.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? environment.SUPABASE_ANON_KEY)?.trim()) return false;
  if (environment.VERCEL_ENV !== "preview" || environment.VERCEL_TARGET_ENV && environment.VERCEL_TARGET_ENV !== "preview") return false;
  const ref = environment.VERCEL_GIT_COMMIT_REF ?? "";
  return Boolean(ref) && !/^(?:refs\/heads\/)?(?:main|master)$/.test(ref);
}
