import { ArrowRight, CheckCircle2, Clock3, FileText, Sparkles } from "lucide-react";
import Link from "next/link";

export function PlaceholderPage({ title, stage }: { title: string; stage: string }) {
  return (
    <>
      <header className="page-header"><div className="page-title-group"><span className="eyebrow">준비 중</span><h1>{title}</h1><p>{stage} 영역의 상세 기획을 받아 현재 서버 구조 위에 연결할 예정입니다.</p></div></header>
      <section className="placeholder-hero panel"><span><Sparkles size={24} /></span><h2>기능의 자리는 준비되어 있습니다.</h2><p>화면·데이터·권한·자동화 조건을 기획안으로 받으면 같은 사용성 구조 안에서 바로 확장합니다.</p><Link className="secondary-button" href="/knowledge"><FileText size={15} /> 관련 지식 확인 <ArrowRight size={14} /></Link></section>
      <section className="placeholder-grid"><div className="panel"><CheckCircle2 size={18} /><strong>준비된 기반</strong><p>공통 내비게이션, 로그인, 권한, API 오류 규격과 배포 구조가 마련돼 있습니다.</p></div><div className="panel"><Clock3 size={18} /><strong>필요한 기획</strong><p>사용자 행동, 저장 데이터, 승인 조건, 외부 서비스 연결 범위를 확정해야 합니다.</p></div></section>
    </>
  );
}
