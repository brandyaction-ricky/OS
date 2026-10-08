"use client";

import { Check, ChevronDown, LoaderCircle, RotateCcw, Settings2, ShieldCheck, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { getMenuAccess, saveMenuAccess, type OsMember } from "@/lib/api-client";
import { roleLabel } from "@/lib/company-settings";
import { availableMenuGroups, canOpenMenu, type MenuAccessPolicy } from "@/lib/menu-access";

const DEMO_STORAGE = "brandy-os-demo-menu-access-v1";
const DEMO_MEMBERS: OsMember[] = [
  { id: "demo-marketer", email: "marketer@example.test", display_name: "가상 마케터", role: "member", team: "마케팅", is_active: true, affiliation: "", roles: [], onboarding: {}, finance_access: false },
  { id: "demo-accountant", email: "accountant@example.test", display_name: "가상 회계 담당", role: "lead", team: "경영지원", is_active: true, affiliation: "", roles: [], onboarding: {}, finance_access: true },
  { id: "demo-admin", email: "admin@example.test", display_name: "가상 관리자", role: "admin", team: "경영", is_active: true, affiliation: "", roles: [], onboarding: {}, finance_access: true },
];

function memberProfile(member: OsMember) {
  return { role: member.role, isActive: member.is_active, financeAccess: member.finance_access };
}

export function MemberMenuAccess({ members, token, demo, isAdmin }: { members: OsMember[]; token: string | null; demo: boolean; isAdmin: boolean }) {
  const [policies, setPolicies] = useState<MenuAccessPolicy[]>([]);
  const [loading, setLoading] = useState(true);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [selected, setSelected] = useState<OsMember | null>(null);
  const [mode, setMode] = useState<"default" | "custom">("default");
  const [allowed, setAllowed] = useState<string[]>([]);
  const [version, setVersion] = useState(0);
  const [saving, setSaving] = useState(false);
  const [modalError, setModalError] = useState("");
  const trigger = useRef<HTMLButtonElement | null>(null);
  const accounts = (demo ? DEMO_MEMBERS : members).filter(member => member.is_active && member.account_connected !== false);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      if (demo) {
        const stored = localStorage.getItem(DEMO_STORAGE);
        const data: unknown = stored ? JSON.parse(stored) : [];
        setPolicies(Array.isArray(data) ? data : []);
        setReady(true);
      } else {
        const result = await getMenuAccess(token, isAdmin);
        setPolicies(result.policies);
        setReady(result.ready);
      }
    } catch (reason) {
      setReady(false);
      setError(reason instanceof Error ? reason.message : "메뉴 설정을 불러오지 못했습니다.");
    } finally { setLoading(false); }
  }, [demo, isAdmin, token]);

  useEffect(() => { void load(); }, [load]);

  const open = (member: OsMember, button: HTMLButtonElement) => {
    trigger.current = button;
    const policy = policies.find(item => item.member_id === member.id);
    setMode(policy?.allowed_menus ? "custom" : "default");
    setAllowed(policy?.allowed_menus ?? availableMenuGroups(memberProfile(member)).flatMap(stage => stage.pages.map(page => page.href)));
    setVersion(policy?.version ?? 0);
    setModalError("");
    setNotice("");
    setSelected(member);
  };

  const close = useCallback(() => {
    if (saving) return;
    setSelected(null);
    trigger.current?.focus();
  }, [saving]);

  const save = async () => {
    if (!selected || !isAdmin || !ready || selected.role === "admin") return;
    setSaving(true);
    setModalError("");
    try {
      const allowedMenus = mode === "default" ? null : [...new Set(["/home", ...allowed])];
      const policy = demo
        ? { member_id: selected.id, allowed_menus: allowedMenus, version: version + 1 }
        : (await saveMenuAccess(token, { memberId: selected.id, allowedMenus, expectedVersion: version })).policy;
      const next = [...policies.filter(item => item.member_id !== selected.id), policy];
      if (demo) localStorage.setItem(DEMO_STORAGE, JSON.stringify(next));
      setPolicies(next);
      setNotice(demo ? "가상 계정의 메뉴 설정을 이 브라우저에 저장했습니다." : "메뉴 권한을 저장했습니다. 해당 계정이 화면을 새로 열거나 새로고침하면 반영됩니다.");
      setSelected(null);
      trigger.current?.focus();
    } catch (reason) {
      setModalError(reason instanceof Error ? reason.message : "메뉴 설정을 저장하지 못했습니다.");
    } finally { setSaving(false); }
  };

  return <section className="panel account-menu-access" aria-label="실제 계정 역할">
    <div className="panel-header"><div><h2>실제 계정 역할</h2><p>계정별 역할과 접근 가능한 메뉴를 관리합니다.</p></div>{demo ? <span className="status-pill">가상 계정 미리보기</span> : null}</div>
    <p className="account-menu-help">메뉴의 표시와 화면 접근을 설정합니다. 자료 열람·수정과 민감자료 권한은 기존 계정·문서 권한 기준을 따릅니다.</p>
    {!isAdmin ? <p className="account-menu-help">메뉴 권한 변경은 관리자만 할 수 있습니다.</p> : null}
    {notice ? <p className="account-menu-message" role="status"><Check size={15} />{notice}</p> : null}
    {error ? <div className="account-menu-message" role="alert">{error}<button className="secondary-button" onClick={() => void load()}>다시 불러오기</button></div> : null}
    {loading ? <p className="account-menu-message" role="status"><LoaderCircle className="spin" size={16} />메뉴 설정을 불러오는 중입니다.</p> : <>
      {!ready && !error ? <p className="account-menu-message" role="status">메뉴 설정 저장 준비 중입니다. 기존 계정 권한은 유지됩니다.</p> : null}
      <div className="account-menu-table" role="table" aria-label="계정별 메뉴 권한">
        <div className="account-menu-row account-menu-columns" role="row"><span role="columnheader">계정</span><span role="columnheader">역할 / 팀</span><span role="columnheader">메뉴 권한</span><span role="columnheader">설정</span></div>
        {accounts.map(member => {
          const policy = policies.find(item => item.member_id === member.id);
          const count = availableMenuGroups(memberProfile(member)).flatMap(stage => stage.pages).filter(page => canOpenMenu(memberProfile(member), page.href, policy?.allowed_menus ?? null)).length;
          return <div className="account-menu-row" role="row" key={member.id}>
            <span role="cell"><strong>{member.display_name || member.email.split("@")[0]}</strong><small>{member.email}</small></span>
            <span role="cell"><em>{roleLabel(member.role)}</em><small>{member.team || "팀 미지정"}</small></span>
            <span role="cell"><strong>{member.role === "admin" ? "전체 메뉴" : !isAdmin ? "관리자에게 확인" : policy?.allowed_menus ? `${count}개 메뉴 선택` : "기본 권한"}</strong><small>{member.finance_access || member.role === "admin" ? "민감자료 허용" : "일반 자료"}</small></span>
            <span role="cell"><button className="secondary-button" disabled={!isAdmin} aria-label={`${member.display_name || "계정"} 권한 설정`} onClick={event => open(member, event.currentTarget)}><Settings2 size={14} />설정<ChevronDown size={12} /></button></span>
          </div>;
        })}
        {!accounts.length ? <p className="account-menu-message">설정할 활성 로그인 계정이 없습니다.</p> : null}
      </div>
    </>}
    {selected ? <MenuAccessDialog member={selected} allowed={allowed} mode={mode} saving={saving} ready={ready} error={modalError} onMode={setMode} onAllowed={setAllowed} onSave={() => void save()} onClose={close} /> : null}
  </section>;
}

