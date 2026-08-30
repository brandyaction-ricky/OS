"use client";

import {
  CheckCircle2,
  CircleAlert,
  ShieldCheck,
  UserRound,
  Users,
} from "lucide-react";
import { FormEvent, useEffect, useState } from "react";
import { useSession } from "./session-provider";

interface Member {
  id: string;
  email: string;
  display_name: string;
  role: "member" | "lead" | "admin";
  team: string;
  affiliation: string;
  roles: string[];
  onboarding: Record<string, boolean>;
  finance_access: boolean;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

const TEAM_ROSTER = [
  { name: "안저", affiliation: "브랜디액션" },
  { name: "리키", affiliation: "브랜디액션" },
  { name: "제이", affiliation: "브랜디액션" },
  { name: "에릭", affiliation: "브랜디액션" },
  { name: "유쓰", affiliation: "브랜디액션" },
  { name: "로건", affiliation: "브랜디액션" },
  { name: "시아", affiliation: "브랜디액션" },
  { name: "윤익", affiliation: "RS 협업" },
  { name: "란다", affiliation: "RS 협업" },
];
const ONBOARDING = [
  ["account", "OS 계정"],
  ["role", "역할·권한"],
  ["knowledge", "정본 검색"],
  ["workflow", "업무 흐름"],
] as const;

async function memberRequest<T>(
  token: string | null,
  options: RequestInit = {},
) {
  const response = await fetch("/api/v1/members", {
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
  const [saving, setSaving] = useState(false);
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
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!selected) return;
    const form = new FormData(event.currentTarget);
    setSaving(true);
    try {
      await memberRequest(accessToken, {
        method: "PATCH",
        body: JSON.stringify({
          id: selected.id,
          displayName: form.get("displayName"),
          role: form.get("role"),
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
    } catch (reason) {
      setError(
        reason instanceof Error ? reason.message : "저장하지 못했습니다.",
      );
    } finally {
      setSaving(false);
    }
  };
  const active = members.filter((member) => member.is_active).length;
  const admins = members.filter(
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
      <section className="metric-grid compact-metrics">
        <div className="metric-card">
          <div className="metric-top">
            <span>전체 계정</span>
            <span className="metric-icon">
              <Users size={16} />
            </span>
          </div>
          <div className="metric-value">{members.length}</div>
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
          <div className="metric-value">{members.length - active}</div>
          <div className="metric-caption">접근 차단 계정</div>
        </div>
      </section>
      <section className="roster-grid">
        {TEAM_ROSTER.map((person) => {
          const account = members.find((member) =>
            member.display_name.includes(person.name),
          );
          return (
            <article className="panel roster-card" key={person.name}>
              <span className="avatar">
                <UserRound size={15} />
              </span>
              <div>
                <strong>{person.name}</strong>
                <small>{person.affiliation}</small>
              </div>
              <em className={account?.is_active ? "ready" : "waiting"}>
                {account?.is_active ? "계정 연결" : "초대 대기"}
              </em>
            </article>
          );
        })}
      </section>
      <section className="members-layout">
        <div className="panel member-list">
          {members.map((member) => (
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
              <p>{selected?.email ?? "목록에서 구성원을 선택하세요."}</p>
            </div>
            {selected ? (
              <span className="role-badge">{selected.role}</span>
            ) : null}
          </div>
          {selected ? (
            <div className="member-fields">
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
                  disabled={profile?.role !== "admin"}
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
                  disabled={profile?.role !== "admin"}
                />
                <span>경영지원 민감정보 접근</span>
              </label>
              <label className="toggle-label">
                <input
                  type="checkbox"
                  name="isActive"
                  defaultChecked={selected.is_active}
                  disabled={profile?.role !== "admin"}
                />
                <span>계정 사용 허용</span>
              </label>
              <button
                className="primary-button"
                disabled={saving || profile?.role !== "admin"}
              >
                {saving ? "저장 중…" : "구성원 정보 저장"}
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
