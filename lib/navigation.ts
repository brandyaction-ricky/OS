import {
  BarChart3,
  BookOpen,
  Bot,
  Building2,
  CalendarRange,
  CircleDollarSign,
  Code2,
  ContactRound,
  FileSearch,
  FileText,
  Film,
  GitBranch,
  Goal,
  Home,
  KeyRound,
  LayoutDashboard,
  Link2,
  ListChecks,
  Megaphone,
  MessageSquareText,
  NotebookPen,
  PanelTop,
  Plane,
  ReceiptText,
  ScrollText,
  Search,
  Settings,
  Sparkles,
  UploadCloud,
  Users,
  Workflow,
  Youtube,
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
}
export interface NavStage {
  id: string;
  label: string;
  icon: typeof Home;
  href: string;
  pages: NavPage[];
}

// Names live here so the navigation, page heading, breadcrumb and tab stay in sync.
export const NAV_STAGES: NavStage[] = [
  { id: "home", label: "내 할 일", icon: Home, href: "/home", pages: [
    { label: "내 할 일", href: "/home", icon: LayoutDashboard, aliases: ["홈", "오늘 현황"], ready: true },
  ] },
  { id: "content", label: "콘텐츠", icon: Film, href: "/content/topics", pages: [
    { label: "주제 찾기", href: "/content/topics", icon: Sparkles, aliases: ["주제·기획", "콘텐츠 레이더"], ready: true },
    { label: "원고·스크립트", href: "/content/scripts", icon: NotebookPen, group: "제작 현황", ready: true },
    { label: "제목·썸네일", href: "/content/packages", icon: PanelTop, group: "제작 현황", ready: true },
    { label: "숏폼 편집", href: "/content/shorts", icon: Film, group: "제작 현황", ready: true },
    { label: "유튜브 관리", href: "/content/youtube", icon: Youtube, group: "제작 현황", ready: true },
    { label: "발행 일정", href: "/content/publishing", icon: UploadCloud, aliases: ["발행·업로드", "멀티채널 자동화", "검토·발행 대기목록", "발행 캘린더"], ready: true },
    { label: "콘텐츠 성과", href: "/content/performance", icon: BarChart3, aliases: ["영상 성과"], ready: true },
  ] },
  { id: "knowledge", label: "회사 문서", icon: BookOpen, href: "/knowledge", pages: [
    { label: "전체 문서", href: "/knowledge", icon: FileText, aliases: ["지식", "문서 작업공간"], ready: true },
    { label: "검토 요청", href: "/knowledge/review", icon: ListChecks, aliases: ["검토함", "지식 검토함"], ready: true },
    { label: "문서 찾기", href: "/knowledge/search", icon: Search, aliases: ["지식 검색"], ready: true },
    { label: "문서 점검", href: "/knowledge/graph", icon: Link2, aliases: ["지식 연결"], ready: true },
    { label: "Skill 관리", href: "/knowledge/skills", icon: Workflow, group: "문서 점검", ready: true },
  ] },
  { id: "performance", label: "매출·성과", icon: BarChart3, href: "/performance/overview", pages: [
    { label: "회사 현황", href: "/performance/overview", icon: LayoutDashboard, aliases: ["성과관리", "성과 통합 현황"], ready: true },
    { label: "목표·KPI", href: "/home/goals", icon: Goal, group: "회사 현황", ready: true },
    { label: "월간 보고서", href: "/home/reports", icon: FileText, group: "회사 현황", ready: true },
    { label: "주간 KPI", href: "/performance/weekly-kpi", icon: Goal, group: "회사 현황", ready: true },
    { label: "매출·주문", href: "/performance/revenue", icon: CircleDollarSign, aliases: ["매출"], ready: true },
    { label: "주문 관리", href: "/performance/customers", icon: ContactRound, group: "매출·주문", aliases: ["자사몰 어드민"], ready: true },
    { label: "광고·전환", href: "/performance/ads", icon: Megaphone, aliases: ["광고 성과"], ready: true },
    { label: "퍼널", href: "/performance/funnels", icon: FileSearch, group: "광고·전환", ready: true },
    { label: "데이터 연결", href: "/performance/connections", icon: Link2, ready: true },
  ] },
  { id: "team", label: "팀", icon: Users, href: "/organization/meetings", pages: [
    { label: "회의·결정", href: "/organization/meetings", icon: MessageSquareText, aliases: ["조직운영", "회의"], ready: true },
    { label: "의사결정", href: "/home/decisions", icon: GitBranch, group: "회의·결정", ready: true },
    { label: "업무", href: "/organization/tasks", icon: ListChecks, aliases: ["업무 관리"], ready: true },
    { label: "일정·휴가", href: "/organization/schedule", icon: CalendarRange, aliases: ["이번 주 일정"], ready: true },
    { label: "연차·휴가", href: "/organization/leave", icon: Plane, group: "일정·휴가", ready: true },
    { label: "팀원", href: "/organization/members", icon: Users, aliases: ["구성원"], ready: true },
    { label: "경영지원", href: "/organization/finance", icon: ReceiptText, ready: true },
  ] },
  { id: "development", label: "개발", icon: Code2, href: "/knowledge/development", pages: [
    { label: "수정 요청", href: "/knowledge/development", icon: Code2, aliases: ["개발 관리", "개발·배포 기록"], ready: true },
    { label: "업데이트 내역", href: "/knowledge/development?tab=history", icon: ScrollText, ready: true },
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
  "/settings/monitoring": "/settings/connections",
  "/settings/channels": "/settings/connections",
  "/content/automation": "/content/publishing",
  "/content/review": "/content/publishing",
  "/content/calendar": "/content/publishing",
};
const matchesPath = (pathname: string, href: string) => pathname === href || (href !== "/home" && pathname.startsWith(`${href}/`));
export function findPage(path: string): NavPage {
  const pathname = path.split(/[?#]/)[0];
  const pages = NAV_STAGES.flatMap(stage => stage.pages);
  const query = new URLSearchParams(path.split("?")[1]?.split("#")[0] ?? "");
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
export function searchNavigation(query: string) {
  const normalized = query.trim().toLocaleLowerCase("ko-KR");
  const pages = NAV_STAGES.flatMap(stage => stage.pages.map(page => ({ ...page, stage: stage.label })));
  return (normalized ? pages.filter(page => `${page.stage} ${page.group ?? ""} ${page.label} ${(page.aliases ?? []).join(" ")}`.toLocaleLowerCase("ko-KR").includes(normalized)) : pages).slice(0, 8);
}
