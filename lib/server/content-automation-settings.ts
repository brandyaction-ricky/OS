import { ApiError } from "@/lib/http";
import {
  CONTENT_AUTOMATION_SETTINGS_ID,
  DEFAULT_CONTENT_AUTOMATION_SETTINGS,
  type ContentAutomationSettings,
} from "@/lib/content-automation-settings";
import { createServiceSupabase } from "@/lib/supabase/server";

export type ContentAutomationSettingsRecord = {
  id: string;
  version: number;
  metadata: Record<string, unknown>;
  updated_at: string;
};

export function settingsFromMetadata(metadata: unknown): ContentAutomationSettings {
  if (!metadata || typeof metadata !== "object") return DEFAULT_CONTENT_AUTOMATION_SETTINGS;
  const settings = (metadata as Record<string, unknown>).settings;
  if (!settings || typeof settings !== "object") return DEFAULT_CONTENT_AUTOMATION_SETTINGS;
  const candidate = settings as Partial<ContentAutomationSettings>;
  const channels = Array.isArray(candidate.enabledChannels)
    ? candidate.enabledChannels.filter((channel): channel is "youtube" | "instagram" | "threads" =>
        ["youtube", "instagram", "threads"].includes(String(channel)),
      )
    : DEFAULT_CONTENT_AUTOMATION_SETTINGS.enabledChannels;
  const shorts = candidate.shorts && typeof candidate.shorts === "object" ? candidate.shorts : DEFAULT_CONTENT_AUTOMATION_SETTINGS.shorts;
  if (
    !["queue", "api"].includes(String(candidate.generationMode)) ||
    typeof candidate.promptPrefix !== "string" ||
    !Number.isInteger(candidate.retryLimit) ||
    !Number.isInteger(candidate.publishLeadMinutes) ||
    typeof candidate.autoCollect !== "boolean" ||
    typeof shorts.voicePreset !== "string" ||
    typeof shorts.bgmPreset !== "string" ||
    typeof shorts.captionPreset !== "string"
  ) return DEFAULT_CONTENT_AUTOMATION_SETTINGS;
  return {
    generationMode: candidate.generationMode as "queue" | "api",
    promptPrefix: candidate.promptPrefix,
    retryLimit: candidate.retryLimit as number,
    publishLeadMinutes: candidate.publishLeadMinutes as number,
    autoCollect: candidate.autoCollect,
    enabledChannels: channels,
    shorts: {
      voicePreset: shorts.voicePreset,
      bgmPreset: shorts.bgmPreset,
      captionPreset: shorts.captionPreset,
    },
  };
}

export async function readContentAutomationSettingsRecord() {
  const { data, error } = await createServiceSupabase()
    .from("os_records")
    .select("id,version,metadata,updated_at")
    .eq("id", CONTENT_AUTOMATION_SETTINGS_ID)
    .eq("record_type", "company_setting")
    .is("archived_at", null)
    .maybeSingle();
  if (error) throw new ApiError(503, "CONTENT_AUTOMATION_SETTINGS_READ_FAILED", "자동화 설정을 불러오지 못했습니다.");
  return data as ContentAutomationSettingsRecord | null;
}

export async function readContentAutomationSettings() {
  const record = await readContentAutomationSettingsRecord();
  if (record) return { record, settings: settingsFromMetadata(record.metadata) };
  const { data, error } = await createServiceSupabase()
    .from("os_records")
    .select("metadata")
    .eq("record_type", "company_setting")
    .contains("metadata", { settingKey: "content-generation" })
    .is("archived_at", null)
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new ApiError(503, "CONTENT_AUTOMATION_SETTINGS_READ_FAILED", "자동화 설정을 불러오지 못했습니다.");
  const legacyMode: ContentAutomationSettings["generationMode"] = data?.metadata?.defaultGenerationMode === "api" ? "api" : "queue";
  return { record: null, settings: { ...DEFAULT_CONTENT_AUTOMATION_SETTINGS, generationMode: legacyMode } };
}
