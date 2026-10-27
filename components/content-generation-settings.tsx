import Link from "next/link";

export function ContentGenerationSettings() {
  return <section className="panel generation-settings"><h2>콘텐츠 자동화 설정</h2><p>생성 방식·대기열·예약 알림·자동 수집은 자동화 설정에서 관리합니다.</p><Link className="primary-button" href="/automation/settings">자동화 설정 열기</Link></section>;
}
