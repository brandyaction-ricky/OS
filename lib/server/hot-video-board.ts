import { ApiError } from "@/lib/http";
import {
  appendHotVideoSnapshot,
  buildHotVideoScores,
  classifyHotVideo,
  HOT_VIDEO_CANDIDATE_LIMIT,
  HOT_VIDEO_REGIONS,
  hotVideoFormat,
  hotVideoQuotaEstimate,
  seoulDate,
  type HotVideoItem,
  type HotVideoRegion,
} from "@/lib/hot-video-board";
import { createServiceSupabase } from "@/lib/supabase/server";
import { youtubeMomentum, type BaselineVideo } from "@/lib/youtube-outliers";

type YoutubeItem = {
  id?: string | { videoId?: string };
  snippet?: {
    channelId?: string;
    channelTitle?: string;
    title?: string;
    publishedAt?: string;
    categoryId?: string;
    liveBroadcastContent?: string;
    thumbnails?: { high?: { url?: string }; medium?: { url?: string } };
  };
  statistics?: { viewCount?: string; likeCount?: string; commentCount?: string; subscriberCount?: string; hiddenSubscriberCount?: boolean };
  contentDetails?: { duration?: string; relatedPlaylists?: { uploads?: string }; videoId?: string };
  liveStreamingDetails?: unknown;
};

type StoredBoard = { id: string; metadata: Record<string, unknown> };
type ChannelDetails = { subscribers: number | null; uploads: string };

function durationSeconds(value = "") {
  const match = value.match(/^PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/);
  return match ? Number(match[1] ?? 0) * 3600 + Number(match[2] ?? 0) * 60 + Number(match[3] ?? 0) : 0;
}

function youtubeId(item: YoutubeItem) {
  return String(typeof item.id === "object" ? item.id.videoId ?? "" : item.id ?? "");
}

function normalizeVideo(item: YoutubeItem): BaselineVideo & { channelTitle: string; thumbnail: string; likes: number; comments: number } {
  return {
    id: youtubeId(item),
    channelId: item.snippet?.channelId ?? "",
    channelTitle: item.snippet?.channelTitle ?? "YouTube 채널",
    title: item.snippet?.title ?? "제목 없음",
    publishedAt: item.snippet?.publishedAt ?? "",
    views: Number(item.statistics?.viewCount ?? 0),
    likes: Number(item.statistics?.likeCount ?? 0),
    comments: Number(item.statistics?.commentCount ?? 0),
    durationSeconds: durationSeconds(item.contentDetails?.duration),
    live: !!item.liveStreamingDetails || ["live", "upcoming"].includes(item.snippet?.liveBroadcastContent ?? ""),
    categoryId: item.snippet?.categoryId,
    thumbnail: item.snippet?.thumbnails?.high?.url ?? item.snippet?.thumbnails?.medium?.url ?? "",
  };
}

async function youtube(resource: string, parameters: Record<string, string>) {
  const key = process.env.YOUTUBE_API_KEY?.trim();
  if (!key) throw new ApiError(503, "YOUTUBE_NOT_CONFIGURED", "YouTube Data API 연결이 필요합니다.");
  const response = await fetch(`https://www.googleapis.com/youtube/v3/${resource}?${new URLSearchParams({ ...parameters, key })}`, {
    cache: "no-store",
    signal: AbortSignal.timeout(20_000),
  });
  const body = await response.json().catch(() => ({})) as { items?: YoutubeItem[]; nextPageToken?: string; error?: { message?: string } };
  if (!response.ok) {
    throw new ApiError(
      response.status === 403 ? 429 : 502,
      response.status === 403 ? "YOUTUBE_QUOTA_EXCEEDED" : "YOUTUBE_HOT_BOARD_FAILED",
      response.status === 403 ? "YouTube 할당량을 초과해 오늘 보드를 수집하지 못했습니다." : "핫 비디오 데이터를 불러오지 못했습니다.",
      body.error?.message,
    );
  }
  return { items: body.items ?? [], nextPageToken: body.nextPageToken ?? "" };
}

async function ownerId() {
  const service = createServiceSupabase();
  const { data, error } = await service.from("os_profiles").select("id").eq("is_active", true).eq("role", "admin").order("created_at").limit(1).maybeSingle();
  if (error || !data?.id) throw new ApiError(500, "HOT_VIDEO_OWNER_MISSING", "핫 비디오 보드를 저장할 관리자 계정을 찾지 못했습니다.", error?.message);
  return data.id as string;
}

async function videoDetails(ids: string[]) {
  const uniqueIds = [...new Set(ids.filter(Boolean))];
  const groups: string[][] = [];
  for (let index = 0; index < uniqueIds.length; index += 50) groups.push(uniqueIds.slice(index, index + 50));
  const pages = await Promise.all(groups.map((group) => youtube("videos", {
    part: "snippet,statistics,contentDetails,liveStreamingDetails",
    id: group.join(","),
  })));
  return pages.flatMap((page) => page.items);
}

