/** 유튜브 공정 v1 (docs/handoff/youtube-process-20261015). Off = the OS stays exactly as before.
 * Server-only like TEAM_V1_ENABLED: the layout passes the result to the client shell, so no NEXT_PUBLIC_ value is needed. */
export function youtubeV1Enabled(env: NodeJS.ProcessEnv = process.env) {
  return env.YOUTUBE_V1_ENABLED === "true";
}
