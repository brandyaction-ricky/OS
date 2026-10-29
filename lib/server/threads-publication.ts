import { createHash, randomUUID } from "node:crypto";
import { ApiError } from "@/lib/http";
import { executePublication, PublicationError, type PublicationSettings, type PublishCheckpoint } from "@/lib/channel-publishing";
import { threadsPostsProblem } from "@/lib/threads-posts";
import type { OsRecord } from "@/lib/record-types";
import { createServiceSupabase } from "@/lib/supabase/server";
import type { RequestActor } from "./auth";
import { assertHumanOwner, getPersonalRecord } from "./content-automation-v07";
import { assertMetaModeMatches, authorizeMetaConnection, metaMode, publicMetaConnection, type MetaConnection } from "./meta-oauth";
import { metaPublishProvider } from "./meta-publishing";

type Run = {
  publication_id: string; owner_id: string; source_version: number; review_id: string; posts: string[];
  account_owner_id: string; external_account_id: string; account_name: string; mode: "mock" | "live";
  state: "running" | "retryable" | "uncertain" | "published" | "mock_complete";
  operation_id: string; checkpoint: PublishCheckpoint; error_code: string | null;
};
export type ThreadsPublicationStatus = {
  mode: "mock" | "live"; enabled: boolean; ready: boolean; reason: string;
  connections: (ReturnType<typeof publicMetaConnection> & { publicationAccountKey: string })[];
  publication: null | {
    state: Run["state"]; mode: "mock" | "live"; publishedCount: number; total: number; permalink: string; errorCode?: string;
    accountOwnerId: string; accountName: string; posts: string[];
  };
};
const CONNECTION_FIELDS = "owner_id,platform,external_account_id,account_name,account_type,scopes,token_expires_at,team_shared,status,connected_at,updated_at,last_success_at,last_error_code";
const RUN_FIELDS = "publication_id,owner_id,source_version,review_id,posts,account_owner_id,external_account_id,account_name,mode,state,operation_id,checkpoint,error_code";
const setupMessage = "공식 API 발행 저장소를 준비 중입니다. 원고 작성·미승인 저장은 계속 사용할 수 있습니다.";

