import {
  BarChart3,
  BookOpen,
  Bot,
  Building2,
  CalendarRange,
  CircleDollarSign,
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
  Gauge,
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
  group?: string;
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

export const NAV_STAGES: NavStage[] = [
  {
    id: "home",
    label: "홈",
    icon: Home,
    href: "/home",
    pages: [
      { label: "오늘 현황", href: "/home", icon: LayoutDashboard, ready: true },
      { label: "목표·KPI", href: "/home/goals", icon: Goal, ready: true },
      { label: "의사결정", href: "/home/decisions", icon: GitBranch, ready: true },
      { label: "월간 보고서", href: "/home/reports", icon: FileText, ready: true },
    ],
  },
  {
    id: "content",
    label: "콘텐츠",
    icon: Film,
    href: "/content/topics",
    pages: [
      { label: "주제·기획", href: "/content/topics", icon: Sparkles, ready: true },
      { label: "원고·스크립트", href: "/content/scripts", icon: NotebookPen, ready: true },
      { label: "제목·썸네일", href: "/content/packages", icon: PanelTop, ready: true },
      { label: "숏폼 편집", href: "/content/shorts", icon: Film, ready: true },
      { label: "발행·업로드", href: "/content/publishing", icon: UploadCloud, ready: true },
      { label: "유튜브 관리", href: "/content/youtube", icon: Youtube, ready: true },
      { label: "영상 성과", href: "/content/performance", icon: BarChart3, ready: true },
    ],
  },
  {
    id: "knowledge",
    label: "지식",
    icon: BookOpen,
    href: "/knowledge",
    pages: [
      { label: "문서 작업공간", href: "/knowledge", icon: FileText, ready: true },
      { label: "지식 검색", href: "/knowledge/search", icon: Search, ready: true },
      { label: "검토함", href: "/knowledge/review", icon: ListChecks, ready: true },
      { label: "Skill 관리", href: "/knowledge/skills", icon: Workflow, ready: true },
      { label: "지식 연결", href: "/knowledge/graph", icon: Link2, ready: true },
    ],
  },
  {
    id: "organization",
    label: "조직운영",
    icon: Users,
    href: "/organization/meetings",
    pages: [
      { label: "구성원", href: "/organization/members", icon: Users, ready: true },
      { label: "업무", href: "/organization/tasks", icon: ListChecks, ready: true },
      { label: "회의", href: "/organization/meetings", icon: MessageSquareText, ready: true },
      { label: "이번 주 일정", href: "/organization/schedule", icon: CalendarRange, ready: true },
      { label: "연차·휴가", href: "/organization/leave", icon: Plane, ready: true },
      { label: "AI 작업", href: "/organization/agents", icon: Bot, ready: true },
      { label: "경영지원", href: "/organization/finance", icon: ReceiptText, ready: true },
    ],
  },
  {
    id: "performance",
    label: "성과관리",
    icon: BarChart3,
    href: "/performance/overview",
    pages: [
      { label: "성과 통합 현황", href: "/performance/overview", icon: LayoutDashboard, ready: true },
      { label: "주간 KPI", href: "/performance/weekly-kpi", icon: Goal, ready: true },
      { label: "매출", href: "/performance/revenue", icon: CircleDollarSign, ready: true },
      { label: "퍼널", href: "/performance/funnels", icon: FileSearch, ready: true },
      { label: "광고 성과", href: "/performance/ads", icon: Megaphone, ready: true },
      { label: "자사몰 어드민", href: "/performance/customers", icon: ContactRound, ready: true },
    ],
  },
  {
    id: "settings",
    label: "설정",
    icon: Settings,
    href: "/settings/connections",
    pages: [
      { label: "연결", href: "/settings/connections", icon: Link2, ready: true },
      { label: "권한", href: "/settings/access", icon: KeyRound, ready: true },
      { label: "감사 로그", href: "/settings/audit", icon: ScrollText, ready: true },
      { label: "운영 모니터링", href: "/settings/monitoring", icon: Gauge, ready: true },
      { label: "회사 설정", href: "/settings/company", icon: Building2, ready: true },
      { label: "메시지 창구", href: "/settings/channels", icon: Megaphone, ready: true },
    ],
  },
];

export function findStage(pathname: string) {
  return (
    NAV_STAGES.find((stage) =>
      stage.pages.some((page) =>
        page.href === "/home" ? pathname === "/home" : pathname.startsWith(page.href),
      ),
    ) ?? NAV_STAGES[0]
  );
}

export function findPage(pathname: string) {
  const pages = NAV_STAGES.flatMap((stage) => stage.pages);
  return (
    [...pages]
      .sort((a, b) => b.href.length - a.href.length)
      .find((page) =>
        page.href === "/home" ? pathname === "/home" : pathname.startsWith(page.href),
      ) ?? pages[0]
  );
}
