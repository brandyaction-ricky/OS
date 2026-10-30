import { AtSign, BarChart3, CalendarDays, CheckCircle2, Eye, Film, GalleryHorizontal, LayoutGrid, Lightbulb, Link2, Megaphone, Mic, PenLine, Radar, Scissors, Settings, Smartphone, UploadCloud, Youtube } from "lucide-react";
import type { NavPage, NavStage } from "../navigation";

// Owner decision 2026-10-21: the side menu is 내 영상 · 스케줄 · 성과; the steps live inside a video (its progress line), so nobody
// has to know which step menu to open. No processNumber (no legacy process bar).
export const YOUTUBE_V1_PAGES: NavPage[] = [
  { label: "내 영상", href: "/content/projects", icon: LayoutGrid, aliases: ["프로젝트", "유튜브 프로젝트", "새 영상"], ready: true },
  { label: "스케줄", href: "/content/schedule", icon: CalendarDays, aliases: ["업로드 일정", "편집 일정"], ready: true },
  { label: "성과", href: "/content/performance", icon: BarChart3, aliases: ["영상 성과", "조회수", "CTR"], ready: true },
  // Owner decision 2026-10-26: any address shortened on the MYIN site, any time.
  { label: "링크관리", href: "/content/links", icon: Link2, aliases: ["단축 링크", "단축링크", "단축 URL", "링크 줄이기", "UTM", "UTM 링크", "링크 대장", "마이인 링크"], ready: true },
];
/** The steps of one video: found by address (titles, breadcrumbs) and shown under 내 영상, never as their own menu. */
export const YOUTUBE_V1_STEP_PAGES: NavPage[] = [
  { label: "기획", href: "/content/plan", navHref: "/content/projects", icon: PenLine, aliases: ["주제", "기획안", "구성안"], ready: true },
  { label: "제작", href: "/content/make", navHref: "/content/projects", icon: Film, aliases: ["최종본 올리기"], ready: true },
  { label: "최종 검토", href: "/content/final-check", navHref: "/content/projects", icon: Eye, aliases: ["영상 피드백"], ready: true },
  { label: "업로드", href: "/content/upload", navHref: "/content/projects", icon: UploadCloud, aliases: ["유튜브 업로드", "설명란"], ready: true },
  { label: "쇼츠 · 칼럼", href: "/content/shorts", navHref: "/content/projects", icon: Scissors, aliases: ["쇼츠", "SEO 칼럼", "칼럼"], ready: true },
  // 로건 OS 요청 2026-10-30: the dictionaries the render PC reads at every voice job — opened from 제작's 음성 확인, not a menu of its own
  // (the side menu is the owner's decision).
  { label: "음성 사전", href: "/content/voice-dictionary", navHref: "/content/projects", icon: Mic, aliases: ["읽기 사전", "발음 사전", "끊김 시험 문제", "음성 수정"], ready: true },
];
// Owner decision 2026-10-29 (메뉴 A안 「만드는 것별」): what is made decides the menu. Shared work (주제 찾기 · 스케줄 · 성과 ·
// 링크관리) sits under 공통; each platform lists its own videos; 스레드 gets the channel-automation flow, and the rest of the old
// automation menu becomes 자동화 관리. Addresses do not change, so bookmarks, guides and menu permissions (by address) keep working.
export const YOUTUBE_V1_COMMON_PAGES: NavPage[] = [
  { label: "주제 찾기", href: "/content/projects?view=discover", icon: Radar, aliases: ["주제", "레퍼런스", "참고 영상", "새 주제"], ready: true },
  ...YOUTUBE_V1_PAGES.slice(1),
];
const platformStage = (id: string, label: string, page: string, platform: string, icon: NavPage["icon"]): NavStage => {
  const href = `/content/projects?platform=${platform}`;
  return { id, label, icon, href, pages: [{ label: page, href, icon: LayoutGrid, aliases: ["내 영상", label], ready: true }] };
};
export const YOUTUBE_V1_PLATFORM_STAGES: NavStage[] = [
  platformStage("yt-longform", "롱폼 유튜브", "내 롱폼 영상", "longform", Youtube),
  platformStage("yt-short", "숏폼 · 릴스", "내 숏폼 영상", "short", Smartphone),
  platformStage("yt-ad", "광고", "내 광고 영상", "ad", Megaphone),
  platformStage("yt-card", "카드뉴스", "내 카드뉴스", "card", GalleryHorizontal),
];
const THREADS_FLOW: Record<string, string> = {
  "/automation/references": "스레드 글감 모으기", "/automation/topics": "주제 기획", "/automation/threads": "쓰레드 쓰기",
  "/automation/review": "최종 확인", "/automation/calendar": "발행", "/automation/performance": "반응 · 성과",
};
/** The v1 side menu built from the shared stages: 공통 + one group per platform + 스레드 + 자동화 관리. */
export function youtubeV1Stages(stages: NavStage[]): NavStage[] {
  return stages.flatMap(stage => {
    if (stage.id === "content") return [{ ...stage, label: "공통", icon: Lightbulb, href: YOUTUBE_V1_COMMON_PAGES[0].href, pages: YOUTUBE_V1_COMMON_PAGES }, ...YOUTUBE_V1_PLATFORM_STAGES];
    if (stage.id !== "automation") return [stage];
    let step = 0;
    const threads = Object.keys(THREADS_FLOW).map(href => stage.pages.find(page => page.href === href)).filter((page): page is NavPage => Boolean(page))
      .map(page => ({ ...page, label: THREADS_FLOW[page.href], processNumber: page.href === "/automation/references" ? undefined : ++step, aliases: [page.label, ...(page.aliases ?? [])] }));
    const rest = stage.pages.filter(page => !THREADS_FLOW[page.href]).map(page => page.href === "/automation/shorts" ? { ...page, label: "쇼츠 (예전 자동화)", processNumber: undefined } : { ...page, processNumber: undefined });
    return [{ ...stage, id: "threads", label: "스레드", icon: AtSign, href: threads[0]?.href ?? stage.href, pages: threads }, { ...stage, label: "자동화 관리", icon: Settings, href: rest[0]?.href ?? stage.href, pages: rest }];
  });
}
/** Which v1 group a screen belongs to: a platform list by its ?platform=, 주제 찾기 and every step of a video under 공통. */
export function youtubeV1StageId(stages: NavStage[], pathname: string, params: URLSearchParams, fallback: string, canonical = pathname) {
  if (pathname === "/content/projects" && params.get("view") !== "discover") {
    const platform = params.get("platform");
    const match = YOUTUBE_V1_PLATFORM_STAGES.find(stage => stage.href.endsWith(`=${platform}`));
    if (match) return match.id;
  }
  const platformIds = new Set(YOUTUBE_V1_PLATFORM_STAGES.map(stage => stage.id));
  return stages.find(stage => stage.id !== "content" && !platformIds.has(stage.id) && stage.pages.some(page => [pathname, canonical].includes(page.href.split("?")[0])))?.id ?? fallback;
}
/** A menu entry with a query (주제 찾기, 내 숏폼 영상 …) is selected only when the address carries the same values. */
export function youtubeV1EntrySelected(href: string, pathname: string, params: URLSearchParams) {
  const [path, query] = href.split("?");
  if (path !== pathname || !query) return false;
  return [...new URLSearchParams(query)].every(([key, value]) => params.get(key) === value);
}

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
  "/content/links": "links",
  "/content/voice-dictionary": "voice-dictionary",
} as const;
export type YoutubeV1Screen = (typeof YOUTUBE_V1_SCREENS)[keyof typeof YOUTUBE_V1_SCREENS];
/** The new routes (and 단축 링크, 2026-10-26); /content/shorts is the existing screen and is not listed. */
export const YOUTUBE_V1_HREFS = Object.keys(YOUTUBE_V1_SCREENS);
export const youtubeV1Screen = (href: string): YoutubeV1Screen | null =>
  (YOUTUBE_V1_SCREENS as Record<string, YoutubeV1Screen>)[href] ?? null;
