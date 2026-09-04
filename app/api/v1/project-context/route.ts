import { NextResponse } from "next/server";
import { z, ZodError } from "zod";
import { ApiError, apiErrorResponse } from "@/lib/http";
import type { OsRecord, RecordType } from "@/lib/record-types";
import { authenticateRequest } from "@/lib/server/auth";
import { assertOrganization } from "@/lib/server/organization";
import { createServiceSupabase } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const querySchema = z.object({
  organizationId: z.string().uuid(),
  projectId: z.string().uuid(),
});

const RELATED_TYPES = ["task", "ai_job", "decision", "development_log", "deployment"] as const;

function byType(records: OsRecord[], type: RecordType) {
  return records.filter((record) => record.record_type === type);
}

export async function GET(request: Request) {
  try {
    const actor = await authenticateRequest(request, { allowAgent: true, requiredAgentScope: "records.read" });
    const url = new URL(request.url);
    const input = querySchema.parse({
      organizationId: url.searchParams.get("organizationId"),
      projectId: url.searchParams.get("projectId"),
    });
    await assertOrganization(actor, input.organizationId);

    const service = createServiceSupabase();
    const [{ data: project, error: projectError }, { data: related, error: relatedError }] = await Promise.all([
      service.from("os_records").select("*").eq("id", input.projectId).eq("record_type", "project").is("archived_at", null).maybeSingle(),
      service.from("os_records").select("*").eq("parent_id", input.projectId).in("record_type", [...RELATED_TYPES]).is("archived_at", null).order("updated_at", { ascending: false }),
    ]);

    if (projectError) throw new ApiError(400, "PROJECT_CONTEXT_FAILED", "프로젝트 맥락을 불러오지 못했습니다.", projectError.message);
    if (!project) throw new ApiError(404, "PROJECT_NOT_FOUND", "프로젝트를 찾지 못했습니다.");
    if (relatedError) throw new ApiError(400, "PROJECT_CONTEXT_FAILED", "프로젝트 기록을 불러오지 못했습니다.", relatedError.message);

    const records = (related ?? []) as OsRecord[];
    return NextResponse.json({
      project,
      tasks: byType(records, "task"),
      aiJobs: byType(records, "ai_job"),
      decisions: byType(records, "decision"),
      developmentLogs: byType(records, "development_log"),
      deployments: byType(records, "deployment"),
      summary: {
        openTasks: byType(records, "task").filter((record) => record.status !== "done").length,
        openAiJobs: byType(records, "ai_job").filter((record) => record.status !== "done").length,
        blocked: records.filter((record) => record.status === "blocked").length,
        latestActivityAt: records[0]?.updated_at ?? project.updated_at,
      },
    }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    if (error instanceof ZodError) return apiErrorResponse(new ApiError(400, "INVALID_PROJECT_CONTEXT", "조직과 프로젝트 ID를 확인해 주세요.", error.flatten()));
    return apiErrorResponse(error);
  }
}
