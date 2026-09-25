type Environment = Readonly<Record<string, string | undefined>>;

function matchesProjectUrl(value: string | undefined, reference: string) {
  return value === `https://${reference}.supabase.co` || value === `https://${reference}.supabase.co/`;
}

/** Independent fail-closed QA and Production gate for the topic-planning JEV adviser. */
export function canUseContentTopicJevAssist(environment: Environment): boolean {
  const isProduction = environment.OS_ENVIRONMENT === "production";
  if (!isProduction && environment.OS_ENVIRONMENT !== "qa") return false;
  const enabled = isProduction
    ? environment.CONTENT_TOPIC_JEV_PRODUCTION_ASSIST_ENABLED
    : environment.CONTENT_TOPIC_JEV_ASSIST_ENABLED;
  if (enabled !== "true" || environment.NEXT_PUBLIC_DEMO_MODE !== "false" || !environment.TYPESAFE_API_KEY?.trim()) return false;
  const devRef = isProduction
    ? environment.SYSTEM_ONE_DEV_SUPABASE_REF ?? ""
    : environment.CONTENT_TOPIC_JEV_DEV_SUPABASE_REF ?? "";
  const productionRef = environment.SYSTEM_ONE_PRODUCTION_SUPABASE_REF ?? "";
  if (!/^[a-z]{20}$/.test(devRef) || !/^[a-z]{20}$/.test(productionRef) || devRef === productionRef) return false;
  const expectedRef = isProduction ? productionRef : devRef;
  if (!matchesProjectUrl(environment.NEXT_PUBLIC_SUPABASE_URL, expectedRef)) return false;
  if (environment.SUPABASE_URL && !matchesProjectUrl(environment.SUPABASE_URL, expectedRef)) return false;
  if (!(environment.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? environment.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? environment.SUPABASE_ANON_KEY)?.trim()) return false;
  const expectedVercelEnvironment = isProduction ? "production" : "preview";
  if (environment.VERCEL_ENV !== expectedVercelEnvironment
    || environment.VERCEL_TARGET_ENV && environment.VERCEL_TARGET_ENV !== expectedVercelEnvironment) return false;
  const ref = environment.VERCEL_GIT_COMMIT_REF ?? "";
  return isProduction
    ? !ref || /^(?:refs\/heads\/)?(?:main|master)$/.test(ref)
    : Boolean(ref) && !/^(?:refs\/heads\/)?(?:main|master)$/.test(ref);
}
