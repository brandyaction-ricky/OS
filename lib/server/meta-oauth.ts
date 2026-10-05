import { createCipheriv, createDecipheriv, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { ApiError } from "@/lib/http";
import { createServiceSupabase } from "@/lib/supabase/server";
import { assertActiveChannelOwner, assertConnectionAccess, auditChannelAction, type ChannelActor, type ChannelAction } from "./channel-access";

export type MetaPlatform = "instagram" | "threads";
export const META_COOKIE = "bos_meta_oauth";
export type MetaConnection = {
  owner_id: string; platform: MetaPlatform; external_account_id: string; account_name: string; account_type: string;
  scopes: string[]; encrypted_access_token: string; token_expires_at: string; team_shared: boolean;
  status: string; connected_at: string; updated_at: string; last_success_at: string | null; last_error_code: string | null;
};
const CONFIG = {
  instagram: { prefix: "META_INSTAGRAM", authorization: "https://www.instagram.com/oauth/authorize", token: "https://api.instagram.com/oauth/access_token", host: "https://graph.instagram.com", scopes: ["instagram_business_basic", "instagram_business_content_publish", "instagram_business_manage_comments"] },
  threads: { prefix: "META_THREADS", authorization: "https://threads.net/oauth/authorize", token: "https://graph.threads.net/oauth/access_token", host: "https://graph.threads.net", scopes: ["threads_basic", "threads_content_publish", "threads_read_replies", "threads_manage_replies", "threads_manage_insights"] },
} as const;
export function metaMode() { return process.env.META_MODE === "live" ? "live" : "mock"; }
function required(name: string) {
  const value = process.env[name]?.trim();
  if (!value) throw new ApiError(503, "META_NOT_CONFIGURED", "Meta 연결 설정이 준비되지 않았습니다. 작동 상태에서 확인해 주세요.");
  return value;
}
function encryptionKey() { return createHmac("sha256", "brandyaction-meta-token-v1").update(required("META_TOKEN_ENCRYPTION_KEY")).digest(); }
export function encryptMetaToken(value: string) {
  const iv = randomBytes(12), cipher = createCipheriv("aes-256-gcm", encryptionKey(), iv);
  const encrypted = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  return `v1.${iv.toString("base64url")}.${cipher.getAuthTag().toString("base64url")}.${encrypted.toString("base64url")}`;
}
export function decryptMetaToken(value: string) {
  try {
    const [version, iv, tag, encrypted] = value.split(".");
    if (version !== "v1" || !iv || !tag || !encrypted) throw Error("invalid");
    const decipher = createDecipheriv("aes-256-gcm", encryptionKey(), Buffer.from(iv, "base64url"));
    decipher.setAuthTag(Buffer.from(tag, "base64url"));
    return Buffer.concat([decipher.update(Buffer.from(encrypted, "base64url")), decipher.final()]).toString("utf8");
  } catch { throw new ApiError(500, "META_TOKEN_INVALID", "저장된 Meta 인증 정보를 읽지 못했습니다. 다시 연결해 주세요."); }
}
function sign(value: string) { return createHmac("sha256", encryptionKey()).update(value).digest("base64url"); }
export function createMetaState(ownerId: string, platform: MetaPlatform) {
  const nonce = randomBytes(24).toString("base64url");
  const value = Buffer.from(JSON.stringify({ ownerId, platform, nonce, expiresAt: Date.now() + 600_000 })).toString("base64url");
  return { nonce, cookie: `${value}.${sign(value)}` };
}
export function verifyMetaState(cookie: string | undefined, state: string | null) {
  try {
    if (!cookie || !state) throw Error("missing");
    const [payload, signature] = cookie.split(".");
    const expected = Buffer.from(sign(payload)), actual = Buffer.from(signature ?? "");
    if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) throw Error("signature");
    const value = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    if (!value.ownerId || !["instagram", "threads"].includes(value.platform) || value.nonce !== state || !Number.isFinite(value.expiresAt) || value.expiresAt < Date.now()) throw Error("expired");
    return value as { ownerId: string; platform: MetaPlatform };
  } catch { throw new ApiError(400, "META_STATE_INVALID", "연결 요청이 만료되었거나 올바르지 않습니다. 내 계정에서 다시 시작해 주세요."); }
}
export function metaRedirectUri() { return `${required("OS_PUBLIC_URL").replace(/\/$/, "")}/api/v1/meta/callback`; }
export function metaAuthorizationUrl(platform: MetaPlatform, state: string) {
  const config = CONFIG[platform];
  return `${config.authorization}?${new URLSearchParams({ client_id: required(`${config.prefix}_APP_ID`), redirect_uri: metaRedirectUri(), response_type: "code", scope: config.scopes.join(","), state })}`;
}
async function metaJson(url: string, options: RequestInit) {
  const response = await fetch(url, { ...options, cache: "no-store", signal: AbortSignal.timeout(20_000) });
  const body = await response.json().catch(() => ({}));
  if (!response.ok || body.error) throw new ApiError(response.status === 401 || response.status === 403 ? 403 : 502, "META_CONNECTION_FAILED", "Meta 요청을 확인하지 못했습니다. 테스터 등록·초대 수락·권한과 연결 만료 여부를 확인해 주세요.");
  return body;
}
export async function loadMetaConnection(ownerId: string, platform: MetaPlatform) {
  const { data, error } = await createServiceSupabase().from("os_meta_connections").select("*").eq("owner_id", ownerId).eq("platform", platform).maybeSingle();
  if (error) throw new ApiError(503, "META_SCHEMA_REQUIRED", "채널 연결 저장소가 아직 준비되지 않았습니다. DB 적용 여부를 확인해 주세요.");
  return data as MetaConnection | null;
}
export async function authorizeMetaConnection(actor: ChannelActor, ownerId: string, platform: MetaPlatform, action: ChannelAction = "use") {
  const connection = await loadMetaConnection(ownerId, platform);
  if (!connection) throw new ApiError(404, "META_NOT_CONNECTED", "연결된 계정이 없습니다.");
  assertConnectionAccess(actor, connection, action);
  if (action === "use") await assertActiveChannelOwner(ownerId);
  return connection;
}
export function publicMetaConnection(connection: MetaConnection) {
  const expires = Date.parse(connection.token_expires_at);
  return { platform: connection.platform, ownerId: connection.owner_id, accountName: connection.account_name,
    accountType: connection.account_type, teamShared: connection.team_shared, status: expires <= Date.now() ? "expired" : connection.status,
    expiresAt: connection.token_expires_at, expiresSoon: expires > Date.now() && expires - Date.now() <= 7 * 86_400_000,
    connectedAt: connection.connected_at, lastSuccessAt: connection.last_success_at, lastErrorCode: connection.last_error_code,
    mock: connection.account_type === "MOCK" };
}
export async function saveMetaConnection(ownerId: string, platform: MetaPlatform, code?: string) {
  await assertActiveChannelOwner(ownerId);
  const config = CONFIG[platform], mock = metaMode() === "mock";
  let accountId = `mock-${ownerId}-${platform}`, name = `모의 ${platform} 계정`, accountType = "MOCK", encrypted = "mock", expiresIn = 60 * 86_400;
  if (!mock) {
    if (!code) throw new ApiError(400, "META_CODE_REQUIRED", "Meta 연결 코드가 없습니다.");
    const raw = await metaJson(config.token, { method: "POST", body: new URLSearchParams({ client_id: required(`${config.prefix}_APP_ID`), client_secret: required(`${config.prefix}_APP_SECRET`), grant_type: "authorization_code", redirect_uri: metaRedirectUri(), code }) });
    const short = raw.access_token ? raw : Array.isArray(raw.data) && raw.data.length === 1 ? raw.data[0] : null;
    if (!short?.access_token) throw new ApiError(502, "META_TOKEN_MISSING", "Meta 인증 정보를 받지 못했습니다.");
    const long = await metaJson(`${config.host}/access_token?${new URLSearchParams({ grant_type: platform === "instagram" ? "ig_exchange_token" : "th_exchange_token", client_secret: required(`${config.prefix}_APP_SECRET`) })}`, { headers: { authorization: `Bearer ${short.access_token}` } });
    if (!long.access_token || !Number.isFinite(long.expires_in) || long.expires_in <= 0) throw new ApiError(502, "META_TOKEN_MISSING", "유효한 장기 인증 정보를 받지 못했습니다.");
    const me = await metaJson(`${config.host}/me?fields=${platform === "instagram" ? "user_id,username,account_type" : "id,username"}`, { headers: { authorization: `Bearer ${long.access_token}` } });
    accountId = String(me.user_id ?? me.id ?? ""); name = String(me.username ?? ""); accountType = platform === "instagram" ? String(me.account_type ?? "") : "THREADS";
    if (!accountId || !name || (platform === "instagram" && !["BUSINESS", "MEDIA_CREATOR", "CREATOR"].includes(accountType))) throw new ApiError(400, "META_ACCOUNT_TYPE", "인스타는 프로페셔널 계정인지 확인해 주세요. 연결 계정을 확인하지 못했습니다.");
    encrypted = encryptMetaToken(long.access_token); expiresIn = long.expires_in;
  }
  const existing = await loadMetaConnection(ownerId, platform);
  if (existing && existing.external_account_id !== accountId) throw new ApiError(409, "CHANNEL_REPLACEMENT_REQUIRED", "이미 연결된 계정이 있습니다. 먼저 해제한 뒤 다른 계정을 연결해 주세요.");
  const now = new Date().toISOString();
  const payload = {
    owner_id: ownerId, platform, external_account_id: accountId, account_name: name, account_type: accountType,
    scopes: [...config.scopes], encrypted_access_token: encrypted, token_expires_at: new Date(Date.now() + expiresIn * 1000).toISOString(),
    status: "connected", connected_at: existing?.connected_at ?? now, updated_at: now, last_success_at: now, last_error_code: null,
  };
  const table = createServiceSupabase().from("os_meta_connections");
  // Never replace a concurrent connection or overwrite a newly changed sharing preference.
  const query = existing ? table.update(payload).eq("owner_id", ownerId).eq("platform", platform).eq("external_account_id", accountId) : table.insert(payload);
  const { data, error } = await query.select("*").maybeSingle();
  if (error?.code === "23505") throw new ApiError(409, "CHANNEL_ALREADY_CONNECTED", "다른 OS 계정에 연결된 계정입니다. 연결한 본인에게 팀 공유를 요청해 주세요.");
  if (error || !data) throw new ApiError(500, "META_CONNECTION_SAVE_FAILED", "채널 연결을 저장하지 못했습니다.");
  await auditChannelAction(ownerId, ownerId, platform, mock ? "모의 연결" : "연결");
  return publicMetaConnection(data as MetaConnection);
}
export function metaAccessToken(connection: MetaConnection) {
  if (metaMode() !== "live" || connection.account_type === "MOCK") throw new ApiError(409, "META_MOCK_CONNECTION", "모의 연결은 실제 API를 호출하지 않습니다.");
  if (connection.status !== "connected" || Date.parse(connection.token_expires_at) <= Date.now()) throw new ApiError(409, "META_TOKEN_EXPIRED", "채널 연결이 만료되었습니다. 내 계정에서 다시 연결해 주세요.");
  return decryptMetaToken(connection.encrypted_access_token);
}
export async function testMetaConnection(actor: ChannelActor, connection: MetaConnection) {
  assertConnectionAccess(actor, connection);
  assertMetaModeMatches(connection);
  if (metaMode() === "live") {
    await metaJson(`${CONFIG[connection.platform].host}/me?fields=${connection.platform === "instagram" ? "user_id,username" : "id,username"}`, { headers: { authorization: `Bearer ${metaAccessToken(connection)}` } });
  }
  const { error } = await createServiceSupabase().from("os_meta_connections").update({ last_success_at: new Date().toISOString(), last_error_code: null }).eq("owner_id", connection.owner_id).eq("platform", connection.platform);
  if (error) throw new ApiError(500, "META_CHECK_SAVE_FAILED", "연결 확인 결과를 저장하지 못했습니다.");
  await auditChannelAction(actor.id, connection.owner_id, connection.platform, metaMode() === "mock" ? "모의 연결 테스트" : "연결 테스트");
}
export async function refreshMetaConnection(actor: ChannelActor, connection: MetaConnection) {
  assertConnectionAccess(actor, connection);
  assertMetaModeMatches(connection);
  if (metaMode() === "mock") { await auditChannelAction(actor.id, connection.owner_id, connection.platform, "모의 갱신 확인"); return; }
  const token = metaAccessToken(connection);
  const data = await metaJson(`${CONFIG[connection.platform].host}/refresh_access_token?grant_type=${connection.platform === "instagram" ? "ig_refresh_token" : "th_refresh_token"}`, { headers: { authorization: `Bearer ${token}` } });
  if (!data.access_token || !Number.isFinite(data.expires_in) || data.expires_in <= 0) throw new ApiError(502, "META_REFRESH_FAILED", "인증 정보를 갱신하지 못했습니다.");
  const { error } = await createServiceSupabase().from("os_meta_connections").update({ encrypted_access_token: encryptMetaToken(data.access_token), token_expires_at: new Date(Date.now() + data.expires_in * 1000).toISOString(), updated_at: new Date().toISOString() }).eq("owner_id", connection.owner_id).eq("platform", connection.platform);
  if (error) throw new ApiError(500, "META_REFRESH_SAVE_FAILED", "갱신한 연결을 저장하지 못했습니다.");
  await auditChannelAction(actor.id, connection.owner_id, connection.platform, "인증 갱신");
}

export function assertMetaModeMatches(connection: MetaConnection) {
  if ((metaMode() === "mock") !== (connection.account_type === "MOCK")) throw new ApiError(409, "META_MODE_MISMATCH", "실제 연결과 모의 모드가 다릅니다. 연결 테스트나 갱신 결과를 저장하지 않았습니다.");
}
