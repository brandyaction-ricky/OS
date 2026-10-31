import {
  BarChart3,
  BookOpen,
  Bot,
  Building2,
  CalendarRange,
  Clapperboard,
  Code2,
  FileText,
  Film,
  Gauge,
  Image,
  Lightbulb,
  Home,
  KeyRound,
  IdCard,
  LayoutDashboard,
  Link2,
  ListChecks,
  MessageSquareText,
  Smartphone,
  AtSign,
  ScrollText,
  Search,
  Settings,
  Sparkles,
  UploadCloud,
  Users,
  UserRound,
  Scissors,
  Youtube,
  Wallet,
  CreditCard,
  Landmark,
  Repeat,
  Receipt,
} from "lucide-react";
import { STAFF_FINANCE_MENUS } from "./finance/access.ts";
import { CARD_CANON_PAGE, COLUMN_CANON_PAGE, OVERVIEW_PAGE, SHORT_CANON_PAGE, THREADS_CANON_PAGE, YOUTUBE_V1_CEO_STAGE, YOUTUBE_V1_CONFIRM_PAGE, YOUTUBE_V1_HREFS, YOUTUBE_V1_PAGES, YOUTUBE_V1_STEP_PAGES } from "./youtube-process/navigation.ts";
export { YOUTUBE_V1_HREFS };

export interface NavPage {
  label: string;
  href: string;
  icon: typeof Home;
  navHref?: string;
  group?: string;
  aliases?: string[];
  description?: string;
  ready?: boolean;
  processNumber?: number;
  children?: { label: string; href: string }[];
}
export interface NavStage {
  id: string;
  label: string;
  icon: typeof Home;
  href: string;
  pages: NavPage[];
  requiresFinance?: boolean;
  requiresHr?: boolean;
}

