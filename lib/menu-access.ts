import { ACCOUNT_PAGE, findPage, NAV_STAGES } from "./navigation";

export interface MenuAccessPolicy {
  member_id: string;
  allowed_menus: string[] | null;
  version: number;
}

export interface MenuAccessProfile {
  role: string;
  isActive?: boolean;
  financeAccess?: boolean;
}

export const MENU_HREFS = NAV_STAGES.flatMap(stage => stage.pages.map(page => page.href));
export const REQUIRED_MENUS = ["/home", ACCOUNT_PAGE.href];

/** Navigation preferences never grant document, finance, or mutation privileges. */
export function canOpenMenu(profile: MenuAccessProfile | null, href: string, allowed: string[] | null = null) {
  if (profile?.isActive !== true) return false;
  const page = findPage(href);
  const canonical = page.navHref ?? page.href;
  if (profile.role === "admin") return true;
  if (canonical === "/hr/my-leave") return true;
  if (canonical.startsWith("/hr/") && !profile.financeAccess) return false;
  if (canonical.startsWith("/finance/") && !profile.financeAccess) return false;
  return REQUIRED_MENUS.includes(canonical) || allowed === null || allowed.includes(canonical);
}

export function availableMenuGroups(profile: MenuAccessProfile, hrEnabled = false) {
  return NAV_STAGES.filter(stage => !stage.requiresHr || hrEnabled).map(stage => ({ ...stage, pages: stage.pages.filter(page => canOpenMenu(profile, page.href)) }));
}

export function isMissingMenuAccessTable(error: { code?: string; message?: string } | null) {
  return Boolean(error && ["42P01", "PGRST205"].includes(error.code ?? "") && error.message?.includes("os_member_menu_access"));
}
