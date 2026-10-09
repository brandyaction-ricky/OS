/** Server-only decision passed to client components as a prop. */
export function hrWorkspaceEnabled(
  env: Record<string, string | undefined> = process.env,
) {
  return env.HR_WORKSPACE_ENABLED === "true";
}