// Names live here so the navigation, page heading, breadcrumb and tab stay in sync.
export const NAV_STAGES: NavStage[] = [
  { id: "content", label: "콘텐츠", icon: Film, href: "/content/topics", pages: [
    { label: "주제·기획", href: "/content/topics", icon: Sparkles, processNumber: 1, aliases: ["주제 찾기", "콘텐츠 레이더", "제작 현황"], ready: true },
    { label: "원고·스크립트", href: "/content/scripts", icon: FileText, processNumber: 2, ready: true },
    { label: "영상 제작", href: "/content/video", icon: Clapperboard, processNumber: 3, aliases: ["영상 자동 제작", "내 목소리 영상", "마인드맵 영상"], ready: true },
    { label: "제목·썸네일", href: "/content/packages", icon: Film, processNumber: 4, aliases: ["패키징 스튜디오"], ready: true },
    { label: "숏폼 편집", href: "/content/shorts", icon: Scissors, processNumber: 5, ready: true },
    { label: "발행·업로드", href: "/content/publishing", icon: UploadCloud, processNumber: 6, aliases: ["유튜브 발행", "유튜브 업로드", "발행 승인"], ready: true },
    { label: "유튜브 관리", href: "/content/youtube", icon: Youtube, processNumber: 7, ready: true },
    { label: "영상 성과", href: "/content/performance", icon: BarChart3, processNumber: 8, aliases: ["콘텐츠 성과"], ready: true },
  ] },
  { id: "automation", label: "콘텐츠 자동화", icon: Bot, href: "/automation/dashboard", pages: [
    { label: "자동화 현황", href: "/automation/dashboard", icon: LayoutDashboard, ready: true, aliases: ["대시보드"] },
    { label: "레퍼런스 수집", href: "/automation/references", icon: BookOpen, ready: true },
    { label: "주제 기획", href: "/automation/topics", icon: Lightbulb, processNumber: 1, ready: true },
    { label: "카드뉴스", href: "/automation/cardnews", icon: Image, processNumber: 2, ready: true },
    { label: "쇼츠", href: "/automation/shorts", icon: Smartphone, processNumber: 3, ready: true },
    { label: "쓰레드", href: "/automation/threads", icon: AtSign, processNumber: 4, ready: true },
    { label: "최종 확인", href: "/automation/review", icon: ListChecks, processNumber: 5, ready: true, aliases: ["최종 점검"] },
    { label: "발행", href: "/automation/calendar", icon: CalendarRange, processNumber: 6, ready: true, children: [{ label: "발행 일정", href: "/automation/calendar?tab=schedule" }, { label: "발행 기록", href: "/automation/calendar?tab=history" }] },
    { label: "반응·성과", href: "/automation/performance", icon: MessageSquareText, processNumber: 7, ready: true, children: [{ label: "댓글·답글", href: "/automation/performance?tab=comments" }, { label: "성과", href: "/automation/performance?tab=metrics" }] },
    { label: "맡긴 일", href: "/automation/requests", icon: Bot, ready: true, children: [{ label: "작업 목록", href: "/automation/requests?tab=jobs" }, { label: "내 컴퓨터", href: "/automation/requests?tab=browsers" }, { label: "실행 기록", href: "/automation/requests?tab=runs" }] },
    { label: "자동화 설정", href: "/automation/settings", icon: Settings, ready: true, children: [{ label: "실행 규칙", href: "/automation/settings?tab=run" }, { label: "스킬", href: "/automation/settings?tab=skills" }, { label: "양식·이미지", href: "/automation/settings?tab=templates" }, { label: "기본값", href: "/automation/settings?tab=defaults" }] },
  ] },
  { id: "knowledge", label: "회사 문서", icon: BookOpen, href: "/knowledge/vault", pages: [
    { label: "문서 보관함", href: "/knowledge/vault", icon: BookOpen, aliases: ["전체 문서", "문서 작업공간", "개인별 폴더"], ready: true },
    { label: "내 노트", href: "/knowledge/notes", icon: FileText, ready: true },
    { label: "회사 정본", href: "/knowledge/canon", icon: BookOpen, ready: true },
    { label: "휴지통", href: "/knowledge/trash", icon: ScrollText, ready: true },
  ] },
  { id: "team", label: "업무 기록", icon: Users, href: "/organization/meetings", pages: [
    { label: "회의·결정", href: "/organization/meetings", icon: MessageSquareText, aliases: ["조직운영", "회의", "의사결정"], ready: true },
    { label: "회의록", href: "/knowledge/meetings", icon: CalendarRange, ready: true },
    { label: "업무", href: "/organization/tasks", icon: ListChecks, aliases: ["업무 관리"], ready: true },
    { label: "일정·휴가", href: "/organization/schedule", icon: CalendarRange, aliases: ["이번 주 일정", "연차·휴가"], ready: true },
    { label: "팀원", href: "/organization/members", icon: Users, aliases: ["구성원"], ready: true },
  ] },
  { id: "hr", label: "인사 노무 관리", icon: IdCard, href: "/hr/employees", requiresHr: true, pages: [
    { label: "직원 명부", href: "/hr/employees", icon: Users, ready: true },
    { label: "휴가 관리", href: "/hr/leave", icon: CalendarRange, aliases: ["휴가·일정"], ready: true },
    { label: "연차 원장·촉진", href: "/hr/leave-ledger", icon: ListChecks, aliases: ["연차 관리"], ready: true },
    { label: "서류·계약", href: "/hr/documents", icon: FileText, ready: true },
    { label: "내 휴가", href: "/hr/my-leave", icon: UserRound, aliases: ["내 휴가·연차"], ready: true },
  ] },
  { id: "finance", label: "재무관리", icon: Wallet, href: "/finance/overview", requiresFinance: true, pages: [
    { label: "개요", href: "/finance/overview", icon: LayoutDashboard, aliases: ["재무 요약", "순수익"], ready: true },
    { label: "매출내역", href: "/finance/sales", icon: Receipt, aliases: ["토스 결제", "외부 매출"], ready: true },
    { label: "정산입금", href: "/finance/settlements", icon: ListChecks, aliases: ["지급", "입금 대조"], ready: true },
    { label: "통장 내역", href: "/finance/bank", icon: Landmark, aliases: ["계좌", "입출금"], ready: true },
    { label: "카드지출", href: "/finance/cards", icon: CreditCard, aliases: ["법인카드", "분류 규칙"], ready: true },
    { label: "정기 결제", href: "/finance/recurring", icon: Repeat, aliases: ["구독 관리"], ready: true },
    { label: "예산 관리", href: "/finance/budget", icon: BarChart3, aliases: ["고정비", "변동비", "인건비"], ready: true },
    { label: "부가세 신고 참고 자료", href: "/finance/vat", icon: Receipt, aliases: ["부가세", "VAT", "세금계산서", "홈택스", "신고 참고"], ready: true },
  ] },
  { id: "development", label: "개발", icon: Code2, href: "/knowledge/development", pages: [
    { label: "수정 요청", href: "/knowledge/development", icon: Code2, aliases: ["개발 관리", "개발·배포 기록"], ready: true },
    { label: "업데이트 내역", href: "/knowledge/development?tab=updates", icon: ScrollText, ready: true },
    { label: "맡긴 일 기록", href: "/organization/agents", icon: Bot, ready: true },
  ] },
  { id: "settings", label: "설정", icon: Settings, href: "/settings/connections", pages: [
    { label: "작동 상태", href: "/settings/connections", icon: Link2, aliases: ["연결", "운영 모니터링", "메시지 창구"], ready: true },
    { label: "권한·연결 키", href: "/settings/access", icon: KeyRound, aliases: ["권한", "AI 접근 키", "접근 키"], ready: true },
    { label: "변경 기록", href: "/settings/audit", icon: ScrollText, aliases: ["감사 로그"], ready: true },
    { label: "회사 설정", href: "/settings/company", icon: Building2, ready: true },
  ] },
];

