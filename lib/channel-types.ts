export type ChannelPlatform = "youtube" | "instagram" | "threads";
export interface ChannelConnection {
  platform: ChannelPlatform;
  ownerId: string;
  /** Instagram / Threads account key (다채널 2단계): names one of a person's accounts of a platform, never the platform id. */
  accountKey?: string;
  accountName: string;
  accountType: string;
  channelId?: string;
  analyticsConnected?: boolean;
  /** CTA 일괄 관리 (2026-10-31): the connection may change uploaded videos' descriptions. */
  manageConnected?: boolean;
  teamShared: boolean;
  status: string;
  connectedAt: string;
  expiresAt: string | null;
  expiresSoon: boolean;
  lastSuccessAt: string | null;
  lastErrorCode: string | null;
  mock: boolean;
}
