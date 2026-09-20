import { ApiError } from "@/lib/http";
import { buildHotVideoScores, classifyHotVideo, HOT_VIDEO_REGIONS, hotVideoFormat, hotVideoQuotaEstimate, type HotVideoItem, type HotVideoRegion } from "@/lib/hot-video-board";
import { createServiceSupabase } from "@/lib/supabase/server";
import type { YoutubeViewSnapshot } from "@/lib/youtube-outliers";

type YoutubeItem = {
  id?: string | { videoId?: string };
  snippet?: { channelId?: string; channelTitle?: string; title?: string; publishedAt?: string; thumbnails?: { high?: { url?: string }; medium?: { url?: string } } };
  statistics?: { viewCount?: string; subscriberCount?: string; hiddenSubscriberCount?: boolean };
  contentDetails?: { duration?: string };
};

function durationSeconds(value = "") {
  const match = value.match(/^PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/);
  return match ? Number(match[1] ?? 0) * 3600 + Number(match[2] ?? 0) * 60 + Number(match[3] ?? 0) : 0;
}

async function youtube(resource: string, parameters: Record<string, string>) {
  const key = process.env.YOUTUBE_API_KEY?.trim();
  if (!key) throw new ApiError(503, "YOUTUBE_NOT_CONFIGURED", "YouTube Data API 연결이 필요합니다.");
  const response = await fetch(`https://www.googleapis.com/youtube/v3/${resource}?${new URLSearchParams({ ...parameters, key })}`, { cache: "no-store", signal: AbortSignal.timeout(20_000) });
  const body = await response.json().catch(() => ({})) as { items?: YoutubeItem[]; error?: { message?: string } };
  if (!response.ok) throw new ApiError(response.status === 403 ? 429 : 502, response.status === 403 ? "YOUTUBE_QUOTA_EXCEEDED" : "YOUTUBE_HOT_BOARD_FAILED", response.status === 403 ? "YouTube 할당량을 초과해 오늘 보드를 수집하지 못했습니다." : "핫 비디오 데이터를 불러오지 못했습니다.", body.error?.message);
  return body.items ?? [];
}

async function ownerId() {
  const service = createServiceSupabase();
  const { data, error } = await service.from("os_profiles").select("id").eq("is_active", true).eq("role", "admin").order("created_at").limit(1).maybeSingle();
  if (error || !data?.id) throw new ApiError(500, "HOT_VIDEO_OWNER_MISSING", "핫 비디오 보드를 저장할 관리자 계정을 찾지 못했습니다.", error?.message);
  return data.id as string;
}

