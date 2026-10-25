import { BarChart3, CalendarDays, CheckCircle2, Eye, Film, LayoutGrid, PenLine, Scissors, UploadCloud } from "lucide-react";
import type { NavPage, NavStage } from "../navigation";

// Owner decision 2026-10-21: the side menu is 내 영상 · 스케줄 · 성과; the steps live inside a video (its progress line), so nobody
// has to know which step menu to open. No processNumber (no legacy process bar).
export const YOUTUBE_V1_PAGES: NavPage[] = [
  { label: "내 영상", href: "/content/projects", icon: LayoutGrid, aliases: ["프로젝트", "유튜브 프로젝트", "새 영상"], ready: true },
  { label: "스케줄", href: "/content/schedule", icon: CalendarDays, aliases: ["업로드 일정", "편집 일정"], ready: true },
  { label: "성과", href: "/content/performance", icon: BarChart3, aliases: ["영상 성과", "조회수", "CTR"], ready: true },
];
/** The steps of one video: found by address (titles, breadcrumbs) and shown under 내 영상, never as their own menu. */
export const YOUTUBE_V1_STEP_PAGES: NavPage[] = [
  { label: "기획", href: "/content/plan", navHref: "/content/projects", icon: PenLine, aliases: ["주제", "기획안", "구성안"], ready: true },
  { label: "제작", href: "/content/make", navHref: "/content/projects", icon: Film, aliases: ["최종본 올리기"], ready: true },
  { label: "최종 검수", href: "/content/final-check", navHref: "/content/projects", icon: Eye, aliases: ["영상 피드백"], ready: true },
  { label: "업로드", href: "/content/upload", navHref: "/content/projects", icon: UploadCloud, aliases: ["유튜브 업로드", "설명란"], ready: true },
  { label: "쇼츠 · 칼럼", href: "/content/shorts", navHref: "/content/projects", icon: Scissors, aliases: ["쇼츠", "SEO 칼럼", "칼럼"], ready: true },
];
/** 대표 메뉴 › 컨펌: shown only to the company approver (D1). */
export const YOUTUBE_V1_CONFIRM_PAGE: NavPage = { label: "컨펌", href: "/content/confirm", icon: CheckCircle2, aliases: ["대표 메뉴", "대표 컨펌"], ready: true };
export const YOUTUBE_V1_CEO_STAGE: NavStage = { id: "ceo", label: "대표 메뉴", icon: CheckCircle2, href: YOUTUBE_V1_CONFIRM_PAGE.href, pages: [YOUTUBE_V1_CONFIRM_PAGE] };

export const YOUTUBE_V1_SCREENS = {
  "/content/projects": "projects",
  "/content/plan": "plan",
  "/content/make": "make",
  "/content/final-check": "final-check",
  "/content/upload": "upload",
  "/content/schedule": "schedule",
  "/content/confirm": "confirm",
} as const;
export type YoutubeV1Screen = (typeof YOUTUBE_V1_SCREENS)[keyof typeof YOUTUBE_V1_SCREENS];
/** The seven new routes; /content/shorts is the existing screen and is not listed. */
export const YOUTUBE_V1_HREFS = Object.keys(YOUTUBE_V1_SCREENS);
export const youtubeV1Screen = (href: string): YoutubeV1Screen | null =>
  (YOUTUBE_V1_SCREENS as Record<string, YoutubeV1Screen>)[href] ?? null;
