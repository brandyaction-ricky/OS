# 계정별 채널 연결 — DEV 준비 및 검수 경계

이번 브랜치 기본값은 `META_MODE=mock`이다. `.env.example`에는 빈 키 이름만 추가한다. 운영 설정, 외부 계정, DB 마이그레이션을 자동 적용하지 않는다. 로컬 demo 화면은 연결·공유를 메모리에서만 바꾸며 새로고침하면 초기화된다.

## 환경 승인 이후 수동 준비

1. 적용 대상 DB와 마이그레이션 이력을 확인한다. 신규 SQL은 Meta 연결 표, YouTube 공유 열, YouTube 채널 유일 인덱스만 추가한다. 기존 중복 채널이 있다면 전체 트랜잭션이 실패하며 행을 수정하거나 삭제하지 않는다. 연결 주인 결정 후 별도 승인으로 정리해야 한다.
2. Meta 회사 앱에 해당 계정을 테스터로 등록하고 초대를 수락한다. OS의 ‘등록함’은 관리자의 확인 기록이며 Meta 역할을 변경하는 API가 아니다. 앱 심사·Advanced Access·비즈니스 인증은 범위 밖이다.
3. 검증된 비운영 환경에 `META_INSTAGRAM_APP_ID`, `META_INSTAGRAM_APP_SECRET`, `META_THREADS_APP_ID`, `META_THREADS_APP_SECRET`, `META_TOKEN_ENCRYPTION_KEY`, `OS_PUBLIC_URL`을 설정한다. 비밀값은 기록·캡처·클라이언트에 넣지 않는다.
4. OAuth 콜백은 OS 공개 주소의 `/api/v1/meta/callback`이다. YouTube 콜백은 `/api/v1/youtube/oauth/callback`이며 기존 명시적 redirect 설정을 유지한다.
5. 실계정 테스트 승인을 받은 뒤에만 `META_MODE=live`로 전환한다. 모의 연결을 실제 연결처럼 테스트하거나 갱신하지 못하도록 모드 불일치 시 거절한다.

## 권한·보관

- 사람 로그인만 연결·업로드·공유 관리 가능. 본인 채널 또는 팀 공유 채널만 사용 가능하다. 관리자가 남의 비공유 채널을 사용할 수는 없다.
- 공유 변경·다시 연결은 본인만, OS 연결 해제는 본인 또는 관리자만 가능하다.
- 연결 소유 OS 계정이 비활성이면 사용을 차단한다. 계정별 플랫폼 한 개, 외부 계정도 플랫폼별 한 번만 연결된다.
- 토큰은 서버 전용 표에 AES-GCM으로 암호화한다. anon/authenticated 표 접근 권한은 없다. 응답은 명시적 공개 필드만 반환한다.
- Meta 해제는 OS 연결만 해제한다. 외부 앱 권한은 플랫폼 설정에서 별도로 해제해야 한다.
- 연결·해제·공유·연결 테스트·업로드 확인은 기존 변경 기록에 남긴다. 범용 기록 API와 AI 키로 이 기록 및 테스터 등록 표시를 위조·덮어쓰기·보관할 수 없다.

## 수행하지 않은 검증

실제 DEV/운영 DB 적용, RLS 연결 시험, Instagram 프로페셔널 계정 OAuth, Threads OAuth, 토큰 만료·갱신, 실게시, 실제 테스터 알림 전달은 아직 검증하지 않았다. Instagram Login의 계정 유형 응답과 앱별 scope 허용은 실계정 연결 검수에서 확인해야 한다. API 응답 차이는 안전하게 연결 실패로 처리한다. Meta 테스터 수 제한 및 Instagram 첫 댓글 API 지원 여부는 미확정이다.

Google 앱 게시 상태 역시 확인하지 않았다. 외부 테스트 앱의 갱신 토큰은 기본 권한만 요청하는 예외를 제외하면 7일 만료 영향을 받는다.

## 공식 참조

- [Google OAuth 2.0 토큰 만료](https://developers.google.com/identity/protocols/oauth2#expiration)
- [Meta Instagram Login 공식 컬렉션](https://www.postman.com/meta/instagram/folder/6raa77c/instagram-api-with-instagram-login)
- [Meta Threads 공식 컬렉션](https://www.postman.com/meta/threads/folder/34203612-e0373e84-de6b-46f1-b90d-3fea76ba6782)

Meta 개발자 문서의 일부 페이지는 로그인·요청 제한 때문에 확인하지 못했다. 코드가 있다는 사실은 실계정 OAuth 성공의 증거가 아니다.
