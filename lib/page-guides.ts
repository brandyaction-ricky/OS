export interface PageGuideDefinition { steps: readonly [string,string,string]; next: string }
// Text is the final handoff's section 6; menu aliases resolve before this lookup.
export const PAGE_GUIDES: Record<string,PageGuideDefinition> = {
  "/home": {steps:["위에서부터 기한이 빠른 일을 처리합니다","‘검토·승인’ 탭에서 내 검토 차례를 확인합니다","막힌 일은 링크를 눌러 해결 화면으로 갑니다"],next:"/content/topics"},
  "/content/topics": {steps:["매일 보는 채널을 모읍니다 — 비어 있으면 채널 탐색 사전에서 시작","‘탐색’에서 근거 영상을 연결하고 준비도 네 칸을 채웁니다","‘틈새’에서 소구점을 선택해 승인 요청한 뒤 기획으로 넘깁니다"],next:"/content/scripts"},
  "/content/scripts": {steps:["위에서 작업 중인 영상을 고르면 그 폴더가 열립니다","단계 칩으로 지금 단계의 문서만 봅니다","다듬기가 끝나면 문서를 검토 요청합니다"],next:"/content/packages"},
  "/content/packages": {steps:["‘검색’에서 시장 썸네일을 근거로 모읍니다","제목 · 썸네일 후보를 뽑습니다","채택한 안을 저장함에 넣습니다"],next:"/content/shorts"},
  "/content/shorts": {steps:["원본 영상과 스타일 템플릿을 정합니다","‘클립’에서 쓸 구간을 고릅니다","승인한 구간을 제작으로 넘깁니다"],next:"/content/publishing"},
  "/content/publishing": {steps:["‘파생 만들기’에서 최종 롱폼으로 쇼츠 · Threads · 카드뉴스를 만듭니다","‘검토·발행 대기’에서 검토하고 최종 승인합니다","게시 설정에서 계정 · 시각을 정해 예약합니다"],next:"/content/youtube"},
  "/content/youtube": {steps:["영상을 고릅니다","발행 키트를 만듭니다","최종 확인 후 YouTube에 올립니다"],next:"/content/performance"},
  "/content/comments": {steps:["‘답할 것’에서 질문부터 봅니다","초안을 받아 고친 뒤 답글을 보냅니다","좋은 질문은 ① 주제·기획으로 보냅니다"],next:"/content/performance"},
  "/content/performance": {steps:["플랫폼 탭을 고릅니다","같은 경과일(D+7 등)끼리 비교합니다","n<5면 결론을 미룹니다"],next:"/content/topics"},
  "/knowledge": {steps:["폴더에서 문서를 엽니다","정본을 고치면 변경 제안으로 저장되어 승인 전 원문은 그대로입니다","‘연결’ 탭에서 깨진 링크를 골라 수정하고 문서 담당을 확인합니다"],next:"/knowledge/review"},
  "/knowledge/search": {steps:["찾을 말을 넣습니다","결과에서 정본 배지가 있는 문서를 먼저 봅니다","없으면 새 문서를 만듭니다"],next:"/knowledge"},
  "/knowledge/review": {steps:["문서 검토 또는 정본 변경 제안을 선택합니다","줄 단위 변경과 미리보기·댓글을 확인합니다","작성자와 다른 승인자 또는 위임자가 승인합니다"],next:"/knowledge"},
  "/organization/meetings": {steps:["회의 녹음이나 메모를 올립니다","뽑힌 결정 · 업무를 검수합니다","업무는 담당 · 기한을 정해 확정합니다"],next:"/organization/tasks"},
  "/organization/tasks": {steps:["‘분류 대기’부터 담당 · 기한을 정합니다","내 업무를 진행 상태로 옮깁니다","끝나면 완료로 옮깁니다"],next:"/home"},
  "/organization/schedule": {steps:["이번 주 회의 · 마감을 확인합니다","휴가를 신청합니다","승인 대기를 처리합니다"],next:"/home"},
  "/organization/members": {steps:["구성원과 역할을 확인합니다","새 직원 계정을 만듭니다(관리자)","관리자는 공용 계정을 표시해 AI 키 경고를 켭니다"],next:"/settings/access"},
  "/knowledge/development": {steps:["불편한 점을 요청으로 남깁니다","상태(접수 · 수정 중 · 검수 요청 · 해결)를 확인합니다","검수 요청이 오면 확인합니다"],next:"/knowledge/development?tab=updates"},
  "/knowledge/development?tab=updates": {steps:["최근 배포를 확인합니다","바뀐 화면을 직접 열어 봅니다","문제가 있으면 수정 요청을 남깁니다"],next:"/knowledge/development"},
  "/organization/agents": {steps:["대기 · 처리 중 작업을 확인합니다","실패한 작업의 사유를 봅니다","필요하면 다시 요청합니다"],next:"/home"},
  "/settings/connections": {steps:["회사 앱 연결이 ‘연결됨’인지 봅니다","사람별 채널 현황과 테스터 요청을 확인합니다","‘운영 점검’에서 막힌 작업을 확인합니다"],next:"/settings/audit"},
  "/settings/access": {steps:["역할과 AI 키의 단계·만료일을 확인합니다","공용 계정 키는 개인 계정 재발급 요청 알림을 보냅니다","새 키 발급과 기존 키 폐기는 관리자가 별도로 진행합니다"],next:"/settings/audit"},
  "/settings/audit": {steps:["기간을 고르면 서버에서 그 기간의 기록을 찾습니다","연속 수정을 펼쳐 변경 전·후 차이를 봅니다","권한이 있는 기록은 사유를 적고 이전 내용으로 새 버전을 만듭니다"],next:"/settings/connections"},
  "/settings/company": {steps:["승인자와 기간 위임을 확인합니다","브랜드 · 표시 이름을 확인합니다","텔레그램 승인 대기를 처리합니다"],next:"/settings/connections"},
  "/settings/account": {steps:["내 YouTube · 인스타 · Threads를 하나씩 연결합니다","같이 쓸 계정은 ‘팀 공유’를 켭니다 — 켜면 직원 누구나 게시 · 답글","‘만료’가 뜨면 ‘다시 연결’ — 내 할 일 ‘막힌 일’에도 올라옵니다"],next:"/content/publishing"},
};
export const guideClosedKey = (path:string) => `brandy-os-guide-closed:${path}`;
