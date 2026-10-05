"use client";

import {
  BookOpen,
  ChevronRight,
  ChevronDown,
  ChevronsUpDown,
  ChevronsLeft,
  ChevronsRight,
  NotebookPen,
  CircleHelp,
  Command,
  MessageSquarePlus,
  KeyRound,
  LogOut,
  Menu,
  Moon,
  Search,
  Sun,
  X,
  UserRound,
} from "lucide-react";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { findPage, findStage, NAV_STAGES } from "@/lib/navigation";
import { fullscreenScreen } from "@/lib/fullscreen-screen";
import { roleLabel } from "@/lib/company-settings";
import { DevelopmentRequestDrawer } from "./development-request-drawer";
import { ServerConnectionStatus } from "./server-connection-status";
import { CommandPalette } from "./command-palette";
import { DevelopmentRequestNotifications } from "./development-request-notifications";
import {MovedMenuNotice} from "./moved-menu-notice";
import {ContentWorkProvider} from "./content-work-provider";
import { PasswordChangeForm } from "./password-change-form";
import { useSession } from "./session-provider";
type DisplayTheme = "dark" | "light";

const THEME_STORAGE_KEY = "brandy-os-theme";
const GUIDANCE_STORAGE_KEY = "brandy-os-guidance";
const GROUPS_STORAGE_KEY = "brandy-os-nav-groups";
const COLLAPSED_STORAGE_KEY = "brandy-os-nav-collapsed";
const MENU_GUIDE_STORAGE_KEY = "brandy-os-menu-guide-final";
function Initials({ name }: { name: string }) {
  return <span>{name.slice(0, 1).toUpperCase()}</span>;
}

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const params = useSearchParams();
  const navigationPath = `${pathname}?${params.toString()}`;
  const stage = useMemo(() => findStage(navigationPath), [navigationPath]);
  const page = useMemo(() => findPage(navigationPath), [navigationPath]);
  const screen = fullscreenScreen(pathname, params.get("tab"));
  const { profile, loading, demo, signOut } = useSession();
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const [knowledgeFocus, setKnowledgeFocus] = useState(false);
  const [passwordOpen, setPasswordOpen] = useState(false);
  const [requestOpen, setRequestOpen] = useState(false);
  const [quickOpen, setQuickOpen] = useState(false);
  const [theme, setTheme] = useState<DisplayTheme>("dark");
  const [guidanceOn, setGuidanceOn] = useState(true);
  const [collapsed, setCollapsed] = useState(false);
  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>({ [stage.id]: true });
  const [menuGuide, setMenuGuide] = useState(false);
  const [serverOk, setServerOk] = useState<boolean | null>(null);
  const mobileTriggerRef = useRef<HTMLButtonElement>(null);
  const sidebarRef = useRef<HTMLElement>(null);
  const previousStage = useRef(stage.id);
  const profileMenuRef = useRef<HTMLDivElement>(null);
  const profileTriggerRef = useRef<HTMLButtonElement>(null);
  const profileReturnFocusRef = useRef<HTMLButtonElement | null>(null);
  const profileMenuId = useId();

  const openPalette = useCallback(() => {
    setProfileOpen(false);
    setNotificationsOpen(false);
    setPaletteOpen(true);
  }, []);
  const closePalette = useCallback(() => setPaletteOpen(false), []);

  const toggleProfileMenu = (event: React.MouseEvent<HTMLButtonElement>) => {
    profileReturnFocusRef.current = event.currentTarget;
    setProfileOpen((value) => !value);
    setNotificationsOpen(false);
  };

  useEffect(() => {
    if (!profileOpen) return;
    const menu = profileMenuRef.current;
    (menu?.querySelector<HTMLElement>("a, button") ?? menu)?.focus();
    const containsProfileElement = (target: EventTarget | null) => target instanceof Node && (
      profileMenuRef.current?.contains(target) ||
      profileTriggerRef.current?.contains(target)
    );
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      setProfileOpen(false);
      profileReturnFocusRef.current?.focus();
    };
    const onOutsideInteraction = (event: Event) => {
      if (!containsProfileElement(event.target)) setProfileOpen(false);
    };
    document.addEventListener("keydown", onKeyDown);
    document.addEventListener("pointerdown", onOutsideInteraction);
    document.addEventListener("focusin", onOutsideInteraction);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("pointerdown", onOutsideInteraction);
      document.removeEventListener("focusin", onOutsideInteraction);
    };
  }, [profileOpen]);

  const changeNotificationsOpen = useCallback((open: boolean) => {
    setNotificationsOpen(open);
    if (open) setProfileOpen(false);
  }, []);

  useEffect(() => {
    const savedTheme = document.documentElement.dataset.theme;
    const savedGuidance = document.documentElement.dataset.guidance;
    setTheme(savedTheme === "light" ? "light" : "dark");
    setGuidanceOn(savedGuidance !== "off");
    const syncTheme = () => setTheme(document.documentElement.dataset.theme === "light" ? "light" : "dark");
    const device = window.matchMedia("(prefers-color-scheme: dark)");
    const deviceChanged = () => {
      try { if (window.localStorage.getItem(THEME_STORAGE_KEY)) return; } catch { /* Follow device without storage. */ }
      document.documentElement.dataset.theme = device.matches ? "dark" : "light";
      document.documentElement.style.colorScheme = device.matches ? "dark" : "light";
      syncTheme();
    };
    window.addEventListener("brandy-os-theme-change", syncTheme);
    device.addEventListener("change", deviceChanged);
    return () => {
      window.removeEventListener("brandy-os-theme-change", syncTheme);
      device.removeEventListener("change", deviceChanged);
    };
  }, []);

  useEffect(() => {
    try {
      const stored = JSON.parse(window.localStorage.getItem(GROUPS_STORAGE_KEY) ?? "{}");
      const moved = previousStage.current !== stage.id;
      previousStage.current = stage.id;
      setOpenGroups({ ...Object.fromEntries(NAV_STAGES.map(item => [item.id, typeof stored?.[item.id] === "boolean" ? stored[item.id] : item.id === stage.id || (stage.id === "home" && item.id === "content")])), [stage.id]: moved || stored?.[stage.id] === undefined ? true : stored[stage.id] === true });
      setCollapsed(window.localStorage.getItem(COLLAPSED_STORAGE_KEY) === "true");
      setMenuGuide(window.localStorage.getItem(MENU_GUIDE_STORAGE_KEY) !== "seen");
    } catch { setOpenGroups({ [stage.id]: true }); }
  }, [stage.id]);

  const toggleGroup = (id: string) => {
    const next = { ...openGroups, [id]: !openGroups[id] };
    setOpenGroups(next);
    try { window.localStorage.setItem(GROUPS_STORAGE_KEY, JSON.stringify(next)); } catch { /* Current view still works without storage. */ }
  };
  const toggleSidebar = () => {
    setCollapsed(!collapsed);
    try { window.localStorage.setItem(COLLAPSED_STORAGE_KEY, String(!collapsed)); } catch { /* Keep in-memory preference. */ }
  };
  const dismissGuide = () => {
    setMenuGuide(false);
    try { window.localStorage.setItem(MENU_GUIDE_STORAGE_KEY, "seen"); } catch { /* Keep in-memory preference. */ }
  };
  useEffect(() => {
    if (!mobileOpen) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    sidebarRef.current?.querySelector<HTMLButtonElement>('[aria-label="메뉴 닫기"]')?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") { setMobileOpen(false); mobileTriggerRef.current?.focus(); }
      if (event.key !== "Tab") return;
      const items = Array.from(sidebarRef.current?.querySelectorAll<HTMLElement>('a[href], button:not([disabled])') ?? []).filter(item => item.getClientRects().length);
      const first = items[0], last = items[items.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    };
    document.addEventListener("keydown", onKey);
    return () => { document.body.style.overflow = previousOverflow; document.removeEventListener("keydown", onKey); };
  }, [mobileOpen]);

  const changeTheme = () => {
    const nextTheme: DisplayTheme = theme === "dark" ? "light" : "dark";
    document.documentElement.dataset.theme = nextTheme;
    document.documentElement.style.colorScheme = nextTheme;
    window.localStorage.setItem(THEME_STORAGE_KEY, nextTheme);
    setTheme(nextTheme);
  };

  const changeGuidance = () => {
    const nextGuidance = !guidanceOn;
    document.documentElement.dataset.guidance = nextGuidance ? "on" : "off";
    try {
      window.localStorage.setItem(GUIDANCE_STORAGE_KEY, nextGuidance ? "on" : "off");
      if (nextGuidance) Object.keys(window.localStorage).filter(key=>key.startsWith("brandy-os-guide-closed:")).forEach(key=>window.localStorage.removeItem(key));
    } catch { /* Display preferences still work when storage is unavailable. */ }
    window.dispatchEvent(new Event("brandy-guidance-change"));
    setGuidanceOn(nextGuidance);
  };

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        openPalette();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [openPalette]);

  useEffect(() => {
    setMobileOpen(false);
    setProfileOpen(false);
    setNotificationsOpen(false);
  }, [pathname]);

  useEffect(() => {
    const handleFocus = (event: Event) => setKnowledgeFocus(Boolean((event as CustomEvent<boolean>).detail));
    window.addEventListener("brandy-knowledge-focus", handleFocus);
    return () => window.removeEventListener("brandy-knowledge-focus", handleFocus);
  }, []);

  useEffect(() => {
    document.title = `${page.label} | 브랜디 OS`;
  }, [page.label]);

  if (loading || (!demo && !profile)) {
    return (
      <div className="boot-screen">
        <div className="brand-mark large">BA</div>
        <p>브랜디 OS를 여는 중입니다</p>
      </div>
    );
  }

  if (!demo && profile?.mustChangePassword) {
    return <PasswordChangeForm forced />;
  }

  return (
    <div className={`os-app linear-shell unified-shell shell-v2${collapsed ? " nav-collapsed" : ""}${pathname.startsWith("/knowledge") && knowledgeFocus ? " knowledge-focus" : ""}`}>
      <aside ref={sidebarRef} id="main-navigation" data-ui="sidebar" className={`unified-sidebar page-sidebar${mobileOpen ? " mobile-open" : ""}`} aria-label="주요 메뉴">
        <div className="unified-sidebar-head sidebar-head" data-ui="sidebar-head">
          <Link className="brand-mark" data-ui="brand-mark" href="/home" aria-label="브랜디 OS 홈">BA</Link>
          <div className="sidebar-brand brand-copy"><b>브랜디 OS</b><span>우리 팀의 작업 공간</span></div>
          <button className="icon-button sidebar-collapse" data-ui="collapse-btn" aria-label={collapsed ? "사이드바 펼치기" : "사이드바 접기"} aria-expanded={!collapsed} onClick={toggleSidebar}>
            {collapsed ? <ChevronsRight size={17} /> : <ChevronsLeft size={17} />}
          </button>
          <button className="icon-button mobile-only" aria-label="메뉴 닫기" onClick={() => setMobileOpen(false)}><X size={18} /></button>
        </div>
        <nav className="unified-nav page-nav">
          {NAV_STAGES.map(item => {
            const Icon = item.icon;
            const active = pathname !== "/settings/account" && item.id === stage.id;
            return <section className={`nav-section${active ? " active" : ""}`} key={item.id}>
              <Link className={`compact-group${active ? " active" : ""}`} href={item.href} aria-label={item.label} title={item.label}><Icon size={20} /><span>{item.label}</span></Link>
              {item.id !== "home" ? <button className="nav-section-trigger nav-group" data-ui="nav-group" aria-label={item.id === "content" ? "콘텐츠 유튜브 공정 순서" : item.label} onClick={() => toggleGroup(item.id)} aria-expanded={Boolean(openGroups[item.id])} aria-controls={`nav-${item.id}`}>
                <span className="nav-chevron" data-ui="nav-chevron" aria-hidden="true">{openGroups[item.id] ? "▾" : "▸"}</span><span className="nav-icon"><Icon size={16} /></span><span className="nav-group-label">{item.label}{item.id === "settings" && serverOk === false ? <small className="state-dot waiting" title="서버 확인 실패" aria-label="서버 확인 실패" /> : null}{item.id === "content" ? <small className="nav-process-caption nav-group-note">유튜브 공정 순서</small> : null}</span>
              </button> : null}
              <div id={`nav-${item.id}`} className="nav-section-pages" hidden={item.id !== "home" && !openGroups[item.id]}>
                {item.pages.map((entry, index) => {
                  const selected = entry.href === (page.navHref ?? page.href);
                  const PageIcon = entry.icon;
                  return <div key={entry.href}>
                    {entry.group && entry.group !== item.pages[index - 1]?.group ? <div className="temporary-nav-group">{entry.group}<small>임시 하위 메뉴</small></div> : null}
                    <Link href={entry.href} data-ui={selected ? "nav-item-active" : item.id === "home" ? "nav-home" : "nav-item"} className={`page-link${item.id === "home" ? " nav-home" : ""}${selected ? " active" : ""}${entry.group ? " temporary-child" : ""}`} aria-current={selected ? "page" : undefined} onClick={() => setMobileOpen(false)}>
                      {entry.processNumber ? <span className="process-number nav-step-no" aria-hidden="true">{["①","②","③","④","⑤","⑥","⑦"][entry.processNumber-1]}</span> : <PageIcon size={15} />}<span>{entry.label}</span>
                    </Link>
                  </div>;
                })}
                {item.id === "automation" ? <Link className="page-link nav-canon-link" href="/knowledge?tab=canon" onClick={() => setMobileOpen(false)}><BookOpen size={15}/><span>정본 관리 열기</span></Link> : null}
              </div>
            </section>;
          })}
        </nav>
        <div className="unified-sidebar-foot sidebar-foot" data-ui="sidebar-foot">
          <button className="sidebar-request" onClick={() => { setRequestOpen(true); setMobileOpen(false); }} title="수정 요청"><MessageSquarePlus size={17} /><span>수정 요청 남기기</span></button>
          <div className="sidebar-status"><ServerConnectionStatus demo={demo} onStatusChange={setServerOk} /></div>
          <button ref={profileTriggerRef} className="profile-trigger" data-ui="profile-row" aria-label="내 계정 메뉴" aria-haspopup="dialog" aria-controls={profileOpen ? profileMenuId : undefined} aria-expanded={profileOpen} onClick={toggleProfileMenu}>
            <span className="avatar" data-ui="avatar"><Initials name={profile?.displayName ?? "B"} /></span>
            <span className="profile-copy"><b>{profile?.displayName ?? "구성원"}</b><span>내 계정 · 채널 연결</span></span><ChevronsUpDown size={14} />
          </button>
          {profileOpen ? <div ref={profileMenuRef} id={profileMenuId} className="profile-menu" role="dialog" aria-label="내 계정" tabIndex={-1}>
            <strong>{profile?.displayName}</strong><span>{profile?.email}</span><span className="role-badge">{roleLabel(profile?.role ?? "member")}</span>
            <Link href="/settings/account" onClick={()=>setProfileOpen(false)}><UserRound size={15} /> 내 계정 · 채널 연결</Link>
            <div className="display-controls" role="group" aria-label="화면 설정">
              <button type="button" className="display-control" aria-label={`${theme === "dark" ? "라이트" : "다크"} 모드로 전환`} onClick={changeTheme}>{theme === "dark" ? <Sun size={15} /> : <Moon size={15} />}<span>{theme === "dark" ? "라이트" : "다크"} 모드</span></button>
            </div>
            <button onClick={() => { setMenuGuide(true); setProfileOpen(false); setMobileOpen(false); }}><CircleHelp size={15} /> 메뉴 안내 다시 보기</button>
            {!demo ? <><button onClick={() => { setPasswordOpen(true); setProfileOpen(false); setMobileOpen(false); }}><KeyRound size={15} /> 비밀번호 변경</button><button onClick={signOut}><LogOut size={15} /> 로그아웃</button></> : null}
          </div> : null}
        </div>
      </aside>
      {mobileOpen ? <button className="mobile-scrim" aria-label="메뉴 배경 닫기" onClick={() => setMobileOpen(false)} /> : null}
      <div className="app-main">
        <header className="topbar" data-ui="topbar">
          <button ref={mobileTriggerRef} className="icon-button mobile-only" aria-label="메뉴 열기" aria-expanded={mobileOpen} aria-controls="main-navigation" onClick={() => setMobileOpen(true)}><Menu size={19} /></button>
          <nav className="breadcrumbs" data-ui="breadcrumbs" aria-label="현재 위치">{pathname !== "/settings/account" ? <><Link href={stage.href}>{stage.label}</Link><ChevronRight size={14} /></> : null}<span aria-current="page">{page.label}</span></nav>
          <div className="topbar-actions">
            <button className="command-trigger" data-ui="search" aria-label="페이지·지식 검색" aria-haspopup="dialog" aria-expanded={paletteOpen} onClick={openPalette}><Search size={15} /><span>찾기</span><kbd data-ui="kbd"><Command size={11} />K</kbd></button>
            <button type="button" className={`display-control guidance-control${guidanceOn ? " active" : ""}`} data-ui={guidanceOn ? "guide-toggle-on" : "guide-toggle-off"} role="switch" aria-checked={guidanceOn} aria-label={`사용 가이드 ${guidanceOn ? "켜짐" : "꺼짐"}`} onClick={changeGuidance}><CircleHelp size={15} /><span>사용 가이드</span><em>{guidanceOn ? "ON" : "OFF"}</em></button>
            <div className="quick-record-menu" onBlur={event=>{if(!event.currentTarget.contains(event.relatedTarget))setQuickOpen(false);}} onKeyDown={event=>{if(event.key==="Escape"){setQuickOpen(false);event.currentTarget.querySelector<HTMLButtonElement>("button")?.focus();}}}>
              <button className="quick-record-link quick-add" data-ui="quick-add" aria-label="빠른 기록" onClick={()=>{setQuickOpen(false);setRequestOpen(true);}}><NotebookPen size={16} /><span>빠른 기록</span></button>
              <button className="quick-record-more" aria-label="기록 종류 선택" aria-expanded={quickOpen} aria-controls="quick-record-options" onClick={()=>setQuickOpen(!quickOpen)}><ChevronDown size={14}/></button>
              {quickOpen ? <div id="quick-record-options" className="quick-record-options"><Link href="/knowledge?new=1" onClick={()=>{setQuickOpen(false);window.dispatchEvent(new Event("brandy-quick-record"));}}>메모</Link><Link href="/organization/tasks?new=1" onClick={()=>setQuickOpen(false)}>업무</Link><button onClick={()=>{setRequestOpen(true);setQuickOpen(false);}}>수정 요청</button></div> : null}
            </div>
            <DevelopmentRequestNotifications open={notificationsOpen} onOpenChange={changeNotificationsOpen} />
          </div>
        </header>
        <ContentWorkProvider><main className={`page-content${screen ? ` ui-v2 screen-${screen}` : ""}`}>
          <MovedMenuNotice />
          {menuGuide ? <section className="menu-guide" aria-label="메뉴 안내"><div><strong>새 메뉴에서 내 일을 찾아보세요</strong><p>유튜브 제작은 콘텐츠의 7단계에서, 채널 자동화와 댓글은 콘텐츠 자동화에서 확인합니다. 회사 정본은 전체 문서에서, 채널 연결은 내 계정에서 관리합니다.</p></div><button className="secondary-button" onClick={dismissGuide}>확인했어요</button></section> : null}
          {children}
        </main></ContentWorkProvider>
      </div>
      <DevelopmentRequestDrawer open={requestOpen} onClose={() => setRequestOpen(false)} />
      <CommandPalette open={paletteOpen} onClose={closePalette} />
      {passwordOpen ? <div className="modal-backdrop" onMouseDown={() => setPasswordOpen(false)}><div onMouseDown={(event) => event.stopPropagation()}><PasswordChangeForm onCancel={() => setPasswordOpen(false)} /></div></div> : null}
    </div>
  );
}
