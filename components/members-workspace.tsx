"use client";

import {
  CheckCircle2,
  CircleAlert,
  KeyRound,
  ShieldCheck,
  UserRound,
  UserRoundPlus,
  Users,
} from "lucide-react";
import { FormEvent, useEffect, useState } from "react";
import { COMPANY_ROSTER, memberMatchesRoster, rosterDirectoryId } from "@/lib/company-roster";
import { useSession } from "./session-provider";

interface Member {
  id: string;
  email: string;
  display_name: string;
  legal_name: string;
  role: "member" | "lead" | "admin";
  team: string;
  affiliation: string;
  roles: string[];
  onboarding: Record<string, boolean>;
  finance_access: boolean;
  is_active: boolean;
  created_at: string;
  updated_at: string;
  account_connected: boolean;
  must_change_password: boolean;
}

const ONBOARDING = [
  ["account", "OS 계정"],
  ["role", "역할·권한"],
  ["knowledge", "정본 검색"],
  ["workflow", "업무 흐름"],
] as const;

async function memberRequest<T>(
  token: string | null,
  options: RequestInit = {},
  path = "/api/v1/members",
) {
  const response = await fetch(path, {
    ...options,
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${token}`,
    },
  });
  const body = await response.json();
  if (!response.ok)
    throw new Error(
      body?.error?.message ?? "구성원 요청을 처리하지 못했습니다.",
    );
  return body as T;
}

export function MembersWorkspace() {
  const { accessToken, profile, demo } = useSession();
  const [members, setMembers] = useState<Member[]>([]);
  const [selected, setSelected] = useState<Member | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [saving, setSaving] = useState(false);
  const [accountBusy, setAccountBusy] = useState(false);
  const [legalName, setLegalName] = useState("");
  const [accountEmail, setAccountEmail] = useState("");
  const load = async () => {
    if (demo) return;
    try {
      const result = await memberRequest<{ members: Member[] }>(accessToken);
      setMembers(result.members);
      setSelected(
        (current) =>
          result.members.find((member) => member.id === current?.id) ??
          result.members[0] ??
          null,
      );
    } catch (reason) {
      setError(
        reason instanceof Error ? reason.message : "불러오지 못했습니다.",
      );
    }
  };
  useEffect(() => {
    load();
  }, [accessToken, demo]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    setLegalName(selected?.legal_name || "");
    setAccountEmail(selected?.email || "");
  }, [selected?.email, selected?.id, selected?.legal_name]);
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!selected) return;
    const form = new FormData(event.currentTarget);
    setSaving(true);
    setNotice("");
    try {
      await memberRequest(accessToken, {
        method: "PATCH",
        body: JSON.stringify({
          id: selected.id,
          displayName: form.get("displayName"),
          role: form.get("role") || selected.role,
          team: form.get("team"),
          affiliation: form.get("affiliation"),
          roles: String(form.get("roles") || "")
            .split(",")
            .map((item) => item.trim())
            .filter(Boolean),
          onboarding: Object.fromEntries(
            ONBOARDING.map(([key]) => [
              key,
              form.get(`onboarding_${key}`) === "on",
            ]),
          ),
          financeAccess: form.get("financeAccess") === "on",
          isActive: form.get("isActive") === "on",
        }),
      });
      await load();
      setNotice("구성원 정보를 저장했습니다.");
    } catch (reason) {
      setError(
        reason instanceof Error ? reason.message : "저장하지 못했습니다.",
      );
    } finally {
      setSaving(false);
    }
  };
  const issueAccount = async () => {
    if (!selected || selected.account_connected) return;
    setAccountBusy(true); setError(""); setNotice("");
    try {
      await memberRequest(accessToken, {
        method: "POST",
        body: JSON.stringify({ legalName, nickname: selected.display_name, email: accountEmail }),
      }, "/api/v1/members/accounts");
      await load();
      setNotice(`${selected.display_name} 계정을 발급했습니다. 최초 로그인 후 비밀번호 변경이 필요합니다.`);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "직원 계정을 발급하지 못했습니다.");
    } finally { setAccountBusy(false); }
  };
  const resetPassword = async () => {
    if (!selected?.account_connected || selected.id === profile?.id) return;
    if (!window.confirm(`${selected.display_name || selected.email} 계정을 공통 최초 비밀번호로 초기화할까요? 다음 로그인에서 개인 비밀번호 변경이 강제됩니다.`)) return;
    setAccountBusy(true); setError(""); setNotice("");
    try {
      await memberRequest(accessToken, { method: "POST" }, `/api/v1/members/${selected.id}/password-reset`);
      await load();
      setNotice(`${selected.display_name || selected.email} 계정의 비밀번호를 초기화했습니다.`);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "비밀번호를 초기화하지 못했습니다.");
    } finally { setAccountBusy(false); }
  };
  const accounts = members.filter((member) => member.account_connected);
  const active = accounts.filter((member) => member.is_active).length;
  const admins = accounts.filter(
    (member) => member.role === "admin" && member.is_active,
  ).length;
  return (
    <>
      <header className="page-header">
        <div className="page-title-group">
          <span className="eyebrow">구성원·권한</span>
          <h1>구성원</h1>
          <p>실제 로그인 계정의 역할·팀·사용 상태를 관리합니다.</p>
        </div>
      </header>
      {error ? (
        <div className="inline-alert danger">
          <CircleAlert size={16} />
          {error}
        </div>
      ) : null}
      {notice ? <div className="inline-alert success"><CheckCircle2 size={16} />{notice}</div> : null}
      <section className="metric-grid compact-metrics">
        <div className="metric-card">
          <div className="metric-top">
            <span>전체 계정</span>
            <span className="metric-icon">
              <Users size={16} />
            </span>
          </div>
          <div className="metric-value">{accounts.length}</div>
          <div className="metric-caption">로그인 이력이 있는 구성원</div>
        </div>
        <div className="metric-card">
          <div className="metric-top">
            <span>사용 중</span>
            <span className="metric-icon">
              <CheckCircle2 size={16} />
            </span>
          </div>
          <div className="metric-value">{active}</div>
          <div className="metric-caption good">OS 접근 가능</div>
        </div>
        <div className="metric-card">
          <div className="metric-top">
            <span>관리자</span>
            <span className="metric-icon">
              <ShieldCheck size={16} />
            </span>
          </div>
          <div className="metric-value">{admins}</div>
          <div className="metric-caption">권한 변경 가능</div>
        </div>
        <div className="metric-card">
          <div className="metric-top">
            <span>중지</span>
            <span className="metric-icon">
              <CircleAlert size={16} />
            </span>
          </div>
          <div className="metric-value">{accounts.length - active}</div>
          <div className="metric-caption">접근 차단 계정</div>
        </div>
      </section>
      <section className="roster-grid">
        {COMPANY_ROSTER.map((person) => {
          const account = members.find((member) =>
            memberMatchesRoster(member, person.name),
          ) ?? members.find((member) => member.id === rosterDirectoryId(person.name));
          const roles = account?.roles?.length ? account.roles : [...person.roles];
          const representativeRoles = roles.slice(0, 2);
          return (
            <button type="button" className="panel roster-card" key={person.name} onClick={() => account && setSelected(account)} aria-label={`${person.name} 구성원 정보 편집`}>
              <span className="avatar">
                <UserRound size={15} />
              </span>
              <div>
                <strong>{person.name}</strong>
                <small>{person.affiliation}</small>
                <span className="roster-roles">
                  {representativeRoles.length ? (
                    <>
                      {representativeRoles.map((role) => (
                        <b key={role}>{role}</b>
                      ))}
                      {roles.length > 2 ? (
                        <b>+{roles.length - 2}</b>
                      ) : null}
                    </>
                  ) : (
                    <b className="empty">역할 미설정</b>
                  )}
                </span>
              </div>
              <em className={account?.account_connected && account.is_active ? "ready" : "waiting"}>
                {account?.account_connected ? (account.is_active ? "계정 연결" : "계정 중지") : "초대 대기"}
              </em>
            </button>
          );
        })}
      </section>
      <section className="members-layout">
        <div className="panel member-list">
          {accounts.map((member) => (
            <button
              key={member.id}
              className={selected?.id === member.id ? "active" : ""}
              aria-current={selected?.id === member.id ? "true" : undefined}
              onClick={() => setSelected(member)}
            >
              <span className="avatar">
                <UserRound size={15} />
              </span>
              <span>
                <strong>
                  {member.display_name || member.email.split("@")[0]}
                </strong>
                <small>
                  {member.affiliation || member.team || member.email}
                </small>
              </span>
              <span
                className={`state-dot ${member.is_active ? "ready" : "demo"}`}
              />
            </button>
          ))}
          {!members.length ? (
            <div className="quiet-state">
              <Users />
              <strong>구성원 없음</strong>
              <span>첫 로그인 후 계정이 표시됩니다.</span>
            </div>
          ) : null}
        </div>
        <form
          className="panel member-editor"
          onSubmit={submit}
          key={selected?.id}
        >
          <div className="panel-header">
            <div>
              <h2>{selected ? `${selected.display_name || selected.email.split("@")[0]} / ${selected.affiliation || selected.team || "소속 미지정"}` : "구성원 정보"}</h2>
              <p>{selected ? (selected.account_connected ? selected.email : "로그인 계정 연결 전 · 디렉터리 정보") : "목록에서 구성원을 선택하세요."}</p>
            </div>
            {selected ? (
              <span className="role-badge">{selected.role}</span>
            ) : null}
          </div>
          {selected ? (
            <div className="member-fields">
              {!selected.account_connected ? (
                <section className="member-account-issue">
                  <div><UserRoundPlus size={17} /><span><strong>직원 로그인 계정 발급</strong><small>기존 닉네임 `{selected.display_name}`에 로그인 계정을 연결합니다.</small></span></div>
                  <label><span>직원 실명</span><input value={legalName} onChange={(event) => setLegalName(event.target.value)} placeholder="직원 실명" required /></label>
                  <label><span>로그인 이메일</span><input type="email" value={accountEmail} onChange={(event) => setAccountEmail(event.target.value)} placeholder="name@brandyaction.com" required /></label>
                  <button type="button" className="secondary-button" disabled={accountBusy || profile?.role !== "admin" || !legalName.trim() || !accountEmail.trim()} onClick={issueAccount}><UserRoundPlus size={15} /> {accountBusy ? "발급 중…" : "최초 비밀번호로 계정 발급"}</button>
                  <small>비밀번호 원문은 화면에 표시하지 않습니다. 직원은 최초 로그인 후 개인 비밀번호를 반드시 설정합니다.</small>
                </section>
              ) : null}
              <label>
                <span>표시 이름</span>
                <input
                  name="displayName"
                  defaultValue={
                    selected.display_name || selected.email.split("@")[0]
                  }
                  required
                />
              </label>
              <div className="form-grid">
                <label>
                  <span>소속</span>
                  <select
                    name="affiliation"
                    defaultValue={selected.affiliation || "브랜디액션"}
                  >
                    <option>브랜디액션</option>
                    <option>RS 협업</option>
                    <option>외부 협업</option>
                  </select>
                </label>
                <label>
                  <span>팀</span>
                  <input name="team" defaultValue={selected.team} />
                </label>
              </div>
              <label>
                <span>복수 역할 태그</span>
                <input
                  name="roles"
                  defaultValue={(selected.roles || []).join(", ")}
                  placeholder="콘텐츠, 운영, 검수"
                />
              </label>
              <label>
                <span>접근 역할</span>
                <select
                  name="role"
                  defaultValue={selected.role}
                  disabled={profile?.role !== "admin" || !selected.account_connected}
                >
                  <option value="member">구성원</option>
                  <option value="lead">리드</option>
                  <option value="admin">관리자</option>
                </select>
              </label>
              <fieldset className="onboarding-checks">
                <legend>온보딩 체크</legend>
                {ONBOARDING.map(([key, label]) => (
                  <label key={key}>
                    <input
                      type="checkbox"
                      name={`onboarding_${key}`}
                      defaultChecked={Boolean(selected.onboarding?.[key])}
                    />
                    <span>{label}</span>
                  </label>
                ))}
              </fieldset>
              <label className="toggle-label">
                <input
                  type="checkbox"
                  name="financeAccess"
                  defaultChecked={selected.finance_access}
                  disabled={profile?.role !== "admin" || !selected.account_connected}
                />
                <span>경영지원 민감정보 접근</span>
              </label>
              {selected.account_connected ? (
                <section className="member-password-admin">
                  <span><KeyRound size={16} /><span><strong>비밀번호 관리</strong><small>{selected.must_change_password ? "개인 비밀번호 변경 대기" : "개인 비밀번호 사용 중"}</small></span></span>
                  {selected.id !== profile?.id ? <button type="button" className="secondary-button" disabled={accountBusy || profile?.role !== "admin"} onClick={resetPassword}>{accountBusy ? "초기화 중…" : "최초 비밀번호로 초기화"}</button> : <small>본인 계정은 상단 프로필의 비밀번호 변경을 이용하세요.</small>}
                </section>
              ) : null}
              <label className="toggle-label">
                <input
                  type="checkbox"
                  name="isActive"
                  defaultChecked={selected.is_active}
                  disabled={profile?.role !== "admin" || !selected.account_connected}
                />
                <span>계정 사용 허용</span>
              </label>
              <button
                className="primary-button"
                disabled={saving || profile?.role !== "admin"}
              >
                {saving ? "저장 중…" : selected.account_connected ? "구성원 정보 저장" : "초대 구성원 정보 저장"}
              </button>
              {profile?.role !== "admin" ? (
                <small>관리자만 권한을 변경할 수 있습니다.</small>
              ) : null}
            </div>
          ) : (
            <div className="empty-state">
              <div>
                <UserRound />
                <h3>구성원을 선택하세요.</h3>
              </div>
            </div>
          )}
        </form>
      </section>
    </>
  );
}
