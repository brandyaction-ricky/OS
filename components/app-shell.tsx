"use client";

import {
  ChevronRight,
  ChevronsUpDown,
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
} from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { findPage, findStage, NAV_STAGES } from "@/lib/navigation";
import { roleLabel } from "@/lib/company-settings";
import { CommandPalette } from "./command-palette";
import { DevelopmentRequestNotifications } from "./development-request-notifications";
import { PerformanceFilterBar } from "./performance-filter-context";
import { PasswordChangeForm } from "./password-change-form";
import { useSession } from "./session-provider";
type DisplayTheme = "dark" | "light";

const THEME_STORAGE_KEY = "brandy-os-theme";
const GUIDANCE_STORAGE_KEY = "brandy-os-guidance";

function Initials({ name }: { name: string }) {
  return <span>{name.slice(0, 1).toUpperCase()}</span>;
}

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const stage = useMemo(() => findStage(pathname), [pathname]);
  const page = useMemo(() => findPage(pathname), [pathname]);
  const { profile, loading, demo, signOut } = useSession();
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const [knowledgeFocus, setKnowledgeFocus] = useState(false);
  const [passwordOpen, setPasswordOpen] = useState(false);
  const [theme, setTheme] = useState<DisplayTheme>("dark");
  const [guidanceOn, setGuidanceOn] = useState(true);
  const profileMenuRef = useRef<HTMLDivElement>(null);
  const profileTriggerRef = useRef<HTMLButtonElement>(null);
  const railProfileTriggerRef = useRef<HTMLButtonElement>(null);
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
    (menu?.querySelector<HTMLButtonElement>("button") ?? menu)?.focus();
    const containsProfileElement = (target: EventTarget | null) => target instanceof Node && (
      profileMenuRef.current?.contains(target) ||
      profileTriggerRef.current?.contains(target) ||
      railProfileTriggerRef.current?.contains(target)
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
  }, []);

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
    window.localStorage.setItem(GUIDANCE_STORAGE_KEY, nextGuidance ? "on" : "off");
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

  if (loading) {
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
    <div className={`os-app linear-shell${pathname.startsWith("/knowledge") && knowledgeFocus ? " knowledge-focus" : ""}`}>
      <aside className="stage-rail" aria-label="주요 영역">
        <Link className="brand-mark" href="/home" aria-label="브랜디 OS 홈">
          BA
        </Link>
        <nav className="stage-list">
          {NAV_STAGES.map((item) => {
            const Icon = item.icon;
            const active = item.id === stage.id;
            return (
              <Link
                key={item.id}
                href={item.href}
                className={`stage-link${active ? " active" : ""}`}
                aria-current={active ? "page" : undefined}
              >
                <Icon size={20} strokeWidth={1.8} />
                <span>{item.label}</span>
              </Link>
            );
          })}
        </nav>
        <button ref={railProfileTriggerRef} className="rail-avatar" aria-label="내 계정 메뉴" aria-haspopup="dialog" aria-controls={profileOpen ? profileMenuId : undefined} aria-expanded={profileOpen} onClick={toggleProfileMenu}>
          <Initials name={profile?.displayName ?? "B"} />
        </button>
      </aside>

      <aside className={`page-sidebar${mobileOpen ? " mobile-open" : ""}`}>
        <div className="sidebar-head">
          <div>
            <span className="eyebrow">현재 영역</span>
            <h2>{stage.label}</h2>
          </div>
          <button className="icon-button mobile-only" aria-label="메뉴 닫기" onClick={() => setMobileOpen(false)}>
            <X size={18} />
          </button>
        </div>
        <nav className="page-nav">
          {stage.pages.map((item, index) => {
            const Icon = item.icon;
            const active = item.href === page.href;
            const previousGroup = index > 0 ? stage.pages[index - 1].group : undefined;
            return (
              <div key={item.href}>
                {item.group && item.group !== previousGroup ? (
                  <div className="nav-group">{item.group}</div>
                ) : null}
                <Link
                  href={item.href}
                  className={`page-link${active ? " active" : ""}`}
                  aria-current={active ? "page" : undefined}
                >
                  <Icon size={17} />
                  <span>{item.label}</span>
                  {!item.ready ? <span className="soon-dot" title="설계 대기" /> : null}
                </Link>
              </div>
            );
          })}
        </nav>
        <div className="sidebar-foot">
          <div className="system-state">
            <span className={`state-dot ${demo ? "demo" : "ready"}`} />
            <span>{demo ? "데모 데이터" : "서버 연결됨"}</span>
          </div>
        </div>
      </aside>

      {mobileOpen ? <button className="mobile-scrim" aria-label="메뉴 닫기" onClick={() => setMobileOpen(false)} /> : null}

      <div className="app-main">
        <header className="topbar development-request-topbar">
          <button className="icon-button mobile-only" aria-label="메뉴 열기" aria-expanded={mobileOpen} onClick={() => setMobileOpen(true)}>
            <Menu size={19} />
          </button>
          <nav className="breadcrumbs" aria-label="현재 위치">
            <Link href={stage.href}>{stage.label}</Link>
            <ChevronRight size={14} />
            <span aria-current="page">{page.label}</span>
          </nav>
          <div className="topbar-actions">
            <button className="command-trigger" aria-label="페이지·지식 검색" aria-haspopup="dialog" aria-expanded={paletteOpen} onClick={openPalette}>
              <Search size={15} />
              <span>페이지·지식 검색</span>
              <kbd><Command size={11} />K</kbd>
            </button>
            <div className="display-controls" role="group" aria-label="화면 설정">
              <button
                type="button"
                className="display-control"
                aria-label={`${theme === "dark" ? "라이트" : "다크"} 모드로 전환`}
                title={`${theme === "dark" ? "라이트" : "다크"} 모드로 전환`}
                onClick={changeTheme}
              >
                {theme === "dark" ? <Sun size={15} /> : <Moon size={15} />}
                <span>{theme === "dark" ? "라이트" : "다크"}</span>
              </button>
              <button
                type="button"
                className={`display-control guidance-control${guidanceOn ? " active" : ""}`}
                role="switch"
                aria-checked={guidanceOn}
                aria-label={`기능 설명 안내 ${guidanceOn ? "켜짐" : "꺼짐"}`}
                title={`기능 설명 안내 ${guidanceOn ? "켜짐" : "꺼짐"}`}
                onClick={changeGuidance}
              >
                <CircleHelp size={15} />
                <span>설명</span>
                <em>{guidanceOn ? "ON" : "OFF"}</em>
              </button>
            </div>
            <Link className="development-request-quick-link" href={`/knowledge/development?new=request&page=${encodeURIComponent(pathname)}`} onClick={() => { setNotificationsOpen(false); setProfileOpen(false); }}>
              <MessageSquarePlus size={14} aria-hidden="true" />
              <span>수정 요청</span>
            </Link>
            <DevelopmentRequestNotifications open={notificationsOpen} onOpenChange={changeNotificationsOpen} />
            <button ref={profileTriggerRef} className="profile-trigger" aria-label="내 계정 메뉴" aria-haspopup="dialog" aria-controls={profileOpen ? profileMenuId : undefined} aria-expanded={profileOpen} onClick={toggleProfileMenu}>
              <span className="avatar"><Initials name={profile?.displayName ?? "B"} /></span>
              <span className="profile-copy">
                <strong>{profile?.displayName ?? "구성원"}</strong>
                <small>{profile?.team ?? "전체"}</small>
              </span>
              <ChevronsUpDown size={14} />
            </button>
          </div>
          {profileOpen ? (
            <div ref={profileMenuRef} id={profileMenuId} className="profile-menu" role="dialog" aria-label="내 계정" tabIndex={-1}>
              <strong>{profile?.displayName}</strong>
              <span>{profile?.email}</span>
              <span className="role-badge">{roleLabel(profile?.role ?? "member")}</span>
              {!demo ? (
                <>
                  <button onClick={() => { setPasswordOpen(true); setProfileOpen(false); }}><KeyRound size={15} /> 비밀번호 변경</button>
                  <button onClick={signOut}><LogOut size={15} /> 로그아웃</button>
                </>
              ) : null}
            </div>
          ) : null}
        </header>
        <main className="page-content">
          {pathname.startsWith("/performance") ? <PerformanceFilterBar /> : null}
          {children}
        </main>
      </div>

      <nav className="mobile-stage-bar" aria-label="모바일 주요 영역">
        {NAV_STAGES.map((item) => {
          const Icon = item.icon;
          return (
            <Link key={item.id} href={item.href} className={item.id === stage.id ? "active" : ""}>
              <Icon size={19} />
              <span>{item.label}</span>
            </Link>
          );
        })}
      </nav>

      <CommandPalette open={paletteOpen} onClose={closePalette} />
      {passwordOpen ? <div className="modal-backdrop" onMouseDown={() => setPasswordOpen(false)}><div onMouseDown={(event) => event.stopPropagation()}><PasswordChangeForm onCancel={() => setPasswordOpen(false)} /></div></div> : null}
    </div>
  );
}
