"use client";
import "./youtube-process.css";
import { useSearchParams } from "next/navigation";
import { Lock } from "lucide-react";
import type { YoutubeV1Screen } from "@/lib/youtube-process/navigation";
import { useSession } from "./session-provider";
import { useYoutubeCanConfirm } from "./use-youtube-confirm";
import { YoutubeConfirmScreen } from "./youtube-process-confirm";
import { YoutubePlanScreen } from "./youtube-process-plan";
import { YoutubeProjectsScreen } from "./youtube-process-projects";
import { YoutubeMakeScreen } from "./youtube-process-make";
import { YoutubeFinalCheckScreen } from "./youtube-process-final";
import { YoutubeUploadScreen } from "./youtube-process-upload";
import { YoutubeScheduleScreen } from "./youtube-process-schedule";
import { YoutubeShortsScreen } from "./youtube-process-shorts";
import { ContentPerformanceDashboard } from "./content-performance-dashboard";
import { YoutubeLinksScreen } from "./youtube-process-links";
import { CardGrindScreen } from "./card-grind";
import { YoutubeVoiceDictionaryScreen } from "./youtube-process-voice-dictionary";

// The step screens show this header only while they load, so only 스케줄 · 컨펌 carry a line under the title.
const SUB: Partial<Record<YoutubeV1Screen | "shorts", string>> = {
  schedule: "영상별 업로드 예정일을 배치합니다. 왼쪽 목록을 달력으로 끌어 놓으세요.",
  confirm: "PD가 컨펌한 것을 보고 노트를 남겨요.",
  links: "회사 공용 선택값으로 UTM 링크를 만들어 링크 대장에 남기고, 마이인 단축 링크로 줄여요.",
  "voice-dictionary": "영상 만드는 컴퓨터가 음성을 만들 때마다 읽는 사전이에요.",
  "card-canon": "같은 시험 묶음을 지금 정본으로 다시 뽑고, 평가표로 채점해 정본 버전끼리 비교해요.",
};

const TITLES: Record<YoutubeV1Screen | "shorts", string> = { projects: "내 영상", plan: "기획", make: "제작", "final-check": "최종 검토", upload: "업로드", shorts: "쇼츠 · 칼럼", schedule: "콘텐츠 일정", confirm: "컨펌", links: "링크관리", "voice-dictionary": "음성 사전", "card-canon": "카드뉴스 정본 다듬기" };

/** 유튜브 공정 v1 screens behind YOUTUBE_V1_ENABLED. */
/**
 * Page width per screen (owner request 2026-10-21: no edge-to-edge pages): forms and lists read at 960px, split screens at 1200px,
 * the player · calendar · topic search at 1360px. The progress line stays full width.
 */
function widthOf(screen: YoutubeV1Screen | "shorts" | "performance", view: string | null) {
  if (screen === "projects") return view === "discover" ? "yp-w-l" : "yp-w-m";
  if (screen === "plan") return !view || view === "topic" ? "yp-w-m" : "";
  if (screen === "make" || screen === "links" || screen === "voice-dictionary") return "yp-w-m";
  return screen === "final-check" || screen === "schedule" || screen === "performance" || screen === "card-canon" ? "yp-w-l" : "";
}

export function YoutubeProcessWorkspace({ screen }: { screen: YoutubeV1Screen | "shorts" | "performance" }) {
  const { accessToken, demo, profile } = useSession();
  const width = widthOf(screen, useSearchParams().get("view"));
  const cls = `yp ui-v2${width ? ` ${width}` : ""}`;
  const canConfirm = useYoutubeCanConfirm(screen === "confirm", accessToken, demo, profile?.role === "admin");
  // 성과 keeps its dashboard, in the same page width and without the guide box.
  if (screen === "performance") return <section className={cls}><ContentPerformanceDashboard youtubeOnly /></section>;
  const sub = SUB[screen];
  // Owner request 2026-10-21: no "이 화면에서 할 일" guide on these screens; each screen shows what to do itself.
  const header = <header className="page-header"><div className="page-title-group"><h1 className="page-title" data-ui="page-title">{TITLES[screen]}</h1>{sub ? <p>{sub}</p> : null}</div></header>;
  // 기획 draws the progress line above its header (the line sits at the very top of the screen).
  if (screen === "plan") return <section className={cls}><YoutubePlanScreen header={header} /></section>;
  if (screen === "make") return <section className={cls}><YoutubeMakeScreen header={header} /></section>;
  if (screen === "final-check") return <section className={cls}><YoutubeFinalCheckScreen header={header} /></section>;
  if (screen === "upload") return <section className={cls}><YoutubeUploadScreen header={header} /></section>;
  if (screen === "shorts") return <section className={cls}><YoutubeShortsScreen header={header} /></section>;
  return <section className={cls}>
    {screen === "projects" || screen === "schedule" ? null : header}
    {screen === "projects" ? <YoutubeProjectsScreen />
      : screen === "schedule" ? <YoutubeScheduleScreen header={header} />
      : screen === "links" ? <YoutubeLinksScreen />
      : screen === "card-canon" ? <CardGrindScreen />
      : screen === "voice-dictionary" ? <YoutubeVoiceDictionaryScreen />
      : screen === "confirm" && canConfirm === null ? <p className="yp-hint" role="status">권한을 확인하는 중이에요…</p>
      : screen === "confirm" && !canConfirm ? <div className="yp-locked"><Lock size={18} className="yp-i" aria-hidden="true" /><div><b>대표만 볼 수 있어요</b><p>컨펌 상태는 각 영상 화면에서 볼 수 있어요.</p></div></div>
        : screen === "confirm" ? <YoutubeConfirmScreen />
        : null}
  </section>;
}