async function channelDetails(channelIds: string[]) {
  const uniqueIds = [...new Set(channelIds.filter(Boolean))];
  const pages: YoutubeItem[] = [];
  for (let index = 0; index < uniqueIds.length; index += 50) {
    pages.push(...(await youtube("channels", { part: "statistics,contentDetails", id: uniqueIds.slice(index, index + 50).join(",") })).items);
  }
  return new Map(pages.map((item) => [youtubeId(item), {
    subscribers: item.statistics?.hiddenSubscriberCount ? null : Number(item.statistics?.subscriberCount ?? 0) || null,
    uploads: item.contentDetails?.relatedPlaylists?.uploads ?? "",
  } satisfies ChannelDetails]));
}

async function channelBaselineVideos(playlistId: string) {
  if (!playlistId) return [];
  const videos: BaselineVideo[] = [];
  let pageToken = "";
  for (let page = 0; page < 3; page += 1) {
    const uploads = await youtube("playlistItems", {
      part: "contentDetails",
      playlistId,
      maxResults: "50",
      ...(pageToken ? { pageToken } : {}),
    });
    const ids = uploads.items.map((item) => item.contentDetails?.videoId ?? "").filter(Boolean);
    videos.push(...(await videoDetails(ids)).map(normalizeVideo));
    pageToken = uploads.nextPageToken;
    if (!pageToken) break;
  }
  return videos;
}

async function discoverRegion(region: HotVideoRegion, now: Date, previousBoards: StoredBoard[]) {
  const publishedAfter = new Date(now.getTime() - 7 * 86_400_000).toISOString();
  const [popular, recent] = await Promise.all([
    youtube("videos", { part: "snippet,statistics,contentDetails,liveStreamingDetails", chart: "mostPopular", regionCode: region, maxResults: "50" }),
    youtube("search", { part: "snippet", type: "video", regionCode: region, publishedAfter, order: "viewCount", maxResults: "50" }),
  ]);
  const recentDetails = await videoDetails(recent.items.map(youtubeId));
  const candidates = [...new Map([...popular.items, ...recentDetails].map((item) => [youtubeId(item), item])).values()]
    .map(normalizeVideo)
    .filter((item) => item.id && !item.live && hotVideoFormat(item.durationSeconds) !== "excluded")
    .sort((a, b) => b.views - a.views)
    .slice(0, HOT_VIDEO_CANDIDATE_LIMIT);
  const channels = await channelDetails(candidates.map((item) => item.channelId));
  const baselineCache = new Map<string, BaselineVideo[]>();
  const baselineChannels = [...new Set(candidates.filter((item) => ["long", "short"].includes(hotVideoFormat(item.durationSeconds))).map((item) => item.channelId))];
  for (let index = 0; index < baselineChannels.length; index += 3) {
    await Promise.all(baselineChannels.slice(index, index + 3).map(async (channelId) => {
      baselineCache.set(channelId, await channelBaselineVideos(channels.get(channelId)?.uploads ?? ""));
    }));
  }
  const priorItems = previousBoards
    .filter((board) => String(board.metadata.region ?? "") === region)
    .flatMap((board) => Array.isArray(board.metadata.items) ? board.metadata.items as HotVideoItem[] : []);
  const measuredAt = now.toISOString();
  return candidates.map((video): HotVideoItem => {
    const previous = priorItems.filter((item) => item.id === video.id).sort((a, b) => a.observedAt.localeCompare(b.observedAt));
    const snapshots = appendHotVideoSnapshot(previous.flatMap((item) => item.snapshots ?? [{ views: item.views, measuredAt: item.observedAt }]), { views: video.views, measuredAt });
    const scores = buildHotVideoScores({
      target: video,
      channelVideos: baselineCache.get(video.channelId) ?? [],
      subscribers: channels.get(video.channelId)?.subscribers ?? null,
      snapshots,
      now: now.getTime(),
    });
    const category = classifyHotVideo(`${video.title} ${video.channelTitle}`);
    return {
      ...video,
      translatedTitle: "",
      observedAt: measuredAt,
      subscribers: channels.get(video.channelId)?.subscribers ?? null,
      category: category.id,
      categoryName: category.name,
      ...scores,
      streakDays: Math.min(90, previous.length + 1),
      snapshots,
    };
  });
}

async function refreshRegion(items: HotVideoItem[], now: Date) {
  const details = new Map((await videoDetails(items.map((item) => item.id))).map((item) => [youtubeId(item), normalizeVideo(item)]));
  const measuredAt = now.toISOString();
  return items.map((item): HotVideoItem => {
    const latest = details.get(item.id);
    if (!latest) return item;
    const snapshots = appendHotVideoSnapshot(item.snapshots ?? [{ views: item.views, measuredAt: item.observedAt }], { views: latest.views, measuredAt });
    const momentum = youtubeMomentum(snapshots);
    return {
      ...item,
      title: latest.title,
      thumbnail: latest.thumbnail || item.thumbnail,
      observedAt: measuredAt,
      views: latest.views,
      likes: latest.likes,
      comments: latest.comments,
      performance: item.performanceBaselineViews && item.performanceBaselineViews > 0 ? latest.views / item.performanceBaselineViews : null,
      contribution: item.subscribers && item.subscribers > 0 ? latest.views / item.subscribers : null,
      exposureVelocity: momentum.velocity,
      exposureAcceleration: momentum.acceleration,
      momentumState: momentum.state,
      snapshots,
    };
  });
}