export function threadsPublicationEnabled() {
  return process.env.THREADS_AUTOMATION_PUBLISH_ENABLED === "true"
    && (metaMode() === "mock" || process.env.META_LIVE_PUBLISH_ENABLED === "true");
}
function publicRun(run: Run | null): ThreadsPublicationStatus["publication"] {
  return run ? { state: run.state, mode: run.mode, publishedCount: run.checkpoint.receipts.length, total: run.posts.length,
    permalink: run.checkpoint.receipts[0]?.permalink ?? "", ...(run.error_code ? { errorCode: run.error_code } : {}),
    accountOwnerId: run.account_owner_id, accountName: run.account_name, posts: run.posts } : null;
}
async function sourceFor(actor: RequestActor, id: string) {
  assertHumanOwner(actor);
  const source = await getPersonalRecord(actor, id, "content_publish");
  if (source.metadata.channel !== "threads") throw new ApiError(404, "THREADS_SOURCE_NOT_FOUND", "내 쓰레드 원고를 찾을 수 없습니다.");
  return source;
}
async function approvedSource(source: OsRecord) {
  const db = createServiceSupabase();
  const { data: review, error } = await db.from("os_content_review_log").select("content_version,result")
    .eq("publish_record_id", source.id).eq("owner_id", source.owner_id).order("created_at", { ascending: false })
    .order("id", { ascending: false }).limit(1).maybeSingle();
  if (error || review?.result !== "ready") return false;
  const { data: event, error: eventError } = await db.from("os_record_events").select("snapshot")
    .eq("record_id", source.id).eq("snapshot->>version", String(Number(review.content_version) + 1))
    .eq("snapshot->>status", "ready").order("id", { ascending: false }).limit(1).maybeSingle();
  const approved = event?.snapshot;
  return !eventError && approved && approved.title === source.title && approved.description === source.description
    && approved.parent_id === source.parent_id && JSON.stringify(approved.metadata?.posts) === JSON.stringify(source.metadata.posts);
}
export function threadsPublicationAccountKey(connection: MetaConnection) {
  return createHash("sha256").update(JSON.stringify([connection.owner_id, connection.external_account_id,
    connection.updated_at, connection.account_name])).digest("hex");
}
function usable(connection: MetaConnection) {
  return connection.status === "connected" && Date.parse(connection.token_expires_at) > Date.now()
    && (connection.account_type === "MOCK") === (metaMode() === "mock");
}
export async function readThreadsPublicationStatus(actor: RequestActor, id: string): Promise<ThreadsPublicationStatus> {
  const ownerId = assertHumanOwner(actor), source = await sourceFor(actor, id), db = createServiceSupabase();
  const [runResult, accountsResult] = await Promise.all([
    db.from("os_threads_publication_runs").select(RUN_FIELDS).eq("publication_id", id).eq("owner_id", ownerId).maybeSingle(),
    db.from("os_meta_connections").select(CONNECTION_FIELDS).eq("platform", "threads").or(`owner_id.eq.${ownerId},team_shared.eq.true`),
  ]);
  const storedRun = runResult.data as Run | null;
  // A cleanly paused attempt with no live receipts may be replaced by a new
  // approved version. Never preview its old text while claim would send new text.
  const frozen = storedRun && (storedRun.state === "running" || storedRun.state === "uncertain"
    || storedRun.state === "published" || storedRun.mode === "live" && storedRun.checkpoint.receipts.length > 0);
  const run = storedRun && !frozen && (storedRun.source_version !== source.version
    || storedRun.mode !== metaMode() || JSON.stringify(storedRun.posts) !== JSON.stringify(source.metadata.posts)) ? null : storedRun;
  const listedConnections = (accountsResult.data ?? []) as MetaConnection[];
  let connections: MetaConnection[] = [], ownerLookupFailed = false;
  if (!accountsResult.error && listedConnections.length) {
    try {
      const ownerIds = [...new Set(listedConnections.map(connection => connection.owner_id))];
      const { data: profiles, error } = await db.from("os_profiles").select("id,is_active").in("id", ownerIds);
      ownerLookupFailed = Boolean(error);
      if (!error) {
        const activeOwners = new Set((profiles ?? []).filter(profile => profile.is_active === true).map(profile => profile.id));
        connections = listedConnections.filter(connection => activeOwners.has(connection.owner_id));
      }
    } catch { ownerLookupFailed = true; }
  }
  const enabled = threadsPublicationEnabled();
  const status: ThreadsPublicationStatus = { mode: metaMode(), enabled, ready: false, reason: "", connections: connections.map(connection => ({ ...publicMetaConnection(connection), publicationAccountKey: threadsPublicationAccountKey(connection) })), publication: publicRun(run) };
  if (runResult.error) return { ...status, reason: setupMessage };
  if (accountsResult.error) return { ...status, reason: "Threads 계정 연결 상태를 확인하지 못했습니다. 잠시 후 다시 확인해 주세요." };
  if (ownerLookupFailed) return { ...status, reason: "계정 소유자의 이용 상태를 확인하지 못했습니다. 잠시 후 다시 확인해 주세요." };
  if (!enabled) return { ...status, reason: "공식 API 발행은 아직 활성화하지 않았습니다. 원고 작성과 검수는 계속할 수 있습니다." };
  if (run?.state === "published") return { ...status, reason: "공식 API로 게시한 원고입니다. 다시 게시하지 않습니다." };
  if (run?.state === "mock_complete" && run.mode === metaMode()) return { ...status, reason: "모의 발행 확인을 마쳤습니다. 실제 Threads에는 게시하지 않았습니다." };
  if (run?.state === "running" || run?.state === "uncertain") return { ...status, reason: "직전 발행 결과를 확인해야 합니다. 중복을 막기 위해 다시 게시하지 않습니다." };
  if (!["ready", "scheduled"].includes(source.status) || !await approvedSource(source))
    return { ...status, reason: "현재 원고를 최종 확인에서 승인한 뒤 발행할 수 있습니다." };
  const problem = threadsPostsProblem(source.metadata.posts, 1);
  if (problem) return { ...status, reason: problem };
  if (listedConnections.length && !connections.length)
    return { ...status, reason: "연결 계정 소유자의 OS 이용이 중지됐거나 확인되지 않습니다. 관리자에게 문의해 주세요." };
  const available = connections.filter(usable);
  const partial = run && run.mode === "live" && run.checkpoint.receipts.length > 0;
  if (partial && (run.source_version !== source.version || JSON.stringify(run.posts) !== JSON.stringify(source.metadata.posts)))
    return { ...status, reason: "처음 발행한 원고와 현재 원고가 다릅니다. 게시된 내용을 확인한 뒤 담당자에게 문의해 주세요." };
  if (!available.some(connection => !partial || connection.owner_id === run.account_owner_id && connection.external_account_id === run.external_account_id))
    return { ...status, reason: partial ? "처음 발행한 Threads 계정을 다시 연결해야 남은 글을 이어 올릴 수 있습니다." : "내 계정에서 Threads를 연결하거나 팀 공유된 Threads 계정을 선택해 주세요." };
  return { ...status, ready: true, reason: partial ? "이미 게시한 글은 유지하고 남은 답글만 이어 올립니다." : "승인된 본문과 댓글을 순서대로 공식 API에 게시합니다." };
}
function rpcError(code?: string, message?: string): ApiError {
  const known: Record<string, string> = {
    THREADS_SOURCE_CHANGED: "원고가 바뀌었습니다. 최신 원고를 다시 확인해 주세요.",
    THREADS_REVIEW_REQUIRED: "현재 원고의 최종 승인 기록을 확인하지 못했습니다. 최종 확인에서 다시 승인해 주세요.",
    THREADS_RESULT_UNCERTAIN: "직전 발행 결과를 먼저 확인해야 합니다. 중복 게시하지 않았습니다.",
    THREADS_ACCOUNT_UNAVAILABLE: "Threads 연결이 만료됐거나 공유 권한이 바뀌었습니다. 연결 상태를 확인해 주세요.",
    THREADS_ACCOUNT_CHANGED: "처음 발행한 Threads 계정으로만 이어서 처리할 수 있습니다.",
    THREADS_SNAPSHOT_CHANGED: "일부 게시된 글의 원고나 계정은 바꿀 수 없습니다.",
    THREADS_ALREADY_PUBLISHED: "이미 게시한 원고입니다. 다시 게시하지 않았습니다.",
  };
  if (code === "42P01" || code === "PGRST202" || code === "PGRST205") return new ApiError(503, "THREADS_PUBLICATION_SETUP_REQUIRED", setupMessage);
  return new ApiError(code === "PT403" ? 403 : code === "PT404" ? 404 : 409,
    message && known[message] ? message : "THREADS_PUBLICATION_NOT_SAVED", message && known[message] ? known[message] : "발행 상태 저장을 확인하지 못했습니다. 상태를 다시 불러온 뒤 확인해 주세요.");
}
async function rpc(name: string, values: Record<string, unknown>): Promise<Run> {
  const { data, error } = await createServiceSupabase().rpc(name, values);
  if (error || !data) throw rpcError(error?.code, error?.message);
  return data as Run;
}

