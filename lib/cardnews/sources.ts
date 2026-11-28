import { projectName, type YpProject } from "../youtube-process/project.ts";

export interface CardSourceChoice { id: string; from: "project" | "threads"; kind: "longform" | "short" | "threads"; title: string; updatedAt: string }
export const isCardTestTitle = (title: string) => /(?:\[|【)(?:QA|테스트|시험|시안)[^\]】]*[\]】]|^(?:QA|테스트|시험)(?:[\s_:]|$)|\(복사본\)|(?:\[|\s)복사본(?:\]|\s*\d+)?$/iu.test(title.trim());
export const isCardTestProject = (project: YpProject) => Boolean(project.yp.isTest || isCardTestTitle(project.title));
export function initialCardRecommendation(kind: string): { formats: import("./formats").CardFormatId[]; why: string } {
  if (kind === "threads" || kind === "short") return { formats: ["quote", "myth"], why: "짧은 글의 핵심을 한 문장씩 보여 주거나, 통념과 실제를 대비해 보세요." };
  if (kind === "longform") return { formats: ["list", "steps"], why: "긴 원고의 핵심 항목을 추리거나 독자가 따라 할 순서로 나누기 좋아요." };
  return { formats: ["list", "compare"], why: "새 주제의 핵심을 목록으로 정리하거나 같은 기준으로 두 선택을 비교해 보세요." };
}
export const cardSourceProjectReady = (project: YpProject) => ["live", "anim", "short"].includes(project.yp.topic.type ?? "") && ["upload", "shorts", "done"].includes(project.yp.stage);
export function projectCardSources(projects: YpProject[]): CardSourceChoice[] {
  return projects.filter(project => cardSourceProjectReady(project) && !isCardTestProject(project)).map(project => ({ id: project.id, from: "project", kind: project.yp.topic.type === "short" ? "short" : "longform", title: projectName(project), updatedAt: project.updatedAt }));
}
export function visibleThreadSource(row: { owner_id: string; status: string; metadata?: Record<string, unknown> | null }, ownerId: string) {
  return row.metadata?.channel === "threads" && ["ready", "scheduled", "published"].includes(row.status)
    && (row.owner_id === ownerId || row.metadata?.shared === "team") && Array.isArray(row.metadata?.posts) && row.metadata.posts.some(post => typeof post === "string" && post.trim());
}