const NAV_ALIASES: Record<string, string> = {
  "/content/production": "/content/topics",
  "/performance/connections": "/settings/connections",
  "/organization/leave": "/organization/schedule",

  "/home/decisions": "/organization/meetings",
  "/settings/monitoring": "/settings/connections",
  "/settings/channels": "/settings/connections",
  "/content/automation": "/automation/topics",
  "/content/review": "/automation/review",
  "/content/comments": "/automation/performance",
  "/automation/library": "/automation/dashboard",
  "/automation/templates": "/automation/settings",
  "/content/calendar": "/content/publishing",
};
export const ACCOUNT_PAGE: NavPage = { label: "내 계정", href: "/settings/account", icon: UserRound, aliases: ["채널 연결"], ready: true };
// The landing page remains reachable from the logo, without a sidebar or search menu entry.
const HOME_PAGE: NavPage = { label: "홈", href: "/home", icon: Home, ready: true };
const HOME_STAGE: NavStage = { id: "home", label: "홈", icon: Home, href: "/home", pages: [HOME_PAGE] };
const matchesPath = (pathname: string, href: string) => pathname === href || (href !== "/home" && pathname.startsWith(`${href}/`));
export function findPage(path: string): NavPage {
  const pathname = path.split(/[?#]/)[0];
  if (pathname === "/home") return HOME_PAGE;
  if (pathname === "/organization/people") return { label: "팀 현황", href: pathname, navHref: "/organization/members", icon: Gauge, ready: true };
  if (pathname === "/knowledge") return { label: "문서 보관함", href: pathname, navHref: "/knowledge/vault", icon: BookOpen, ready: true };
  const legacyDocuments: Record<string, string> = {
    "/knowledge/decisions": "결정 모음", "/knowledge/docs": "팀 문서", "/knowledge/graph": "연결",
    "/knowledge/review": "정본 검토·등록", "/knowledge/templates": "양식",
  };
  if (legacyDocuments[pathname]) return { label: legacyDocuments[pathname], href: pathname, navHref: "/knowledge/vault", icon: FileText, ready: true };
  if (pathname === "/knowledge/search") return { label: "문서 찾기", href: "/knowledge/search", navHref: "/knowledge/vault", icon: Search, ready: true };
  if (pathname.startsWith("/knowledge/doc/")) return { label: "문서", href: pathname, navHref: "/knowledge/vault", icon: FileText, ready: true };
  if (pathname === ACCOUNT_PAGE.href) return ACCOUNT_PAGE;
  const pages = NAV_STAGES.flatMap(stage => stage.pages);
  const query = new URLSearchParams(path.split("?")[1]?.split("#")[0] ?? "");
  if (pathname === "/knowledge/development" && query.get("tab") === "history") query.set("tab", "updates");
  const queryPage = pages.find(page => {
    if (!page.href.includes("?")) return false;
    const [href, params] = page.href.split("?");
    return pathname === href && [...new URLSearchParams(params)].every(([key,value]) => query.get(key) === value);
  });
  if (queryPage) return queryPage;
  const alias = Object.keys(NAV_ALIASES).find(href => matchesPath(pathname, href));
  if (alias) {
    const page = pages.find(item => item.href === NAV_ALIASES[alias])!;
    return { ...page, href: alias, navHref: page.href };
  }
  return [...pages].sort((a, b) => b.href.length - a.href.length).find(page => matchesPath(pathname, page.href))
    ?? [...YOUTUBE_V1_PAGES, ...YOUTUBE_V1_STEP_PAGES, YOUTUBE_V1_CONFIRM_PAGE, CARD_CANON_PAGE, SHORT_CANON_PAGE, THREADS_CANON_PAGE, COLUMN_CANON_PAGE, OVERVIEW_PAGE].find(page => matchesPath(pathname, page.href)) ?? HOME_PAGE;
}
export function findStage(pathname: string) {
  const page = findPage(pathname);
  const href = page.navHref ?? page.href;
  if (href === YOUTUBE_V1_CEO_STAGE.href) return YOUTUBE_V1_CEO_STAGE;
  return NAV_STAGES.find(stage => stage.pages.some(item => item.href === href))
    ?? (YOUTUBE_V1_HREFS.includes(href) ? NAV_STAGES.find(stage => stage.id === "content") : undefined) ?? HOME_STAGE;
}
export function searchNavigation(query: string, financeAccess = false, canVisit: (href: string) => boolean = () => true, hrEnabled = false) {
  const normalized = query.trim().toLocaleLowerCase("ko-KR");
  const pages = [...NAV_STAGES.filter(stage => !stage.requiresHr || hrEnabled).flatMap(stage => stage.pages.filter(page => !stage.requiresFinance || financeAccess || STAFF_FINANCE_MENUS.includes(page.href)).map(page => ({ ...page, stage: stage.label }))), { label: "문서 찾기", href: "/knowledge/search", icon: Search, aliases: ["지식 검색"], stage: "회사 문서" }, { ...ACCOUNT_PAGE, stage: "내 계정" }];
  return (normalized ? pages.filter(page => `${page.stage} ${page.group ?? ""} ${page.label} ${(page.aliases ?? []).join(" ")}`.toLocaleLowerCase("ko-KR").includes(normalized)) : pages).filter(page => canVisit(page.href)).slice(0, 8);
}