export async function publishPersonalThreads(actor: RequestActor, id: string, input: { expectedVersion: number; accountOwnerId: string; expectedAccountKey: string; confirm: true }) {
  const ownerId = assertHumanOwner(actor);
  if (!threadsPublicationEnabled()) throw new ApiError(503, "THREADS_PUBLICATION_DISABLED", "공식 API 발행은 아직 활성화하지 않았습니다.");
  if (input.confirm !== true) throw new ApiError(400, "HUMAN_CONFIRMATION_REQUIRED", "게시할 원고와 계정을 직접 확인해 주세요.");
  const source = await sourceFor(actor, id);
  const problem = threadsPostsProblem(source.metadata.posts, 1);
  if (problem) throw new ApiError(422, "THREADS_POSTS_INVALID", problem);
  const connection = await authorizeMetaConnection(actor, input.accountOwnerId, "threads");
  assertMetaModeMatches(connection);
  if (input.expectedAccountKey !== threadsPublicationAccountKey(connection))
    throw new ApiError(409, "THREADS_ACCOUNT_CHANGED", "연결 계정이 바뀌었습니다. 계정과 원고를 다시 확인해 주세요.");
  if (!usable(connection)) throw new ApiError(409, "THREADS_ACCOUNT_UNAVAILABLE", "Threads 연결이 만료됐습니다. 다시 연결해 주세요.");
  const operationId = randomUUID();
  let run = await rpc("os_threads_publication_claim", { p_owner: ownerId, p_record: id, p_expected_version: input.expectedVersion,
    p_account_owner: connection.owner_id, p_external_account_id: connection.external_account_id, p_account_name: connection.account_name,
    p_mode: metaMode(), p_operation: operationId });
  if (run.state === "published") return readThreadsPublicationStatus(actor, id);
  const settings: PublicationSettings = { account: { platform: "threads", ownerId: connection.owner_id },
    platformFormat: run.posts.length === 1 ? "threads_text" : "threads_chain", publishMode: "now",
    caption: run.posts.length === 1 ? run.posts[0] : "", hashtags: "", firstComment: "", replyControl: "everyone", parts: run.posts, media: [] };
  let checkpointUncertain = false;
  try {
    await executePublication(settings, run.checkpoint, metaPublishProvider(connection, settings, id, []), async checkpoint => {
      checkpointUncertain = true;
      run = await rpc("os_threads_publication_checkpoint", { p_owner: ownerId, p_record: id, p_operation: operationId, p_checkpoint: checkpoint });
      checkpointUncertain = false;
    });
    checkpointUncertain = true;
    await rpc("os_threads_publication_finish", { p_owner: ownerId, p_record: id, p_operation: operationId });
  } catch (error) {
    const uncertain = checkpointUncertain || run.checkpoint.container?.phase === "publishing";
    const errorCode = error instanceof PublicationError ? error.code : "THREADS_CHECKPOINT_UNCERTAIN";
    try {
      await rpc("os_threads_publication_finish", { p_owner: ownerId, p_record: id, p_operation: operationId, p_error_code: errorCode, p_uncertain: uncertain });
    } catch { /* Keep the durable running/uncertain lock when persistence is unavailable. */ }
    throw new ApiError(409, uncertain ? "THREADS_RESULT_UNCERTAIN" : "THREADS_PUBLICATION_PAUSED",
      uncertain ? "발행 결과를 확인해야 합니다. 중복을 막기 위해 재게시하지 않았습니다." : "발행을 멈췄습니다. 이미 게시한 글은 유지되며, 상태를 확인한 뒤 남은 글만 이어 올릴 수 있습니다.");
  }
  return readThreadsPublicationStatus(actor, id);
}
