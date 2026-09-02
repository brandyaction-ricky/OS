"use client";

import { CheckCircle2, KeyRound, LockKeyhole } from "lucide-react";
import { FormEvent, useState } from "react";
import { getBrowserSupabase } from "@/lib/supabase/client";
import { useSession } from "./session-provider";

export function PasswordChangeForm({ forced = false, onCancel }: { forced?: boolean; onCancel?: () => void }) {
  const { accessToken, profile, demo } = useSession();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const currentPassword = String(form.get("currentPassword") || "");
    const newPassword = String(form.get("newPassword") || "");
    const confirmPassword = String(form.get("confirmPassword") || "");
    if (newPassword !== confirmPassword) {
      setError("새 비밀번호 확인이 일치하지 않습니다.");
      return;
    }
    setBusy(true); setError("");
    try {
      const response = await fetch("/api/v1/account/password", {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${accessToken}` },
        body: JSON.stringify({ currentPassword, newPassword }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body?.error?.message || "비밀번호를 변경하지 못했습니다.");
      await getBrowserSupabase()?.auth.signOut({ scope: "local" });
      window.location.assign("/login?password=changed");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "비밀번호를 변경하지 못했습니다.");
      setBusy(false);
    }
  };

  return (
    <section className={forced ? "password-gate" : "password-modal-card"}>
      <form className="password-change-card" onSubmit={submit}>
        <div className="password-change-icon"><KeyRound size={22} /></div>
        <span className="eyebrow">계정 보안</span>
        <h1>{forced ? "개인 비밀번호를 먼저 설정해 주세요" : "비밀번호 변경"}</h1>
        <p>{forced ? "최초 로그인 또는 관리자 초기화 후에는 비밀번호를 변경해야 OS를 사용할 수 있습니다." : "현재 비밀번호를 확인한 뒤 새 비밀번호로 변경합니다."}</p>
        <div className="password-account"><LockKeyhole size={15} /><span><strong>{profile?.displayName}</strong><small>{profile?.email}</small></span></div>
        <label><span>현재 비밀번호</span><input type="password" name="currentPassword" autoComplete="current-password" minLength={6} maxLength={72} required /></label>
        <label><span>새 비밀번호</span><input type="password" name="newPassword" autoComplete="new-password" minLength={10} maxLength={72} required /></label>
        <label><span>새 비밀번호 확인</span><input type="password" name="confirmPassword" autoComplete="new-password" minLength={10} maxLength={72} required /></label>
        <div className="password-rules"><CheckCircle2 size={14} /><span>10자 이상 · 영문·숫자·특수문자 포함 · 최초 비밀번호 재사용 불가</span></div>
        {error ? <div className="form-error">{error}</div> : null}
        <div className="password-change-actions">
          {!forced && onCancel ? <button type="button" className="secondary-button" disabled={busy} onClick={onCancel}>취소</button> : null}
          <button className="primary-button" disabled={busy || demo}>{busy ? "변경 중…" : "비밀번호 변경"}</button>
        </div>
      </form>
    </section>
  );
}
