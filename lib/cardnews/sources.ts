import { projectName, type YpProject } from "../youtube-process/project.ts";

export interface CardSourceChoice { id: string; from: "project" | "threads"; kind: "longform" | "short" | "threads"; title: string; updatedAt: string }
export const cardSourceProjectReady = (project: YpProject) => ["live", "anim", "short"].includes(project.yp.topic.type ?? "") && ["upload", "shorts", "done"].includes(project.yp.stage);
export function projectCardSources(projects: YpProject[]): CardSourceChoice[] {
  return projects.filter(cardSourceProjectReady).map(project => ({ id: project.id, from: "project", kind: project.yp.topic.type === "short" ? "short" : "longform", title: projectName(project), updatedAt: project.updatedAt }));
}
export function visibleThreadSource(row: { owner_id: string; status: string; metadata?: Record<string, unknown> | null }, ownerId: string) {
  return row.metadata?.channel === "threads" && ["ready", "scheduled", "published"].includes(row.status)
    && (row.owner_id === ownerId || row.metadata?.shared === "team") && Array.isArray(row.metadata?.posts) && row.metadata.posts.some(post => typeof post === "string" && post.trim());
}
