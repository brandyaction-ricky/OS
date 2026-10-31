import { NextResponse } from "next/server";
import { z } from "zod";
import { apiErrorResponse, parseJson } from "@/lib/http";
import { isDesignatedApprover } from "@/lib/server/document-proposals";
import { listYoutubeProjects, youtubeActor } from "@/lib/server/youtube-process";
import { adoptStaffJob, openStaffJobsFor } from "@/lib/server/youtube-ai-jobs";
import { overviewCounts, overviewRows } from "@/lib/youtube-process/overview";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const headers = { "cache-control": "private, no-store" };

/** 한눈에 보기: the videos this person can see, the open staff-AI jobs on them, and whether they confirm; ?counts=1 sends only the menu badges. */
export async function GET(request: Request) {
  try {
    const actor = await youtubeActor(request);
    const [projects, canConfirm] = await Promise.all([listYoutubeProjects(actor), isDesignatedApprover(actor.ownerId)]);
    const jobs = await openStaffJobsFor(new Set(projects.map(project => project.id)));
    if (new URL(request.url).searchParams.get("counts") === "1")
      return NextResponse.json({ counts: overviewCounts(overviewRows(projects, jobs, { id: actor.ownerId, canConfirm }).rows) }, { headers });
    return NextResponse.json({ projects, jobs, canConfirm }, { headers });
  } catch (error) { return apiErrorResponse(error); }
}

/** 채택: an AI result that arrived with a report is taken, on a video this person can see. */
export async function POST(request: Request) {
  try {
    const actor = await youtubeActor(request);
    const { jobId } = z.object({ jobId: z.string().uuid() }).strict().parse(await parseJson(request, 2_000));
    const projects = await listYoutubeProjects(actor);
    return NextResponse.json(await adoptStaffJob(actor, jobId, new Set(projects.map(project => project.id))), { headers });
  } catch (error) { return apiErrorResponse(error); }
}