async function collectRegion(region: HotVideoRegion, now: Date, previous: Map<string, HotVideoItem[]>) {
  const publishedAfter = new Date(now.getTime() - 7 * 86_400_000).toISOString();
  const [popular, recent] = await Promise.all([
    youtube("videos", { part: "snippet,statistics,contentDetails", chart: "mostPopular", regionCode: region, maxResults: "50" }),
    youtube("search", { part: "snippet", type: "video", regionCode: region, publishedAfter, order: "viewCount", maxResults: "50" }),
  ]);
  const recentIds = recent.map((item) => typeof item.id === "object" ? item.id.videoId : item.id).filter(Boolean) as string[];
  const recentDetails = recentIds.length ? await youtube("videos", { part: "snippet,statistics,contentDetails", id: recentIds.join(",") }) : [];
  const videos = [...new Map([...popular, ...recentDetails].map((item) => [String(typeof item.id === "object" ? item.id.videoId : item.id), item])).values()];
  const channelIds = [...new Set(videos.map((item) => item.snippet?.channelId).filter(Boolean))] as string[];
  const channels = channelIds.length ? await youtube("channels", { part: "statistics", id: channelIds.join(",") }) : [];
  const subscribers = new Map(channels.map((item) => [
    String(typeof item.id === "object" ? item.id.videoId : item.id),
    item.statistics?.hiddenSubscriberCount ? null : Number(item.statistics?.subscriberCount ?? 0) || null,
  ]));
  const previousItems = [...previous.values()].flat();
  return videos.map((item): HotVideoItem => {
    const id = String(typeof item.id === "object" ? item.id.videoId : item.id);
    const title = item.snippet?.title ?? "제목 없음";
    const category = classifyHotVideo(`${title} ${item.snippet?.channelTitle ?? ""}`);
    const duration = durationSeconds(item.contentDetails?.duration);
    const history = previousItems.filter((prior) => prior.id === id).slice(0, 2).sort((a, b) => (a.observedAt ?? a.publishedAt).localeCompare(b.observedAt ?? b.publishedAt));
    const snapshots: YoutubeViewSnapshot[] = [...history.map((prior) => ({ views: prior.views, measuredAt: prior.observedAt ?? prior.publishedAt })), { views: Number(item.statistics?.viewCount ?? 0), measuredAt: now.toISOString() }];
    const channelId = item.snippet?.channelId ?? "";
    const recentChannelViews = videos.filter((candidate) => candidate.snippet?.channelId === channelId && candidate !== item).map((candidate) => Number(candidate.statistics?.viewCount ?? 0)).filter((views) => views > 0);
    const scores = buildHotVideoScores({ views: Number(item.statistics?.viewCount ?? 0), subscribers: subscribers.get(channelId) ?? null, recentChannelViews, snapshots });
    return { id, title, translatedTitle: "", channelId, channelTitle: item.snippet?.channelTitle ?? "", thumbnail: item.snippet?.thumbnails?.high?.url ?? item.snippet?.thumbnails?.medium?.url ?? "", publishedAt: item.snippet?.publishedAt ?? now.toISOString(), observedAt: now.toISOString(), durationSeconds: duration, views: Number(item.statistics?.viewCount ?? 0), subscribers: subscribers.get(channelId) ?? null, category: category.id, categoryName: category.name, ...scores, streakDays: Math.max(1, history.length + 1) };
  }).filter((item) => hotVideoFormat(item.durationSeconds) !== "excluded").sort((a, b) => b.views - a.views).slice(0, 80);
}

export async function collectHotVideoBoards(now = new Date()) {
  const service = createServiceSupabase();
  const owner = await ownerId();
  const date = now.toISOString().slice(0, 10);
  const { data: prior, error: priorError } = await service.from("os_records").select("metadata").eq("record_type", "content_package").eq("metadata->>packageKind", "hot_video_board").lt("metadata->>date", date).order("created_at", { ascending: false }).limit(6);
  if (priorError) throw priorError;
  const previous = new Map((prior ?? []).map((row) => [`${String(row.metadata?.region)}:${String(row.metadata?.date)}`, (row.metadata?.items ?? []) as HotVideoItem[]]));
  const result = { date, regions: 0, videos: 0, failures: [] as Array<{ region: string; reason: string }>, quota: hotVideoQuotaEstimate(HOT_VIDEO_REGIONS.length) };
  for (const region of HOT_VIDEO_REGIONS) {
    try {
      const items = await collectRegion(region, now, previous);
      const boardKey = `${date}:${region}`;
      const payload = { title: `${date} ${region} 핫 비디오`, description: "키워드 없이 지역별 반응 상위 영상을 모은 일일 보드", status: "done", priority: "normal", stage: "핫 비디오", team: "콘텐츠", brand: "브랜디액션", owner_id: owner, updated_by: owner, starts_at: `${date}T00:00:00.000Z`, tags: ["핫비디오", region, date], metadata: { packageKind: "hot_video_board", boardKey, date, region, collectedAt: now.toISOString(), items, quota: result.quota, failure: null } };
      const { data: existing } = await service.from("os_records").select("id").eq("record_type", "content_package").eq("metadata->>boardKey", boardKey).is("archived_at", null).maybeSingle();
      const write = existing?.id ? await service.from("os_records").update(payload).eq("id", existing.id) : await service.from("os_records").insert({ ...payload, record_type: "content_package", created_by: owner });
      if (write.error) throw write.error;
      result.regions += 1; result.videos += items.length;
    } catch (error) {
      result.failures.push({ region, reason: error instanceof ApiError ? error.message : "수집 또는 저장 중 오류가 발생했습니다." });
    }
  }
  return result;
}
