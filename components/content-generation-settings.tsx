import Link from "next/link";

export function ContentGenerationSettings() {
  return <section className="panel generation-settings"><h2>콘텐츠 자동화 설정</h2><p>기본 생성 방식, 구독 대기열 기준, 예약 알림과 자동 수집 설정을 한 화면에서 관리합니다. 이전 생성 방식 기록은 새 설정이 저장되기 전까지만 호환값으로 읽습니다.</p><Link className="primary-button" href="/automation/settings">자동화 설정 열기</Link></section>;
}
