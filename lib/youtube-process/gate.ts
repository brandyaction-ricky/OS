/** 유튜브 공정 v1 (docs/handoff/youtube-process-20261015). Off = the OS stays exactly as before.
 * Server-only like TEAM_V1_ENABLED: the layout passes the result to the client shell, so no NEXT_PUBLIC_ value is needed. */
export function youtubeV1Enabled(env: NodeJS.ProcessEnv = process.env) {
  return env.YOUTUBE_V1_ENABLED === "true";
}

/**
 * Who sees v1 while it is rolled out (owner decision 2026-10-21: one environment, production, the 대표 first): YOUTUBE_V1_USERS is a
 * comma-separated list of user ids; empty means everyone. The ids stay on the server; the shell only learns off · all · some.
 */
export function youtubeV1Users(env: NodeJS.ProcessEnv = process.env) {
  return (env.YOUTUBE_V1_USERS ?? "").split(",").map(id => id.trim()).filter(Boolean);
}
export type YoutubeV1Mode = "off" | "all" | "some";
export function youtubeV1Mode(env: NodeJS.ProcessEnv = process.env): YoutubeV1Mode {
  return !youtubeV1Enabled(env) ? "off" : youtubeV1Users(env).length ? "some" : "all";
}
export function youtubeV1AllowedFor(ownerId: string, env: NodeJS.ProcessEnv = process.env) {
  const users = youtubeV1Users(env);
  return youtubeV1Enabled(env) && (!users.length || users.includes(ownerId));
}
