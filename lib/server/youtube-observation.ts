import { ApiError } from "@/lib/http";
import { createServiceSupabase } from "@/lib/supabase/server";
import { outlierBaseline, youtubeAgeCheckpoint, youtubeFormatBucket, youtubeMomentum, type BaselineVideo, type YoutubeViewSnapshot } from "@/lib/youtube-outliers";

type YoutubeItem = {
  id?: string;
  snippet?: { channelId?: string; channelTitle?: string; title?: string; publishedAt?: string; categoryId?: string; liveBroadcastContent?: string; thumbnails?: { high?: { url?: string }; medium?: { url?: string } } };
  statistics?: { viewCount?: string; likeCount?: string; commentCount?: string };
  contentDetails?: { duration?: string; relatedPlaylists?: { uploads?: string }; videoId?: string };
  liveStreamingDetails?: unknown;
};

type TrackedChannel = { channelId: string; title: string; ownerId: string };

function durationSeconds(value = "") {
  const match = value.match(/^PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/);
  return match ? Number(match[1] ?? 0) * 3600 + Number(match[2] ?? 0) * 60 + Number(match[3] ?? 0) : 0;
}

export function normalizeObservedVideo(item: YoutubeItem): BaselineVideo & { channelTitle: string; likes: number; comments: number; thumbnail: string } {
  return {
    id: item.id ?? "", channelId: item.snippet?.channelId ?? "", channelTitle: item.snippet?.channelTitle ?? "YouTube 채널",
    title: item.snippet?.title ?? "제목 없음", publishedAt: item.snippet?.publishedAt ?? "", views: Number(item.statistics?.viewCount ?? 0),
    likes: Number(item.statistics?.likeCount ?? 0), comments: Number(item.statistics?.commentCount ?? 0), durationSeconds: durationSeconds(item.contentDetails?.duration),
    live: !!item.liveStreamingDetails || ["live", "upcoming"].includes(item.snippet?.liveBroadcastContent ?? ""), categoryId: item.snippet?.categoryId,
    thumbnail: item.snippet?.thumbnails?.high?.url ?? item.snippet?.thumbnails?.medium?.url ?? "",
  };
}

async function youtube(resource: string, parameters: Record<string, string>) {
  const key = process.env.YOUTUBE_API_KEY?.trim();
  if (!key) throw new ApiError(503, "YOUTUBE_NOT_CONFIGURED", "YouTube Data API 연결이 필요합니다.");
  const response = await fetch(`https://www.googleapis.com/youtube/v3/${resource}?${new URLSearchParams({ ...parameters, key })}`, { cache: "no-store", signal: AbortSignal.timeout(15_000) });
  const body = await response.json().catch(() => ({})) as { items?: YoutubeItem[]; error?: { message?: string } };
  if (!response.ok) throw new ApiError(502, "YOUTUBE_OBSERVATION_FAILED", "관찰 채널 데이터를 가져오지 못했습니다.", body.error?.message);
  return body.items ?? [];
}

async function trackedChannels(): Promise<TrackedChannel[]> {
  const service = createServiceSupabase();
  const [{ data: records, error: recordError }, { data: connections, error: connectionError }] = await Promise.all([
    service.from("os_records").select("title,owner_id,metadata").eq("record_type", "content_topic").eq("metadata->>studioKind", "channel").is("archived_at", null),
    service.from("os_youtube_connections").select("owner_id,channel_id,channel_title"),
  ]);
  if (recordError || connectionError) throw new ApiError(500, "YOUTUBE_CHANNELS_READ_FAILED", "관찰 채널 목록을 읽지 못했습니다.", recordError?.message ?? connectionError?.message);
  const values: TrackedChannel[] = [
    ...(records ?? []).map((row) => ({ channelId: String(row.metadata?.channelId ?? ""), title: row.title, ownerId: row.owner_id })),
    ...(connections ?? []).map((row) => ({ channelId: row.channel_id, title: row.channel_title, ownerId: row.owner_id })),
  ].filter((item) => item.channelId && item.ownerId);
  return [...new Map(values.map((item) => [item.channelId, item])).values()];
}