function MenuAccessDialog({ member, allowed, mode, saving, ready, error, onMode, onAllowed, onSave, onClose }: {
  member: OsMember; allowed: string[]; mode: "default" | "custom"; saving: boolean; ready: boolean; error: string;
  onMode: (mode: "default" | "custom") => void; onAllowed: (menus: string[]) => void; onSave: () => void; onClose: () => void;
}) {
  const dialog = useRef<HTMLElement>(null);
  const isAdmin = member.role === "admin";
  const groups = availableMenuGroups(memberProfile(member));
  const selected = mode === "default" || isAdmin ? groups.flatMap(stage => stage.pages.map(page => page.href)) : allowed;
  const disabled = saving || isAdmin || mode === "default" || !ready;

  useEffect(() => {
    const element = dialog.current;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    element?.querySelector<HTMLElement>("button")?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") { event.preventDefault(); onClose(); }
      if (event.key !== "Tab") return;
      const focusable = Array.from(element?.querySelectorAll<HTMLElement>('button:not([disabled]),input:not([disabled]),select:not([disabled]),a[href]') ?? []);
      const first = focusable[0], last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    };
    document.addEventListener("keydown", onKey);
    return () => { document.body.style.overflow = previousOverflow; document.removeEventListener("keydown", onKey); };
  }, [onClose]);

  const toggleGroup = (hrefs: string[], checked: boolean) => onAllowed(checked ? [...new Set([...allowed, ...hrefs])] : allowed.filter(href => href === "/home" || !hrefs.includes(href)));
  return <div className="modal-backdrop menu-access-backdrop" onMouseDown={event => { if (event.target === event.currentTarget) onClose(); }}>
    <section ref={dialog} className="panel menu-access-dialog" role="dialog" aria-modal="true" aria-labelledby="menu-access-title" aria-describedby="menu-access-description">
      <header className="menu-access-heading"><div><small>계정별 메뉴 권한</small><h2 id="menu-access-title">{member.display_name} 권한 설정</h2><p>{roleLabel(member.role)} · {member.team || "팀 미지정"}</p></div><button className="icon-button" aria-label="권한 설정 닫기" disabled={saving} onClick={onClose}><X size={18} /></button></header>
      <div className="menu-access-scroll">
        <p id="menu-access-description">선택한 메뉴만 사이드바와 화면에서 사용할 수 있습니다. 내 할 일과 내 계정은 항상 사용할 수 있습니다.</p>
        {isAdmin ? <p className="menu-access-info"><ShieldCheck size={17} />관리자는 모든 메뉴를 사용합니다. 관리 기능에 접근할 수 있도록 메뉴 제한을 적용하지 않습니다.</p> : <fieldset className="menu-access-mode" disabled={saving || !ready}><legend>설정 방식</legend><label><input type="radio" name="menu-access-mode" checked={mode === "default"} onChange={() => onMode("default")} />기본 권한 사용<small>역할·민감자료 권한에 맞는 메뉴 전체</small></label><label><input type="radio" name="menu-access-mode" checked={mode === "custom"} onChange={() => onMode("custom")} />메뉴 직접 선택<small>이 계정에 필요한 메뉴만 허용</small></label></fieldset>}
        {!member.finance_access && !isAdmin ? <p className="menu-access-info">재무관리 메뉴는 구성원 정보에서 민감자료 권한을 부여한 뒤 선택할 수 있습니다.</p> : null}
        <div className="menu-access-groups">
          {groups.filter(group => group.pages.length).map(group => {
            const hrefs = group.pages.map(page => page.href);
            const count = hrefs.filter(href => selected.includes(href)).length;
            return <fieldset key={group.id} disabled={disabled} className="menu-access-group"><legend>{group.id === "content" ? "유튜브 공정" : group.label}<span>{count}/{hrefs.length}</span></legend><label className="menu-access-group-toggle"><input type="checkbox" checked={count === hrefs.length} ref={input => { if (input) input.indeterminate = count > 0 && count < hrefs.length; }} onChange={event => toggleGroup(hrefs, event.target.checked)} disabled={disabled || group.id === "home"} />그룹 전체 선택</label><div>{group.pages.map(page => <label key={page.href}><input type="checkbox" checked={selected.includes(page.href)} disabled={disabled || page.href === "/home"} onChange={event => toggleGroup([page.href], event.target.checked)} />{page.label}{page.href === "/home" ? <small>항상 허용</small> : null}</label>)}</div></fieldset>;
          })}
        </div>
        <p className="menu-access-info">문서별 열람·편집, 승인, 재무자료와 관리자 작업 권한은 기존 기준을 그대로 따릅니다.</p>
        {error ? <p className="menu-access-error" role="alert">{error}</p> : null}
        {!ready ? <p className="menu-access-error">저장 준비 중입니다. 현재 설정을 변경하지 않습니다.</p> : null}
      </div>
      <footer className="menu-access-footer"><button className="ghost-button" disabled={saving || isAdmin || !ready} onClick={() => onMode("default")}><RotateCcw size={14} />기본 권한으로</button><div><button className="secondary-button" disabled={saving} onClick={onClose}>{isAdmin ? "닫기" : "취소"}</button>{!isAdmin ? <button className="primary-button" disabled={saving || !ready} onClick={onSave}>{saving ? <LoaderCircle className="spin" size={15} /> : <Check size={15} />}{saving ? "저장 중" : "권한 저장"}</button> : null}</div></footer>
    </section>
  </div>;
}