async function saveBoard(input: {
  existingId?: string;
  owner: string;
  date: string;
  region: HotVideoRegion;
  items: HotVideoItem[];
  failure: string | null;
  collectedAt: string;
}) {
  const service = createServiceSupabase();
  const quota = hotVideoQuotaEstimate();
  const boardKey = `${input.date}:${input.region}`;
  const payload = {
    title: `${input.date} ${input.region} 핫 비디오`,
    description: "키워드 없이 지역별 반응 상위 영상을 모은 일일 보드",
    status: input.failure ? "blocked" : "done",
    priority: input.failure ? "high" : "normal",
    stage: "핫 비디오",
    team: "콘텐츠",
    brand: "브랜디액션",
    owner_id: input.owner,
    updated_by: input.owner,
    starts_at: `${input.date}T00:00:00.000Z`,
    tags: ["핫비디오", input.region, input.date],
    metadata: {
      packageKind: "hot_video_board",
      boardKey,
      date: input.date,
      region: input.region,
      collectedAt: input.collectedAt,
      items: input.items,
      quota,
      failure: input.failure,
    },
  };
  const write = input.existingId
    ? await service.from("os_records").update(payload).eq("id", input.existingId)
    : await service.from("os_records").insert({ ...payload, record_type: "content_package", created_by: input.owner });
  if (write.error) throw write.error;
}

async function archiveExpiredBoards(owner: string, now: Date) {
  const cutoff = new Date(now.getTime() - 90 * 86_400_000);
  const service = createServiceSupabase();
  const { data, error } = await service.from("os_records")
    .update({ archived_at: now.toISOString(), updated_by: owner })
    .eq("record_type", "content_package")
    .eq("metadata->>packageKind", "hot_video_board")
    .lt("metadata->>date", seoulDate(cutoff))
    .is("archived_at", null)
    .select("id");
  if (error) throw error;
  return data?.length ?? 0;
}

export async function collectHotVideoBoards(now = new Date(), options: { force?: boolean } = {}) {
  const service = createServiceSupabase();
  const owner = await ownerId();
  const date = seoulDate(now);
  const { data: current, error: currentError } = await service.from("os_records")
    .select("id,metadata")
    .eq("record_type", "content_package")
    .eq("metadata->>packageKind", "hot_video_board")
    .eq("metadata->>date", date)
    .is("archived_at", null)
    .order("updated_at", { ascending: false });
  if (currentError) throw currentError;
  const currentByRegion = new Map<string, StoredBoard>();
  for (const board of current ?? []) {
    const region = String(board.metadata?.region ?? "");
    // The query is newest-first. Preserve the newest record if legacy retries left duplicates.
    if (region && !currentByRegion.has(region)) currentByRegion.set(region, board as StoredBoard);
  }
  const { data: prior, error: priorError } = await service.from("os_records")
    .select("id,metadata")
    .eq("record_type", "content_package")
    .eq("metadata->>packageKind", "hot_video_board")
    .lt("metadata->>date", date)
    .is("archived_at", null)
    .order("starts_at", { ascending: false })
    .limit(12);
  if (priorError) throw priorError;
  const result = {
    date,
    regions: 0,
    videos: 0,
    discovered: 0,
    refreshed: 0,
    retentionArchived: 0,
    failures: [] as Array<{ region: string; reason: string }>,
    quota: hotVideoQuotaEstimate(),
  };
  for (const region of HOT_VIDEO_REGIONS) {
    const existing = currentByRegion.get(region);
    const existingItems = Array.isArray(existing?.metadata.items) ? existing.metadata.items as HotVideoItem[] : [];
    try {
      const shouldDiscover = options.force || !existingItems.length || Boolean(existing?.metadata.failure);
      const items = shouldDiscover
        ? await discoverRegion(region, now, [...(prior ?? []), ...(existing ? [existing] : [])] as StoredBoard[])
        : await refreshRegion(existingItems, now);
      await saveBoard({ existingId: existing?.id, owner, date, region, items, failure: null, collectedAt: now.toISOString() });
      result.regions += 1;
      result.videos += items.length;
      if (shouldDiscover) result.discovered += 1; else result.refreshed += 1;
    } catch (error) {
      const reason = error instanceof ApiError ? error.message : "수집 또는 저장 중 오류가 발생했습니다.";
      result.failures.push({ region, reason });
      try {
        await saveBoard({ existingId: existing?.id, owner, date, region, items: existingItems, failure: reason, collectedAt: now.toISOString() });
      } catch {
        console.error(JSON.stringify({ event: "hot_video_failure_record_failed", region }));
      }
    }
  }
  try {
    result.retentionArchived = await archiveExpiredBoards(owner, now);
  } catch {
    result.failures.push({ region: "retention", reason: "90일 보관 정리를 완료하지 못했습니다." });
  }
  return result;
}
