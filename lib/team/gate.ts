export function teamV1Enabled(env: NodeJS.ProcessEnv = process.env) {
  return env.TEAM_V1_ENABLED === "true";
}
