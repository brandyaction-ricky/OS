"use client";
import "./youtube-process.css";
import { useSearchParams } from "next/navigation";
import { Info, Lock } from "lucide-react";
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

// 지시서 4장. Each screen is filled in by its own step (T3 ~ T11); until then it says what will appear here.
const SCREENS: Record<YoutubeV1Screen | "shorts", { sub: string; coming: string; step: string }> = {
  shorts: { sub: "올린 롱폼에서 쇼츠 구간을 고르고 SEO 칼럼을 만들어요.", coming: "", step: "" },
  projects: { sub: "영상 한 편이 프로젝트 하나예요. 주제부터 업로드까지 이 안에서 이어져요.", coming: "새 프로젝트 · 최근 프로젝트 6개 · 이름 검색", step: "T3" },
  plan: { sub: "주제 → 기획안 → 구성안 순서로 채워요. 주제와 기획안은 대표 컨펌을 받아요.", coming: "주제 · 기획안(제목 A · B · C, 썸네일 시안) · 구성안(영상 스펙 · 원고)", step: "T3 · T5 · T6" },
  make: { sub: "편집 완료 일정을 정하고 최종본과 최종 썸네일을 올려요.", coming: "편집 완료 일정 · 진행 상태 · 최종본 올리기(버전) · 최종 썸네일 A · B · C", step: "T7" },
  "final-check": { sub: "영상을 멈추고 그 시간에 피드백을 남겨요. 대표 OK가 나야 업로드가 열려요.", coming: "플레이어 시간 · 구간 피드백 · 썸네일 보기 · 버전 · 구성원 의견", step: "T8" },
  upload: { sub: "최종 검수 컨펌 뒤에 열려요. [업로드] 한 번으로 유튜브와 백업이 같이 돼요.", coming: "UTM · SRT · 설명란 · 고정 댓글 · 최종 화면 · 공개 일정", step: "T10" },
  schedule: { sub: "편집 완료일과 업로드 예상일을 한눈에 봐요. 날짜를 끌어서 옮겨요.", coming: "", step: "" },
  confirm: { sub: "기다리는 컨펌을 오래된 순서로 봐요.", coming: "", step: "" },
};

const TITLES: Record<YoutubeV1Screen | "shorts", string> = { projects: "내 영상", plan: "기획", make: "제작", "final-check": "최종 검수", upload: "업로드", shorts: "쇼츠 · 칼럼", schedule: "스케줄", confirm: "컨펌" };

/** 유튜브 공정 v1 screens behind YOUTUBE_V1_ENABLED. */
/**
 * Page width per screen (owner request 2026-10-21: no edge-to-edge pages): forms and lists read at 960px, split screens at 1200px,
 * the player · calendar · topic search at 1360px. The progress line stays full width.
 */
function widthOf(screen: YoutubeV1Screen | "shorts" | "performance", view: string | null) {
  if (screen === "projects") return view === "discover" ? "yp-w-l" : "yp-w-m";
  if (screen === "plan") return !view || view === "topic" ? "yp-w-m" : "";
  if (screen === "make") return "yp-w-m";
  return screen === "final-check" || screen === "schedule" || screen === "performance" ? "yp-w-l" : "";
}

export function YoutubeProcessWorkspace({ screen }: { screen: YoutubeV1Screen | "shorts" | "performance" }) {
  const { accessToken, demo, profile } = useSession();
  const width = widthOf(screen, useSearchParams().get("view"));
  const cls = `yp ui-v2${width ? ` ${width}` : ""}`;
  const canConfirm = useYoutubeCanConfirm(screen === "confirm", accessToken, demo, profile?.role === "admin");
  // 성과 keeps its dashboard, in the same page width and without the guide box.
  if (screen === "performance") return <section className={cls}><ContentPerformanceDashboard youtubeOnly /></section>;
  const info = SCREENS[screen];
  // Owner request 2026-10-21: no "이 화면에서 할 일" guide on these screens; each screen shows what to do itself.
  const header = <header className="page-header"><div className="page-title-group"><h1 className="page-title" data-ui="page-title">{TITLES[screen]}</h1>{info.sub ? <p>{info.sub}</p> : null}</div></header>;
  // 기획 draws the progress line above its header (the line sits at the very top of the screen).
  if (screen === "plan") return <section className={cls}><YoutubePlanScreen header={header} /></section>;
  if (screen === "make") return <section className={cls}><YoutubeMakeScreen header={header} /></section>;
  if (screen === "final-check") return <section className={cls}><YoutubeFinalCheckScreen header={header} /></section>;
  if (screen === "upload") return <section className={cls}><YoutubeUploadScreen header={header} /></section>;
  if (screen === "shorts") return <section className={cls}><YoutubeShortsScreen header={header} /></section>;
  return <section className={cls}>
    {screen === "projects" ? null : header}
    {screen === "projects" ? <YoutubeProjectsScreen />
      : screen === "schedule" ? <YoutubeScheduleScreen />
      : screen === "confirm" && canConfirm === null ? <p className="yp-hint" role="status">권한을 확인하는 중이에요…</p>
      : screen === "confirm" && !canConfirm ? <div className="yp-locked"><Lock size={18} className="yp-i" aria-hidden="true" /><div><b>대표 메뉴예요</b><p>컨펌 목록은 회사 승인자에게만 보여요. 컨펌 대기 중인 단계 화면에서는 누구나 상태를 볼 수 있어요.</p></div></div>
        : screen === "confirm" ? <YoutubeConfirmScreen />
        : <div className="yp-note" role="status"><Info size={16} className="yp-i" aria-hidden="true" /><div><b>이 화면은 만드는 중이에요.</b> 다음 개발 단계({info.step})에서 {info.coming}이 들어와요.</div></div>}
  </section>;
}
