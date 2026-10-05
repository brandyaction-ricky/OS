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

## 게시·예약 검수 경계

- 실계정 자동 게시 코드는 서비스 전용 승인 체크포인트와 별도 공개 스위치로 이중 잠금한다. `META_MODE=live`만으로는 켜지지 않는다. 정확한 체크포인트 마이그레이션 적용 뒤 `PUBLICATION_APPROVAL_CHECKPOINTS_ENABLED=true`, 연결 계정 한 건 검수 뒤 `META_LIVE_PUBLISH_ENABLED=true`를 각각 승인해 설정해야 한다. 게시 레코드는 계속 사용자 RLS 클라이언트로 갱신하며 service role은 브라우저가 접근할 수 없는 승인 증거에만 쓴다.
- 카드 렌더는 폐기한 contents-auto를 복사하지 않고 OS 토큰·Pretendard를 사용하는 로컬 Canvas로 새로 구현했다. 1080×1350 PNG, 비공개 제작 저장소를 사용한다. 개발자 문서 접근이 제한된 IG API 어댑터는 실계정 검증 전 설계 초안이다.
- 문안·계정·원본 버전이 바뀌면 재승인한다. 글타래는 각 게시 ID를 저장하고 남은 부분만 재시도한다. 응답이 불분명하거나 중간 저장에 실패하면 자동 재게시를 멈춘다. 결과 조정 UI는 실게시 공개 전 추가해야 한다.
- `CHANNEL_SYNC_ENABLED=false` 기본값이며 인증된 cron만 호출한다. 별도 DB 적용 후에만 활성화한다. 자동화 설정의 ‘성과·댓글 자동 수집’도 켜져 있어야 선택한 채널의 수집을 실행한다. 예약 알림·7일 이내 만료 알림은 설정과 무관하게 보내되 게시·답글·숨기기는 하지 않는다. Telegram은 OS 프로필에 매핑된 승인된 개인 대화에 제목 없이 안내한다. 최초 OS 알림 저장 때 한 번 시도하며 Telegram 실패 재전송은 아직 없다. 누락은 응답의 실패 수로 표시된다.
- 공개 API의 계정 권한·기본값·모의 실패·중복 방지 시험과 별개로 실제 DB 트리거/RLS/알림 전달은 미검증이다. 새 댓글 제약·알림 함수 마이그레이션은 적용하지 않았다.

## 수행하지 않은 검증

성과 수집은 D1/D7/D28 경과 후 각 24시간 창 안에서만 저장한다. 지나간 스냅샷은 현재 누적값으로 채우지 않는다. 수집하지 못한 지표는 제외하고 missingMetrics로 센다. 자동 기록은 기존 수기 기록과 별도 보존하며 일반/AI 기록 API로 덮어쓰거나 지울 수 없다. YouTube는 새 OAuth 연결부터 `yt-analytics.readonly`를 요청하고, 기존 연결에 권한이 없으면 재연결 필요 건수로 남긴다. [Google YouTube Analytics reports.query](https://developers.google.com/youtube/analytics/reference/reports/query)와 [Meta 공식 Threads 게시물 성과](https://www.postman.com/meta/threads/request/ndeeu6p/get-post-insights)를 기준으로 했으며 Instagram 실제 지표 지원은 계정·게시 형식별 사전 확인이 남아 있다. 수집 API는 GET뿐이며 외부 게시 동작은 없다.

댓글 수집은 최근 14일의 게시 완료 기록에서 외부 ID를 읽는다. 동일 플랫폼·계정·댓글은 결정적 ID와 유일 인덱스로 한 번만 넣고, 이미 담당/답글/숨김 처리된 기록을 덮어쓰지 않는다. 현재 한 번에 게시물 100개, 댓글 페이지 5개 한도이며 초과는 truncated로 표시한다. Instagram 중첩 답글 수집은 추가 검수가 필요하다. 실제 답글·숨기기는 실게시와 같은 이유로 서버에서 잠가 두었다.

Threads 읽기와 중첩 관계 필드는 [Meta 공식 Threads API 컬렉션](https://www.postman.com/meta/threads/documentation/dht3nzz/threads-api?entity=request-34203612-74fb48b1-ad1a-480e-b200-4dcdb8126a2f)을 참조했다. 실제 계정 응답·페이징·권한 범위는 아직 확인하지 않았다.

실제 DEV/운영 DB 적용, RLS 연결 시험, Instagram 프로페셔널 계정 OAuth, Threads OAuth, 토큰 만료·갱신, 실게시, 실제 테스터 알림 전달은 아직 검증하지 않았다. Instagram Login의 계정 유형 응답과 앱별 scope 허용은 실계정 연결 검수에서 확인해야 한다. API 응답 차이는 안전하게 연결 실패로 처리한다. Meta 테스터 수 제한 및 Instagram 첫 댓글 API 지원 여부는 미확정이다.

Google 앱 게시 상태 역시 확인하지 않았다. 외부 테스트 앱의 갱신 토큰은 기본 권한만 요청하는 예외를 제외하면 7일 만료 영향을 받는다.

## 공식 참조

- [Google OAuth 2.0 토큰 만료](https://developers.google.com/identity/protocols/oauth2#expiration)
- [YouTube Analytics reports.query](https://developers.google.com/youtube/analytics/reference/reports/query)
- [Meta Instagram Login 공식 컬렉션](https://www.postman.com/meta/instagram/folder/6raa77c/instagram-api-with-instagram-login)
- [Meta Threads 공식 컬렉션](https://www.postman.com/meta/threads/folder/34203612-e0373e84-de6b-46f1-b90d-3fea76ba6782)

Meta 개발자 문서의 일부 페이지는 로그인·요청 제한 때문에 확인하지 못했다. 코드가 있다는 사실은 실계정 OAuth 성공의 증거가 아니다.
