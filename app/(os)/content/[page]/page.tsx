import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { ContentProductionWorkspace } from "@/components/content-production-workspace";
import { ContentStepWorkspace } from "@/components/content-step-workspace";
import { ContentVideoWorkspace } from "@/components/content-video-workspace";
import { PlaceholderPage } from "@/components/placeholder-page";
import { PublishingCalendarWorkspace } from "@/components/publishing-calendar-workspace";
import { ContentRadarWorkspace as ContentTopicsWorkspace } from "@/components/content-radar-workspace";
import { ContentPerformanceDashboard as ContentPerformanceWorkspace } from "@/components/content-performance-dashboard";
import { YoutubeProcessWorkspace } from "@/components/youtube-process-workspace";
import { YoutubeV1Switch } from "@/components/use-youtube-confirm";
import { retiredRoute } from "@/lib/final-routes";
import { findPage, NAV_STAGES } from "@/lib/navigation";
import { canUseContentPlanningHandoff } from "@/lib/content-planning-handoff-gate";
import { canUseContentJevAssist } from "@/lib/content-jev-assist-gate";
import { canUseContentTopicJevAssist } from "@/lib/content-topic-jev-assist-gate";
import { youtubeV1Enabled, youtubeV1Mode } from "@/lib/youtube-process/gate";
import { youtubeV1Screen } from "@/lib/youtube-process/navigation";

// 콘텐츠 screens have their own route so their code is a separate download from the other menus (app/(os)/[stage]/[page]).
type ContentPageProps = { params: Promise<{ page: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> };

export async function generateMetadata({ params, searchParams }: ContentPageProps): Promise<Metadata> {
  const resolved = await params;
  const query = await searchParams;
  const page = findPage(`/content/${resolved.page}?tab=${typeof query.tab === "string" ? query.tab : ""}`);
  return { title: `${page.label} | 브랜디 OS` };
}

export default async function ContentPage({ params }: ContentPageProps) {
  const href = `/content/${(await params).page}`;
  const legacy = retiredRoute(href);
  if (legacy) redirect(legacy);
  const contentPlanningHandoffEnabled = canUseContentPlanningHandoff(process.env);
  const contentJevAssistEnabled = canUseContentJevAssist(process.env);
  const contentTopicJevAssistEnabled = canUseContentTopicJevAssist(process.env);
  const youtubeScreen = youtubeV1Screen(href);
  if (youtubeScreen) {
    if (!youtubeV1Enabled()) redirect("/content/topics");
    return <YoutubeProcessWorkspace screen={youtubeScreen} />;
  }
  // With v1 on, 쇼츠 is a step of the project (the earlier 숏폼 편집 stays at this address when it is off).
  if (href === "/content/shorts" && youtubeV1Enabled()) return <YoutubeV1Switch mode={youtubeV1Mode()} v1={<YoutubeProcessWorkspace screen="shorts" />} old={<ContentStepWorkspace step="shorts" />} />;
  if(href==="/content/production") return <ContentProductionWorkspace showPlanningHandoff={contentPlanningHandoffEnabled} showJevAssist={contentJevAssistEnabled} showTopicJevAssist={contentTopicJevAssistEnabled}/>;
  // Owner decision 2026-10-31 (스타일 점검 E5): with v1 on for everyone, the old step screens that v1 fully replaced open the v1 screen
  // that does the same job. 발행·업로드 and 유튜브 관리 stay: the home cells still use their 게시 확인 · 댓글.
  const replaced: Record<string, string> = { "/content/topics": "/content/projects?view=discover", "/content/scripts": "/content/projects", "/content/video": "/content/projects", "/content/packages": "/content/projects" };
  if (replaced[href] && youtubeV1Mode() === "all") redirect(replaced[href]);
  if (href === "/content/topics") return <ContentTopicsWorkspace showPlanningHandoff={contentPlanningHandoffEnabled} showTopicJevAssist={contentTopicJevAssistEnabled} />;
  if (href === "/content/scripts") return <ContentStepWorkspace step="scripts" showPlanningHandoff={contentPlanningHandoffEnabled} />;
  if (href === "/content/video") return <ContentVideoWorkspace />;
  if (href === "/content/packages") return <ContentStepWorkspace step="packages" showJevAssist={contentJevAssistEnabled} />;
  if (href === "/content/shorts") return <ContentStepWorkspace step="shorts" />;
  if (href === "/content/youtube") return <ContentStepWorkspace step="youtube" />;
  if (href === "/content/publishing") return <ContentStepWorkspace step="youtube" youtubeView="publish" />;
  if (href === "/content/automation") redirect("/automation/topics");
  if (href === "/content/review") redirect("/automation/review");
  if (href === "/content/calendar") return <PublishingCalendarWorkspace />;
  if (href === "/content/performance") return youtubeV1Enabled() ? <YoutubeV1Switch mode={youtubeV1Mode()} v1={<YoutubeProcessWorkspace screen="performance" />} old={<ContentPerformanceWorkspace youtubeOnly />} /> : <ContentPerformanceWorkspace youtubeOnly />;
  if (href === "/content/comments") redirect("/automation/performance?tab=comments");
  const stage = NAV_STAGES.find((item) => item.pages.some((page) => page.href === href));
  return <PlaceholderPage title={stage?.pages.find((item) => item.href === href)?.label ?? "기능 준비"} stage={stage?.label ?? "OS"} />;
}
