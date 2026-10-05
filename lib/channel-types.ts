export type ChannelPlatform = "youtube" | "instagram" | "threads";
export interface ChannelConnection {
  platform: ChannelPlatform;
  ownerId: string;
  accountName: string;
  accountType: string;
  channelId?: string;
  analyticsConnected?: boolean;
  teamShared: boolean;
  status: string;
  connectedAt: string;
  expiresAt: string | null;
  expiresSoon: boolean;
  lastSuccessAt: string | null;
  lastErrorCode: string | null;
  mock: boolean;
}
