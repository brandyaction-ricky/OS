"use client";

import { ArrowRight, CheckCircle2, Eye, EyeOff, LockKeyhole, Mail, Sparkles } from "lucide-react";
import { useSearchParams } from "next/navigation";
import { FormEvent, Suspense, useState } from "react";
import { getBrowserSupabase } from "@/lib/supabase/client";

function LoginForm() {
  const searchParams = useSearchParams();
  const next = searchParams.get("next") ?? "/home";
  const passwordChanged = searchParams.get("password") === "changed";
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const supabase = getBrowserSupabase();
    if (!supabase) {
      window.location.assign(next);
      return;
    }
    setLoading(true);
    setError("");
    const { error: authError } = await supabase.auth.signInWithPassword({
      email,
      password,
    });
    setLoading(false);
    if (authError) {
      setError(
        authError.message === "Invalid login credentials"
          ? "이메일 또는 비밀번호가 올바르지 않습니다."
          : authError.message,
      );
      return;
    }
    window.location.assign(next);
  };

  return (
    <main className="login-page">
      <section className="login-story">
        <div className="brand-lockup"><span className="brand-mark large">BA</span><strong>BRANDY OS</strong></div>
        <div className="story-content">
          <span className="eyebrow accent">COMPANY OPERATING SYSTEM</span>
          <h1>회사의 경험이<br />다음 사람의 <em>실행력</em>이 됩니다.</h1>
          <p>흩어진 문서와 결정을 연결하고, 회사의 정본을 근거로 누구나 더 빠르게 실행합니다.</p>
          <div className="story-points">
            <span><Sparkles size={17} /> 회사 지식 통합 검색</span>
            <span><CheckCircle2 size={17} /> 검토를 거친 공식 정본</span>
            <span><LockKeyhole size={17} /> 팀과 역할별 접근 제어</span>
          </div>
        </div>
        <small>BRANDYACTION · INTERNAL</small>
      </section>
      <section className="login-panel">
        <form className="login-card" onSubmit={submit}>
          <div className="mobile-brand"><span className="brand-mark">BA</span><strong>브랜디 OS</strong></div>
          <span className="eyebrow">팀 로그인</span>
          <h2>팀 계정으로 로그인</h2>
          <p>등록된 이메일과 비밀번호로 로그인하면 접속 상태가 안전하게 유지됩니다.</p>
          {passwordChanged ? <div className="inline-alert success"><CheckCircle2 size={15} /> 비밀번호가 변경되었습니다. 새 비밀번호로 다시 로그인해 주세요.</div> : null}
          <label>
            <span>이메일</span>
            <div className="input-with-icon"><Mail size={17} /><input type="email" autoComplete="username" required value={email} onChange={(event) => setEmail(event.target.value)} placeholder="name@brandyaction.com" /></div>
          </label>
          <label className="password-field">
            <span>비밀번호</span>
            <div className="input-with-icon">
              <LockKeyhole size={17} />
              <input type={showPassword ? "text" : "password"} autoComplete="current-password" required minLength={6} value={password} onChange={(event) => setPassword(event.target.value)} placeholder="비밀번호 입력" />
              <button type="button" className="password-toggle" aria-label={showPassword ? "비밀번호 숨기기" : "비밀번호 보기"} onClick={() => setShowPassword((visible) => !visible)}>
                {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
              </button>
            </div>
          </label>
          {error ? <div className="form-error">{error}</div> : null}
          <button className="primary-button full" disabled={loading}>
            {loading ? "로그인 중…" : "로그인"}<ArrowRight size={17} />
          </button>
          <small className="security-note"><LockKeyhole size={13} /> 사전에 등록되고 사용 허용된 구성원만 접근할 수 있습니다.</small>
        </form>
      </section>
    </main>
  );
}

export default function LoginPage() {
  return <Suspense><LoginForm /></Suspense>;
}
