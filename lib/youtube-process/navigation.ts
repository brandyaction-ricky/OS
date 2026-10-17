import { CalendarDays, CheckCircle2, Eye, Film, LayoutGrid, PenLine, Scissors, UploadCloud } from "lucide-react";
import type { NavPage, NavStage } from "../navigation";

// D2: the prototype's side menu has no step numbers, so these pages carry no processNumber (and no legacy process bar).
export const YOUTUBE_V1_PAGES: NavPage[] = [
  { label: "프로젝트", href: "/content/projects", icon: LayoutGrid, aliases: ["유튜브 프로젝트", "새 프로젝트"], ready: true },
  { label: "기획", href: "/content/plan", icon: PenLine, aliases: ["주제", "기획안", "구성안"], ready: true },
  { label: "제작", href: "/content/make", icon: Film, aliases: ["최종본 올리기"], ready: true },
  { label: "최종 검수", href: "/content/final-check", icon: Eye, aliases: ["영상 피드백"], ready: true },
  { label: "업로드", href: "/content/upload", icon: UploadCloud, aliases: ["유튜브 업로드", "설명란"], ready: true },
  // Shorts stay on the existing 숏폼 편집 screen (보류-2); only the menu name changes.
  { label: "쇼츠", href: "/content/shorts", icon: Scissors, ready: true },
  { label: "스케줄", href: "/content/schedule", icon: CalendarDays, aliases: ["업로드 일정", "편집 일정"], ready: true },
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
