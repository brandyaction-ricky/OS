"use client";
import "./youtube-process.css";
import { Info, Lock } from "lucide-react";
import type { YoutubeV1Screen } from "@/lib/youtube-process/navigation";
import { PageTitle } from "./page-title";
import { useSession } from "./session-provider";
import { useYoutubeCanConfirm } from "./use-youtube-confirm";
import { YoutubeConfirmScreen } from "./youtube-process-confirm";
import { YoutubePlanScreen } from "./youtube-process-plan";
import { YoutubeProjectsScreen } from "./youtube-process-projects";
import { YoutubeMakeScreen } from "./youtube-process-make";
import { YoutubeFinalCheckScreen } from "./youtube-process-final";
import { YoutubeUploadScreen } from "./youtube-process-upload";
import { YoutubeScheduleScreen } from "./youtube-process-schedule";

// 지시서 4장. Each screen is filled in by its own step (T3 ~ T11); until then it says what will appear here.
const SCREENS: Record<YoutubeV1Screen, { sub: string; coming: string; step: string }> = {
  projects: { sub: "영상 한 편이 프로젝트 하나예요. 주제부터 업로드까지 이 안에서 이어져요.", coming: "새 프로젝트 · 최근 프로젝트 6개 · 이름 검색", step: "T3" },
  plan: { sub: "주제 → 기획안 → 구성안 순서로 채워요. 주제와 기획안은 대표 컨펌을 받아요.", coming: "주제 · 기획안(제목 A · B · C, 썸네일 시안) · 구성안(영상 스펙 · 원고)", step: "T3 · T5 · T6" },
  make: { sub: "편집 완료 일정을 정하고 최종본과 최종 썸네일을 올려요.", coming: "편집 완료 일정 · 진행 상태 · 최종본 올리기(버전) · 최종 썸네일 A · B · C", step: "T7" },
  "final-check": { sub: "영상을 멈추고 그 시간에 피드백을 남겨요. 대표 OK가 나야 업로드가 열려요.", coming: "플레이어 시간 · 구간 피드백 · 썸네일 보기 · 버전 · 구성원 의견", step: "T8" },
  upload: { sub: "최종 검수 컨펌 뒤에 열려요. [업로드] 한 번으로 유튜브와 백업이 같이 돼요.", coming: "UTM · SRT · 설명란 · 고정 댓글 · 최종 화면 · 공개 일정", step: "T10" },
  schedule: { sub: "모든 프로젝트의 편집 완료 · 업로드(예상) · 컨펌 대기 · 피드백 기한을 달력으로 봐요.", coming: "이번 주 · 이번 달 달력 · 끌어서 날짜 옮기기 · 현황 카드", step: "T11" },
  confirm: { sub: "주제 · 기획안 · 최종 검수 컨펌을 모아 봐요. OK · 수정 요청 · 보류 중에 고르기만 하면 돼요.", coming: "컨펌 대기 · 내가 처리한 것 · 보류함", step: "T4" },
};

/** 유튜브 공정 v1 screens behind YOUTUBE_V1_ENABLED. */
export function YoutubeProcessWorkspace({ screen }: { screen: YoutubeV1Screen }) {
  const { accessToken, demo, profile } = useSession();
  const canConfirm = useYoutubeCanConfirm(screen === "confirm", accessToken, demo, profile?.role === "admin");
  const info = SCREENS[screen];
  const header = <header className="page-header"><div className="page-title-group"><PageTitle /><p>{info.sub}</p></div></header>;
  // 기획 draws the progress line above its header (the line sits at the very top of the screen).
  if (screen === "plan") return <section className="yp ui-v2"><YoutubePlanScreen header={header} /></section>;
  if (screen === "make") return <section className="yp ui-v2"><YoutubeMakeScreen header={header} /></section>;
  if (screen === "final-check") return <section className="yp ui-v2"><YoutubeFinalCheckScreen header={header} /></section>;
  if (screen === "upload") return <section className="yp ui-v2"><YoutubeUploadScreen header={header} /></section>;
  return <section className="yp ui-v2">
    {header}
    {screen === "projects" ? <YoutubeProjectsScreen />
      : screen === "schedule" ? <YoutubeScheduleScreen />
      : screen === "confirm" && canConfirm === null ? <p className="yp-hint" role="status">권한을 확인하는 중이에요…</p>
      : screen === "confirm" && !canConfirm ? <div className="yp-locked"><Lock size={18} className="yp-i" aria-hidden="true" /><div><b>대표 메뉴예요</b><p>컨펌 목록은 회사 승인자에게만 보여요. 컨펌 대기 중인 단계 화면에서는 누구나 상태를 볼 수 있어요.</p></div></div>
        : screen === "confirm" ? <YoutubeConfirmScreen />
        : <div className="yp-note" role="status"><Info size={16} className="yp-i" aria-hidden="true" /><div><b>이 화면은 만드는 중이에요.</b> 다음 개발 단계({info.step})에서 {info.coming}이 들어와요.</div></div>}
  </section>;
}
