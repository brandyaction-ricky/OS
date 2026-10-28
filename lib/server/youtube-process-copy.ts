import { COPIED_STAGES, copiedMake, copiedMeta } from "@/lib/youtube-process/copy";
import { projectName, type YpProject } from "@/lib/youtube-process/project";
import type { YpMake } from "@/lib/youtube-process/stages";
import type { RequestActor } from "./auth";
import { getYoutubeProject, insertProject } from "./youtube-process";
import { readStages, writeStage } from "./youtube-process-stages";

/** 영상 복제 (owner decision 2026-10-28): a new project from this one, with the rules in lib/youtube-process/copy.ts. */
export async function copyYoutubeProject(actor: RequestActor, id: string): Promise<YpProject> {
  const project = await getYoutubeProject(actor, id);
  const stages = await readStages(actor.supabase, project);
  const copy = await insertProject(actor, `${projectName(project)} (복사본)`.slice(0, 200), project.assigneeId,
    { workflow: "youtube_v1", yp: copiedMeta(project.yp, new Date().toISOString()) });
  for (const kind of COPIED_STAGES) {
    const stage = stages[kind];
    if (stage.id) await writeStage(actor.supabase, actor.id, actor.team, copy, kind, { id: null, version: 0 }, kind === "make" ? copiedMake(stage.data as YpMake) : stage.data);
  }
  return copy;
}
