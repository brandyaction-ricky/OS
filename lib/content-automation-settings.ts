export interface ContentAutomationSettings {
  generationMode: "queue" | "api";
  promptPrefix: string;
  retryLimit: number;
  publishLeadMinutes: number;
  autoCollect: boolean;
  enabledChannels: Array<"youtube" | "instagram" | "threads">;
  shorts: {
    voicePreset: string;
    bgmPreset: string;
    captionPreset: string;
  };
}

export const CONTENT_AUTOMATION_SETTINGS_ID = "ca000000-0000-4000-8000-000000000001";

export const DEFAULT_CONTENT_AUTOMATION_SETTINGS: ContentAutomationSettings = {
  generationMode: "queue",
  promptPrefix: "회사 정본과 연결된 근거만 사용하고, 확인되지 않은 내용은 만들지 않습니다.",
  retryLimit: 2,
  publishLeadMinutes: 30,
  autoCollect: false,
  enabledChannels: ["youtube", "instagram", "threads"],
  shorts: {
    voicePreset: "직접 녹음",
    bgmPreset: "사용 안 함",
    captionPreset: "기본 강조 자막",
  },
};
