import { createCipheriv, createDecipheriv, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { ApiError } from "@/lib/http";
import { createServiceSupabase } from "@/lib/supabase/server";

export const YOUTUBE_UPLOAD_SCOPE = "https://www.googleapis.com/auth/youtube.upload";
export const YOUTUBE_READ_SCOPE = "https://www.googleapis.com/auth/youtube.readonly";
export const YOUTUBE_OAUTH_COOKIE = "bos_youtube_oauth";

type StoredConnection = {
  owner_id: string;
  encrypted_refresh_token: string;
  encrypted_access_token: string | null;
  access_token_expires_at: string | null;
  scope: string;
  channel_id: string;
  channel_title: string;
  connected_at: string;
  updated_at: string;
};

interface GoogleTokenResponse {
  access_token?: string;
  expires_in?: number;
  refresh_token?: string;
  scope?: string;
  token_type?: string;
  error?: string;
  error_description?: string;
}

function required(name: "YOUTUBE_CLIENT_ID" | "YOUTUBE_CLIENT_SECRET" | "YOUTUBE_TOKEN_ENCRYPTION_KEY") {
  const value = process.env[name]?.trim();
  if (!value) throw new ApiError(503, "YOUTUBE_OAUTH_NOT_CONFIGURED", "YouTube 업로드 인증 설정이 아직 완료되지 않았습니다.");
  return value;
}

export function youtubeOAuthConfigured() {
  return Boolean(process.env.YOUTUBE_CLIENT_ID?.trim() && process.env.YOUTUBE_CLIENT_SECRET?.trim() && process.env.YOUTUBE_TOKEN_ENCRYPTION_KEY?.trim());
}

export function youtubeRedirectUri() {
  const explicit = process.env.YOUTUBE_OAUTH_REDIRECT_URI?.trim();
  if (explicit) return explicit;
  const base = process.env.OS_PUBLIC_URL?.trim();
  if (!base) throw new ApiError(503, "YOUTUBE_REDIRECT_NOT_CONFIGURED", "운영 주소가 설정되지 않았습니다.");
  return `${base.replace(/\/$/, "")}/api/v1/youtube/oauth/callback`;
}

function encryptionKey() {
  return createHmac("sha256", "brandyaction-youtube-token-v1").update(required("YOUTUBE_TOKEN_ENCRYPTION_KEY")).digest();
}

export function encryptYoutubeToken(value: string) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(), iv);
  const encrypted = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  return `v1.${iv.toString("base64url")}.${cipher.getAuthTag().toString("base64url")}.${encrypted.toString("base64url")}`;
}

export function decryptYoutubeToken(value: string) {
  const [version, iv, tag, encrypted] = value.split(".");
  if (version !== "v1" || !iv || !tag || !encrypted) throw new ApiError(500, "YOUTUBE_TOKEN_INVALID", "저장된 YouTube 인증 정보를 읽을 수 없습니다.");
  try {
    const decipher = createDecipheriv("aes-256-gcm", encryptionKey(), Buffer.from(iv, "base64url"));
    decipher.setAuthTag(Buffer.from(tag, "base64url"));
    return Buffer.concat([decipher.update(Buffer.from(encrypted, "base64url")), decipher.final()]).toString("utf8");
  } catch {
    throw new ApiError(500, "YOUTUBE_TOKEN_DECRYPT_FAILED", "YouTube 인증 정보를 복호화하지 못했습니다. 다시 연결해 주세요.");
  }
}

function sign(value: string) {
  return createHmac("sha256", encryptionKey()).update(value).digest("base64url");
}

export function createYoutubeOAuthState(ownerId: string) {
  const nonce = randomBytes(24).toString("base64url");
  const payload = Buffer.from(JSON.stringify({ ownerId, nonce, expiresAt: Date.now() + 10 * 60_000 })).toString("base64url");
  return { nonce, cookie: `${payload}.${sign(payload)}` };
}

