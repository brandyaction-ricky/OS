/** Pilot activation is explicit and never available in Production. */
export function canUseYoutubeAutomationPilot(environment: NodeJS.ProcessEnv) {
  if (environment.YOUTUBE_AUTOMATION_PILOT_ENABLED !== "true") return false;
  if (environment.VERCEL_ENV === "production" || environment.VERCEL_TARGET_ENV === "production") return false;
  if (!environment.VERCEL_ENV && environment.NODE_ENV === "production") return false;
  return true;
}
