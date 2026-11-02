import type { NavStage } from "./navigation";

type SidebarWorkspace = "priority" | "content" | "knowledge" | "operations" | "system";
const WORKSPACES: { id: SidebarWorkspace; label: string }[] = [
  { id: "priority", label: "" },
  { id: "content", label: "콘텐츠 제작" },
  { id: "knowledge", label: "지식 · 협업" },
  { id: "operations", label: "회사 운영" },
  { id: "system", label: "시스템 관리" },
];

function workspaceFor(id: string): SidebarWorkspace {
  if (id === "ceo" || id === "home") return "priority";
  if (id === "content" || id === "automation" || id === "threads" || id.startsWith("yt-")) return "content";
  if (id === "knowledge" || id === "team") return "knowledge";
  if (id === "hr" || id === "finance") return "operations";
  return "system";
}

/** Presentation only: callers pass the already authorized stages. Keep every stage and page object. */
export function groupSidebarStages<T extends Pick<NavStage, "id">>(stages: T[]) {
  return WORKSPACES.map(workspace => ({ ...workspace, stages: stages.filter(stage => workspaceFor(stage.id) === workspace.id) }))
    .filter(workspace => workspace.stages.length > 0);
}

/** Migrate the former many-open preference without losing a deliberately closed home menu. */
export function restoreSidebarGroups(ids: string[], activeId: string, stored: unknown): Record<string, boolean> {
  const values = stored && typeof stored === "object" && !Array.isArray(stored) ? stored as Record<string, unknown> : {};
  // Home is always visible and has no disclosure control.
  const known = [...new Set(ids)].filter(id => id !== "home");
  const hasPreference = known.some(id => typeof values[id] === "boolean");
  const openId = known.includes(activeId) ? activeId : known.find(id => values[id] === true)
    ?? (!hasPreference ? known.find(id => id === "content") : undefined);
  return Object.fromEntries(known.map(id => [id, id === openId]));
}

export function toggleSidebarGroup(current: Record<string, boolean>, id: string): Record<string, boolean> {
  return Object.fromEntries([...new Set([...Object.keys(current), id])].map(key => [key, key === id && !current[id]]));
}