export function verifyYoutubeOAuthState(cookie: string | undefined, state: string | null) {
  if (!cookie || !state) throw new ApiError(400, "YOUTUBE_OAUTH_STATE_MISSING", "YouTube 연결 요청이 만료되었습니다. 다시 시작해 주세요.");
  const [payload, signature] = cookie.split(".");
  if (!payload || !signature) throw new ApiError(400, "YOUTUBE_OAUTH_STATE_INVALID", "YouTube 연결 요청을 확인할 수 없습니다.");
  const expected = sign(payload);
  const left = Buffer.from(signature); const right = Buffer.from(expected);
  if (left.length !== right.length || !timingSafeEqual(left, right)) throw new ApiError(400, "YOUTUBE_OAUTH_STATE_INVALID", "YouTube 연결 요청을 확인할 수 없습니다.");
  let decoded: { ownerId?: string; nonce?: string; expiresAt?: number };
  try { decoded = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")); }
  catch { throw new ApiError(400, "YOUTUBE_OAUTH_STATE_INVALID", "YouTube 연결 요청을 확인할 수 없습니다."); }
  if (!decoded.ownerId || decoded.nonce !== state || !decoded.expiresAt || decoded.expiresAt < Date.now()) throw new ApiError(400, "YOUTUBE_OAUTH_STATE_EXPIRED", "YouTube 연결 요청이 만료되었습니다. 다시 시작해 주세요.");
  return decoded.ownerId;
}

export function buildYoutubeAuthorizationUrl(state: string) {
  const params = new URLSearchParams({
    client_id: required("YOUTUBE_CLIENT_ID"), redirect_uri: youtubeRedirectUri(), response_type: "code",
    access_type: "offline", include_granted_scopes: "true", prompt: "consent select_account",
    scope: `${YOUTUBE_UPLOAD_SCOPE} ${YOUTUBE_READ_SCOPE}`, state,
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${params}`;
}

async function requestGoogleToken(params: URLSearchParams) {
  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: params, cache: "no-store",
  });
  const body = await response.json().catch(() => ({})) as GoogleTokenResponse;
  if (!response.ok || !body.access_token) throw new ApiError(502, "YOUTUBE_TOKEN_EXCHANGE_FAILED", "Google 인증 토큰을 발급받지 못했습니다.", body.error_description || body.error);
  return body;
}

export async function exchangeYoutubeCode(code: string) {
  return requestGoogleToken(new URLSearchParams({
    code, client_id: required("YOUTUBE_CLIENT_ID"), client_secret: required("YOUTUBE_CLIENT_SECRET"),
    redirect_uri: youtubeRedirectUri(), grant_type: "authorization_code",
  }));
}

async function loadConnection(ownerId: string) {
  const { data, error } = await createServiceSupabase().from("os_youtube_connections").select("*").eq("owner_id", ownerId).maybeSingle();
  if (error) throw new ApiError(500, "YOUTUBE_CONNECTION_READ_FAILED", "YouTube 연결 정보를 불러오지 못했습니다.", error.message);
  return data as StoredConnection | null;
}

export async function saveYoutubeConnection(ownerId: string, tokens: GoogleTokenResponse) {
  if (!tokens.refresh_token || !tokens.access_token) throw new ApiError(502, "YOUTUBE_REFRESH_TOKEN_MISSING", "Google에서 갱신 토큰을 받지 못했습니다. 다시 연결해 주세요.");
  const channelResponse = await fetch("https://www.googleapis.com/youtube/v3/channels?part=id,snippet&mine=true", { headers: { authorization: `Bearer ${tokens.access_token}` }, cache: "no-store" });
  const channelBody = await channelResponse.json().catch(() => ({})) as { items?: Array<{ id?: string; snippet?: { title?: string } }>; error?: { message?: string } };
  if (!channelResponse.ok) throw new ApiError(502, "YOUTUBE_CHANNEL_READ_FAILED", "연결한 YouTube 채널을 확인하지 못했습니다.", channelBody.error?.message);
  const channel = channelBody.items?.[0];
  if (!channel?.id) throw new ApiError(400, "YOUTUBE_CHANNEL_MISSING", "선택한 Google 계정에 YouTube 채널이 없습니다.");
  const now = new Date().toISOString();
  const { error } = await createServiceSupabase().from("os_youtube_connections").upsert({
    owner_id: ownerId, encrypted_refresh_token: encryptYoutubeToken(tokens.refresh_token), encrypted_access_token: encryptYoutubeToken(tokens.access_token),
    access_token_expires_at: new Date(Date.now() + Math.max(60, tokens.expires_in ?? 3600) * 1000).toISOString(), scope: tokens.scope ?? "",
    channel_id: channel.id, channel_title: channel.snippet?.title ?? "YouTube 채널", connected_at: now, updated_at: now,
  }, { onConflict: "owner_id" });
  if (error) throw new ApiError(500, "YOUTUBE_CONNECTION_SAVE_FAILED", "YouTube 연결 정보를 저장하지 못했습니다.", error.message);
  return { channelId: channel.id, channelTitle: channel.snippet?.title ?? "YouTube 채널" };
}

export async function youtubeConnectionStatus(ownerId: string) {
  const connection = await loadConnection(ownerId);
  return connection ? { connected: true, channelId: connection.channel_id, channelTitle: connection.channel_title, connectedAt: connection.connected_at } : { connected: false, channelId: null, channelTitle: null, connectedAt: null };
}

export async function getYoutubeAccessToken(ownerId: string) {
  const connection = await loadConnection(ownerId);
  if (!connection) throw new ApiError(409, "YOUTUBE_NOT_CONNECTED", "먼저 YouTube 채널을 연결해 주세요.");
  if (connection.encrypted_access_token && connection.access_token_expires_at && new Date(connection.access_token_expires_at).getTime() > Date.now() + 60_000) return decryptYoutubeToken(connection.encrypted_access_token);
  const tokens = await requestGoogleToken(new URLSearchParams({
    client_id: required("YOUTUBE_CLIENT_ID"), client_secret: required("YOUTUBE_CLIENT_SECRET"),
    refresh_token: decryptYoutubeToken(connection.encrypted_refresh_token), grant_type: "refresh_token",
  }));
  const { error } = await createServiceSupabase().from("os_youtube_connections").update({
    encrypted_access_token: encryptYoutubeToken(tokens.access_token!), access_token_expires_at: new Date(Date.now() + Math.max(60, tokens.expires_in ?? 3600) * 1000).toISOString(), updated_at: new Date().toISOString(),
  }).eq("owner_id", ownerId);
  if (error) throw new ApiError(500, "YOUTUBE_TOKEN_SAVE_FAILED", "갱신된 YouTube 인증 정보를 저장하지 못했습니다.", error.message);
  return tokens.access_token!;
}

export async function disconnectYoutube(ownerId: string) {
  const connection = await loadConnection(ownerId);
  if (connection) {
    const token = decryptYoutubeToken(connection.encrypted_refresh_token);
    await fetch("https://oauth2.googleapis.com/revoke", { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ token }), cache: "no-store" }).catch(() => null);
  }
  const { error } = await createServiceSupabase().from("os_youtube_connections").delete().eq("owner_id", ownerId);
  if (error) throw new ApiError(500, "YOUTUBE_DISCONNECT_FAILED", "YouTube 연결을 해제하지 못했습니다.", error.message);
}
