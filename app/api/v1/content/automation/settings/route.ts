import { NextResponse } from "next/server";
import { z, ZodError } from "zod";
import { ApiError, apiErrorResponse, parseJson } from "@/lib/http";
import { authenticateRequest } from "@/lib/server/auth";
import { createServiceSupabase } from "@/lib/supabase/server";
import {
  CONTENT_AUTOMATION_SETTINGS_ID,
} from "@/lib/content-automation-settings";
import {
  readContentAutomationSettings,
  readContentAutomationSettingsRecord,
  settingsFromMetadata,
} from "@/lib/server/content-automation-settings";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const settingsSchema = z.object({
  generationMode: z.enum(["queue", "api"]),
  promptPrefix: z.string().trim().max(1_000),
  retryLimit: z.number().int().min(0).max(5),
  publishLeadMinutes: z.number().int().min(0).max(10_080),
  autoCollect: z.boolean(),
  enabledChannels: z.array(z.enum(["youtube", "instagram", "threads"])).max(3),
  shorts: z.object({
    voicePreset: z.string().trim().min(1).max(80),
    bgmPreset: z.string().trim().min(1).max(80),
    captionPreset: z.string().trim().min(1).max(80),
  }).strict(),
}).strict();

const updateSchema = z.object({
  expectedVersion: z.number().int().min(0),
  settings: settingsSchema,
}).strict();

export async function GET(request: Request) {
  try {
    const actor = await authenticateRequest(request);
    const { record, settings } = await readContentAutomationSettings();
    return NextResponse.json({
      settings,
      version: Number(record?.version ?? 0),
      configured: Boolean(record),
      canManage: actor.type === "user" && actor.role === "admin",
      updatedAt: record?.updated_at ?? null,
    }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) { return apiErrorResponse(error); }
}

export async function PATCH(request: Request) {
  try {
    const actor = await authenticateRequest(request);
    if (actor.type !== "user" || actor.role !== "admin") throw new ApiError(403, "ADMIN_REQUIRED", "관리자만 자동화 설정을 저장할 수 있습니다.");
    const input = updateSchema.parse(await parseJson(request, 16_000));
    const current = await readContentAutomationSettingsRecord();
    if (Number(current?.version ?? 0) !== input.expectedVersion) throw new ApiError(409, "CONTENT_AUTOMATION_SETTINGS_CHANGED", "다른 관리자가 설정을 변경했습니다. 새로 불러와 주세요.");
    const now = new Date().toISOString();
    const service = createServiceSupabase();
    const query = current
      ? service.from("os_records").update({
          metadata: { kind: "content_automation_settings", schemaVersion: 1, settings: input.settings, updatedAt: now },
          updated_by: actor.id,
        }).eq("id", CONTENT_AUTOMATION_SETTINGS_ID).eq("version", input.expectedVersion)
      : service.from("os_records").insert({
          id: CONTENT_AUTOMATION_SETTINGS_ID,
          record_type: "company_setting",
          title: "콘텐츠 자동화 설정",
          description: "콘텐츠 생성·검토·수집의 회사 기본값",
          status: "active",
          priority: "normal",
          stage: "자동화 설정",
          brand: "브랜디액션",
          team: "콘텐츠",
          tags: ["콘텐츠", "자동화", "회사설정"],
          metadata: { kind: "content_automation_settings", schemaVersion: 1, settings: input.settings, updatedAt: now },
          owner_id: actor.id,
          created_by: actor.id,
          updated_by: actor.id,
        });
    const { data, error } = await query.select("version,metadata,updated_at").maybeSingle();
    if (error || !data) throw new ApiError(current ? 409 : 503, current ? "CONTENT_AUTOMATION_SETTINGS_CHANGED" : "CONTENT_AUTOMATION_SETTINGS_SAVE_FAILED", current ? "다른 관리자가 설정을 변경했습니다. 새로 불러와 주세요." : "자동화 설정을 저장하지 못했습니다.");
    return NextResponse.json({ settings: settingsFromMetadata(data.metadata), version: data.version, configured: true, canManage: true, updatedAt: data.updated_at });
  } catch (error) {
    if (error instanceof ZodError) return apiErrorResponse(new ApiError(400, "CONTENT_AUTOMATION_SETTINGS_INVALID", "자동화 설정 값을 확인해 주세요.", error.flatten()));
    return apiErrorResponse(error);
  }
}
