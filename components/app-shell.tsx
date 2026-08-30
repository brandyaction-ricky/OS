"use client";

import {
  Bell,
  ChevronRight,
  ChevronsUpDown,
  Command,
  LogOut,
  Menu,
  Search,
  X,
} from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { findPage, findStage, NAV_STAGES } from "@/lib/navigation";
import { roleLabel } from "@/lib/company-settings";
import { CommandPalette } from "./command-palette";
import { PerformanceFilterBar } from "./performance-filter-context";
import { useSession } from "./session-provider";

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

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setPaletteOpen(true);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => setMobileOpen(false), [pathname]);

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

  return (
    <div className={`os-app${pathname.startsWith("/knowledge") && knowledgeFocus ? " knowledge-focus" : ""}`}>
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
        <button className="rail-avatar" onClick={() => setProfileOpen((value) => !value)}>
          <Initials name={profile?.displayName ?? "B"} />
        </button>
      </aside>

      <aside className={`page-sidebar${mobileOpen ? " mobile-open" : ""}`}>
        <div className="sidebar-head">
          <div>
            <span className="eyebrow">현재 영역</span>
            <h2>{stage.label}</h2>
          </div>
          <button className="icon-button mobile-only" onClick={() => setMobileOpen(false)}>
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

      {mobileOpen ? <button className="mobile-scrim" onClick={() => setMobileOpen(false)} /> : null}

      <div className="app-main">
        <header className="topbar">
          <button className="icon-button mobile-only" onClick={() => setMobileOpen(true)}>
            <Menu size={19} />
          </button>
          <nav className="breadcrumbs" aria-label="현재 위치">
            <Link href={stage.href}>{stage.label}</Link>
            <ChevronRight size={14} />
            <span aria-current="page">{page.label}</span>
          </nav>
          <div className="topbar-actions">
            <button className="command-trigger" onClick={() => setPaletteOpen(true)}>
              <Search size={15} />
              <span>페이지·지식 검색</span>
              <kbd><Command size={11} />K</kbd>
            </button>
            <button
              className="icon-button"
              aria-label="알림"
              aria-expanded={notificationsOpen}
              onClick={() => {
                setNotificationsOpen((value) => !value);
                setProfileOpen(false);
              }}
            >
              <Bell size={18} />
            </button>
            <button className="profile-trigger" onClick={() => { setProfileOpen((value) => !value); setNotificationsOpen(false); }}>
              <span className="avatar"><Initials name={profile?.displayName ?? "B"} /></span>
              <span className="profile-copy">
                <strong>{profile?.displayName ?? "구성원"}</strong>
                <small>{profile?.team ?? "전체"}</small>
              </span>
              <ChevronsUpDown size={14} />
            </button>
          </div>
          {profileOpen ? (
            <div className="profile-menu">
              <strong>{profile?.displayName}</strong>
              <span>{profile?.email}</span>
              <span className="role-badge">{roleLabel(profile?.role ?? "member")}</span>
              {!demo ? (
                <button onClick={signOut}><LogOut size={15} /> 로그아웃</button>
              ) : null}
            </div>
          ) : null}
          {notificationsOpen ? (
            <div className="notification-menu" role="status">
              <strong>알림</strong>
              <span>새로운 알림이 없습니다.</span>
              <small>검토 요청과 승인 대기 항목이 생기면 여기에 표시됩니다.</small>
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

      <CommandPalette open={paletteOpen} onClose={() => setPaletteOpen(false)} />
    </div>
  );
}
