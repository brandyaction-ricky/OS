// Stable OS routes, not the standalone prototype's hash-router addresses.
export const FULLSCREEN_ROUTES = {
  "/home": "home",
  "/content/topics": "topics",
  "/content/scripts": "scripts",
  "/content/packages": "packages",
  "/content/shorts": "shorts",
  "/content/publishing": "publish",
  "/content/review": "publish",
  "/content/automation": "derive",
  "/content/calendar": "calendar",
  "/content/youtube": "youtube",
  "/content/performance": "performance",
  "/content/comments": "comments",
  "/knowledge": "documents",
  "/knowledge/graph": "links",
  "/knowledge/search": "search",
  "/knowledge/review": "review",
  "/organization/meetings": "meetings",
  "/home/decisions": "decisions",
  "/organization/tasks": "tasks",
  "/organization/schedule": "schedule",
  "/organization/leave": "leave",
  "/organization/members": "members",
  "/knowledge/development": "requests",
  "/organization/agents": "ai",
  "/settings/connections": "settings",
  "/settings/monitoring": "monitoring",
  "/settings/channels": "channels",
  "/settings/access": "access",
  "/settings/audit": "audit",
  "/settings/company": "company",
  "/settings/account": "account",
} as const;

export function fullscreenScreen(path: string, tab?: string | null) {
  if (path === "/knowledge" && tab === "canon") return "canon";
  if (path === "/knowledge/development" && (tab === "updates" || tab === "history")) return "updates";
  if (path === "/organization/schedule" && tab === "leave") return "leave";
  return FULLSCREEN_ROUTES[path as keyof typeof FULLSCREEN_ROUTES];
}
