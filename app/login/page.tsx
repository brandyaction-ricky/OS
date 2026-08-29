"use client";

import { ArrowRight, CheckCircle2, LockKeyhole, Mail, Sparkles } from "lucide-react";
import { useSearchParams } from "next/navigation";
import { FormEvent, Suspense, useState } from "react";
import { getBrowserSupabase } from "@/lib/supabase/client";

function LoginForm() {
  const searchParams = useSearchParams();
  const next = searchParams.get("next") ?? "/home";
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
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
    const { error: authError } = await supabase.auth.signInWithOtp({
      email,
      options: { emailRedirectTo: `${window.location.origin}${next}` },
    });
    setLoading(false);
    if (authError) setError(authError.message);
    else setSent(true);
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
          {sent ? (
            <div className="login-success">
              <span><Mail size={25} /></span>
              <h2>로그인 링크를 보냈습니다</h2>
              <p><strong>{email}</strong> 메일함에서 링크를 눌러 브랜디 OS로 들어오세요.</p>
              <button type="button" className="text-button" onClick={() => setSent(false)}>다른 이메일 사용</button>
            </div>
          ) : (
            <>
              <span className="eyebrow">TEAM SIGN IN</span>
              <h2>회사 계정으로 시작하기</h2>
              <p>등록된 이메일로 일회용 로그인 링크를 보내드립니다.</p>
              <label>
                <span>회사 이메일</span>
                <div className="input-with-icon"><Mail size={17} /><input type="email" required value={email} onChange={(event) => setEmail(event.target.value)} placeholder="name@brandyaction.com" /></div>
              </label>
              {error ? <div className="form-error">{error}</div> : null}
              <button className="primary-button full" disabled={loading}>
                {loading ? "보내는 중…" : "로그인 링크 받기"}<ArrowRight size={17} />
              </button>
              <small className="security-note"><LockKeyhole size={13} /> 허용된 회사 계정만 접근할 수 있습니다.</small>
            </>
          )}
        </form>
      </section>
    </main>
  );
}

export default function LoginPage() {
  return <Suspense><LoginForm /></Suspense>;
}
