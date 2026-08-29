import {
  BarChart3,
  BookOpen,
  Bot,
  Building2,
  CalendarDays,
  CircleDollarSign,
  ContactRound,
  FileSearch,
  FileText,
  Film,
  GitBranch,
  Goal,
  HeartHandshake,
  Home,
  KeyRound,
  LayoutDashboard,
  Link2,
  ListChecks,
  Megaphone,
  MessageSquareText,
  NotebookPen,
  PanelTop,
  ScrollText,
  Search,
  Settings,
  Sparkles,
  Tags,
  UploadCloud,
  Users,
  Workflow,
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
    ],
  },
  {
    id: "content",
    label: "콘텐츠",
    icon: Film,
    href: "/content/topics",
    pages: [
      { label: "주제·기획", href: "/content/topics", icon: Sparkles, group: "제작", ready: true },
      { label: "원고·스크립트", href: "/content/scripts", icon: NotebookPen, group: "제작", ready: true },
      { label: "제목·썸네일", href: "/content/packages", icon: PanelTop, group: "제작", ready: true },
      { label: "숏폼 편집", href: "/content/shorts", icon: Film, group: "자동화", ready: true },
      { label: "발행·업로드", href: "/content/publishing", icon: UploadCloud, group: "자동화", ready: true },
      { label: "발행 캘린더", href: "/content/calendar", icon: CalendarDays, group: "관리·분석", ready: true },
      { label: "영상 성과", href: "/content/performance", icon: BarChart3, group: "관리·분석", ready: true },
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
    href: "/organization/members",
    pages: [
      { label: "구성원", href: "/organization/members", icon: Users, ready: true },
      { label: "업무", href: "/organization/tasks", icon: ListChecks, ready: true },
      { label: "회의", href: "/organization/meetings", icon: MessageSquareText, ready: true },
      { label: "AI 작업", href: "/organization/agents", icon: Bot, ready: true },
    ],
  },
  {
    id: "performance",
    label: "성과관리",
    icon: BarChart3,
    href: "/performance/revenue",
    pages: [
      { label: "매출", href: "/performance/revenue", icon: CircleDollarSign, ready: true },
      { label: "퍼널", href: "/performance/funnels", icon: FileSearch, ready: true },
      { label: "CRM", href: "/performance/crm", icon: HeartHandshake, ready: true },
      { label: "고객", href: "/performance/customers", icon: ContactRound, ready: true },
      { label: "브랜드·태그", href: "/performance/brands", icon: Tags, ready: true },
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