async function channelVideos(channel: TrackedChannel) {
  const details = (await youtube("channels", { part: "contentDetails", id: channel.channelId }))[0];
  const playlistId = details?.contentDetails?.relatedPlaylists?.uploads;
  if (!playlistId) return [];
  const uploads = await youtube("playlistItems", { part: "contentDetails", playlistId, maxResults: "50" });
  const ids = uploads.map((item) => item.contentDetails?.videoId).filter(Boolean).join(",");
  if (!ids) return [];
  return (await youtube("videos", { part: "snippet,statistics,contentDetails,liveStreamingDetails", id: ids })).map(normalizeObservedVideo).filter((video) => video.id);
}

export async function observeYoutubeChannels(now = new Date()) {
  const service = createServiceSupabase();
  const channels = await trackedChannels();
  const measuredAt = now.toISOString();
  const day = measuredAt.slice(0, 10);
  const hour = measuredAt.slice(0, 13);
  const counts = { channels: channels.length, videos: 0, metricsCreated: 0, metricsUpdated: 0, outliersCreated: 0, risingCreated: 0, failures: 0 };
  for (const channel of channels) {
    try {
      const videos = await channelVideos(channel);
      counts.videos += videos.length;
      const observationKeys = videos.map((video) => `${channel.channelId}:${video.id}:${hour}`);
      const { data: existingMetrics, error: metricReadError } = observationKeys.length ? await service.from("os_records").select("id,metadata").eq("record_type", "content_metric").in("metadata->>observationKey", observationKeys).is("archived_at", null) : { data: [], error: null };
      if (metricReadError) throw metricReadError;
      const metricsByKey = new Map((existingMetrics ?? []).map((record) => [String(record.metadata?.observationKey ?? ""), record.id]));
      const ids = videos.map((video) => video.id);
      const { data: priorMetrics, error: priorMetricError } = ids.length ? await service.from("os_records").select("metadata,starts_at").eq("record_type", "content_metric").eq("metadata->>dataSource", "youtube_data_api").in("metadata->>contentId", ids).is("archived_at", null).order("starts_at", { ascending: false }).limit(Math.min(5_000, ids.length * 3)) : { data: [], error: null };
      if (priorMetricError) throw priorMetricError;
      const history = new Map<string, YoutubeViewSnapshot[]>();
      for (const record of priorMetrics ?? []) {
        const contentId = String(record.metadata?.contentId ?? "");
        if (!contentId) continue;
        const values = history.get(contentId) ?? [];
        if (values.length < 2) values.push({ views: Number(record.metadata?.views ?? 0), measuredAt: String(record.metadata?.measuredAt ?? "") });
        history.set(contentId, values);
      }
      for (const video of videos) {
        const observationKey = `${channel.channelId}:${video.id}:${hour}`;
        const momentum = youtubeMomentum([...(history.get(video.id) ?? []), { views: video.views, measuredAt }]);
        const metadata = {
          observationKey, contentId: video.id, channelId: channel.channelId, channelTitle: video.channelTitle || channel.title,
          platform: "YouTube", dataSource: "youtube_data_api", metricMode: "cumulative", measuredAt,
          views: video.views, likes: video.likes, comments: video.comments, durationSeconds: video.durationSeconds,
          formatBucket: youtubeFormatBucket(video.durationSeconds), ageCheckpoint: youtubeAgeCheckpoint(video.publishedAt, now.getTime()), publishedAt: video.publishedAt, momentum,
        };
        const payload = { title: video.title, description: "추적 채널 시간별 자동 측정", status: "measuring", priority: "normal", stage: "채널 자동 수집", team: "콘텐츠", brand: "브랜디액션", owner_id: channel.ownerId, updated_by: channel.ownerId, starts_at: measuredAt, metric_current: video.views, metric_unit: "조회", source_url: `https://www.youtube.com/watch?v=${video.id}`, tags: ["YouTube", "자동측정", youtubeAgeCheckpoint(video.publishedAt, now.getTime())].filter(Boolean), metadata };
        const existingId = metricsByKey.get(observationKey);
        const result = existingId ? await service.from("os_records").update(payload).eq("id", existingId) : await service.from("os_records").insert({ ...payload, record_type: "content_metric", created_by: channel.ownerId });
        if (result.error) throw result.error;
        if (existingId) counts.metricsUpdated += 1; else counts.metricsCreated += 1;
      }
      const existingOutliers = new Set<string>();
      if (ids.length) {
        const { data } = await service.from("os_records").select("metadata").eq("record_type", "content_topic").eq("metadata->>studioKind", "outlier").in("metadata->>youtubeId", ids).is("archived_at", null);
        for (const record of data ?? []) existingOutliers.add(String(record.metadata?.youtubeId ?? ""));
      }
      for (const video of videos) {
        const baseline = outlierBaseline(video, videos, now.getTime());
        if (!baseline.outlier || existingOutliers.has(video.id)) continue;
        const { error } = await service.from("os_records").insert({
          record_type: "content_topic", title: video.title, description: `${video.channelTitle || channel.title} 추적 채널에서 자동 발견한 아웃라이어`, status: "review", priority: "high", stage: "아웃라이어 근거", brand: "브랜디액션", team: "콘텐츠", owner_id: channel.ownerId, created_by: channel.ownerId, updated_by: channel.ownerId,
          source_url: `https://www.youtube.com/watch?v=${video.id}`, metric_current: video.views, metric_unit: "조회", tags: ["아웃라이어", "추적채널", "자동수집"],
          metadata: { studioKind: "outlier", discoverySource: "tracked_channel", youtubeId: video.id, channelId: channel.channelId, channelTitle: video.channelTitle || channel.title, thumbnail: video.thumbnail, publishedAt: video.publishedAt, views: video.views, likes: video.likes, comments: video.comments, baseline, observedAt: now.toISOString() },
        });
        if (error) throw error;
        existingOutliers.add(video.id); counts.outliersCreated += 1;
      }
      const risingKeys = videos.map((video) => `${channel.channelId}:${video.id}:${day}`);
      const { data: existingRising } = risingKeys.length ? await service.from("os_records").select("metadata").eq("record_type", "content_topic").eq("metadata->>discoverySource", "rising_channel").in("metadata->>risingKey", risingKeys).is("archived_at", null) : { data: [] };
      const savedRising = new Set((existingRising ?? []).map((record) => String(record.metadata?.risingKey ?? "")));
      for (const video of videos) {
        const momentum = youtubeMomentum([...(history.get(video.id) ?? []), { views: video.views, measuredAt }]);
        const risingKey = `${channel.channelId}:${video.id}:${day}`;
        if (!momentum.rising || savedRising.has(risingKey)) continue;
        const { error } = await service.from("os_records").insert({
          record_type: "content_topic", title: video.title, description: `${video.channelTitle || channel.title}에서 속도·가속도가 함께 상승한 조기 후보`, status: "review", priority: "high", stage: "조기 급상승 근거", brand: "브랜디액션", team: "콘텐츠", owner_id: channel.ownerId, created_by: channel.ownerId, updated_by: channel.ownerId,
          source_url: `https://www.youtube.com/watch?v=${video.id}`, metric_current: video.views, metric_unit: "조회", tags: ["조기급상승", "추적채널", "사람검토필수"],
          metadata: { studioKind: "outlier", discoverySource: "rising_channel", risingKey, youtubeId: video.id, channelId: channel.channelId, channelTitle: video.channelTitle || channel.title, thumbnail: video.thumbnail, publishedAt: video.publishedAt, views: video.views, momentum, observedAt: measuredAt },
        });
        if (error) throw error;
        savedRising.add(risingKey); counts.risingCreated += 1;
      }
    } catch { counts.failures += 1; }
  }
  return counts;
}
