import {
  BarChart3,
  BookOpen,
  Bot,
  Building2,
  CalendarRange,
  Code2,
  FileText,
  Film,
  Home,
  KeyRound,
  IdCard,
  LayoutDashboard,
  Link2,
  ListChecks,
  MessageSquareText,
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
  { id: "home", label: "내 할 일", icon: Home, href: "/home", pages: [
    { label: "내 할 일", href: "/home", icon: LayoutDashboard, aliases: ["홈", "오늘 현황"], ready: true },
  ] },
  { id: "content", label: "콘텐츠", icon: Film, href: "/content/topics", pages: [
    { label: "주제·기획", href: "/content/topics", icon: Sparkles, processNumber: 1, aliases: ["주제 찾기", "콘텐츠 레이더", "제작 현황"], ready: true },
    { label: "원고·스크립트", href: "/content/scripts", icon: FileText, processNumber: 2, ready: true },
    { label: "제목·썸네일", href: "/content/packages", icon: Film, processNumber: 3, aliases: ["패키징 스튜디오"], ready: true },
    { label: "숏폼 편집", href: "/content/shorts", icon: Scissors, processNumber: 4, ready: true },
    { label: "발행·업로드", href: "/content/publishing", icon: UploadCloud, processNumber: 5, aliases: ["유튜브 발행", "유튜브 업로드", "발행 승인"], ready: true },
    { label: "유튜브 관리", href: "/content/youtube", icon: Youtube, processNumber: 6, ready: true },
    { label: "영상 성과", href: "/content/performance", icon: BarChart3, processNumber: 7, aliases: ["콘텐츠 성과"], ready: true },
  ] },
  { id: "automation", label: "콘텐츠 자동화", icon: Bot, href: "/content/comments", pages: [
    { label: "대시보드", href: "/automation/dashboard", icon: LayoutDashboard, ready: true },
    { label: "최종 점검", href: "/automation/review", icon: ListChecks, ready: true },
    { label: "Claude 요청함", href: "/automation/requests", icon: Bot, ready: true },
    { label: "라이브러리", href: "/automation/library", icon: BookOpen, ready: true },
    { label: "발행 캘린더", href: "/automation/calendar", icon: CalendarRange, ready: true },
    { label: "성과 기록", href: "/automation/performance", icon: BarChart3, ready: true },
    { label: "카드뉴스 시안", href: "/automation/templates", icon: Film, ready: true },
    { label: "자동화 설정", href: "/automation/settings", icon: Settings, ready: true },
    { label: "댓글·답글", href: "/content/comments", icon: MessageSquareText, ready: true },
  ] },
  { id: "knowledge", label: "회사 문서", icon: BookOpen, href: "/knowledge/vault", pages: [
    { label: "문서 보관함", href: "/knowledge/vault", icon: BookOpen, aliases: ["전체 문서", "문서 작업공간", "개인별 폴더"], ready: true },
    { label: "내 노트", href: "/knowledge/notes", icon: FileText, ready: true },
    { label: "회의록", href: "/knowledge/meetings", icon: CalendarRange, ready: true },
    { label: "회사 정본", href: "/knowledge/canon", icon: BookOpen, ready: true },
    { label: "휴지통", href: "/knowledge/trash", icon: ScrollText, ready: true },
  ] },
  { id: "team", label: "팀", icon: Users, href: "/organization/meetings", pages: [
    { label: "회의·결정", href: "/organization/meetings", icon: MessageSquareText, aliases: ["조직운영", "회의", "의사결정"], ready: true },
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
  ] },
  { id: "development", label: "개발", icon: Code2, href: "/knowledge/development", pages: [
    { label: "수정 요청", href: "/knowledge/development", icon: Code2, aliases: ["개발 관리", "개발·배포 기록"], ready: true },
    { label: "업데이트 내역", href: "/knowledge/development?tab=updates", icon: ScrollText, ready: true },
    { label: "AI 작업", href: "/organization/agents", icon: Bot, ready: true },
  ] },
  { id: "settings", label: "설정", icon: Settings, href: "/settings/connections", pages: [
    { label: "작동 상태", href: "/settings/connections", icon: Link2, aliases: ["연결", "운영 모니터링", "메시지 창구"], ready: true },
    { label: "권한·접근 키", href: "/settings/access", icon: KeyRound, aliases: ["권한", "AI 접근 키"], ready: true },
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
  "/content/automation": "/automation/review",
  "/content/review": "/automation/review",
  "/content/calendar": "/content/publishing",
};
export const ACCOUNT_PAGE: NavPage = { label: "내 계정", href: "/settings/account", icon: UserRound, aliases: ["채널 연결"], ready: true };
const matchesPath = (pathname: string, href: string) => pathname === href || (href !== "/home" && pathname.startsWith(`${href}/`));
export function findPage(path: string): NavPage {
  const pathname = path.split(/[?#]/)[0];
  if (pathname === "/knowledge") return { label: "문서 보관함", href: pathname, navHref: "/knowledge/vault", icon: BookOpen, ready: true };
  const legacyDocuments: Record<string, string> = {
    "/knowledge/decisions": "결정 모음", "/knowledge/docs": "팀 문서", "/knowledge/graph": "연결",
    "/knowledge/review": "정본 검토·등록", "/knowledge/templates": "템플릿",
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
  return [...pages].sort((a, b) => b.href.length - a.href.length).find(page => matchesPath(pathname, page.href)) ?? pages[0];
}
export function findStage(pathname: string) {
  const page = findPage(pathname);
  return NAV_STAGES.find(stage => stage.pages.some(item => item.href === (page.navHref ?? page.href))) ?? NAV_STAGES[0];
}
export function searchNavigation(query: string, financeAccess = false, canVisit: (href: string) => boolean = () => true, hrEnabled = false) {
  const normalized = query.trim().toLocaleLowerCase("ko-KR");
  const pages = [...NAV_STAGES.filter(stage => (!stage.requiresFinance || financeAccess) && (!stage.requiresHr || hrEnabled)).flatMap(stage => stage.pages.map(page => ({ ...page, stage: stage.label }))), { label: "문서 찾기", href: "/knowledge/search", icon: Search, aliases: ["지식 검색"], stage: "회사 문서" }, { ...ACCOUNT_PAGE, stage: "내 계정" }];
  return (normalized ? pages.filter(page => `${page.stage} ${page.group ?? ""} ${page.label} ${(page.aliases ?? []).join(" ")}`.toLocaleLowerCase("ko-KR").includes(normalized)) : pages).filter(page => canVisit(page.href)).slice(0, 8);
}
