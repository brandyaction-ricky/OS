# 콘텐츠 자동화 내부 구현 완료 기록

작성일: 2026-10-04  
제품: BrandyAction OS  
저장소: `brandyaction-ricky/OS`

## 범위

- 외부 `contents-auto` 링크에 의존하지 않고 콘텐츠 자동화 기능을 OS 내부 화면으로 제공한다.
- 대시보드, 최종 점검, Claude 요청함, 라이브러리, 발행 캘린더, 성과 기록, 카드뉴스 시안, 자동화 설정을 하나의 메뉴 묶음으로 연결한다.
- 기존 콘텐츠 공정, 문서, 승인, 검색, 첨부, 버전 계약을 유지한다.
- 실계정 게시·답글·숨김, 운영 DB 마이그레이션 적용, 운영 환경변수 변경과 운영 배포는 이번 범위가 아니다.

## 구현

- `/automation/*` 8개 내부 라우트와 `/content/comments`를 콘텐츠 자동화 메뉴로 구성했다.
- 기존 OS 기록을 이용하는 자동화 대시보드·통합 라이브러리와 카드뉴스 시안 CRUD를 추가했다.
- 관리자 자동화 설정을 회사 설정 기록으로 저장하며, 기존 기본 생성 방식은 새 설정 저장 전까지 호환값으로 읽는다.
- 설정값을 생성 버튼 기본 모드, 구독 대기 작업의 재시도 한도·내부 요청 기준, 예약 전 알림 시점, 채널별 댓글·성과 수집, 쇼츠 제안의 음성·음악·자막 기본값에 연결했다.
- YouTube OAuth에 Analytics 읽기 범위를 추가하고 D1/D7/D28 누적 성과를 기존 `content_metric` 계약으로 저장한다. 수기 기록과 누락값을 0으로 덮어쓰지 않는다.
- Meta 실계정 게시에는 서비스 전용 승인 체크포인트와 별도 공개 스위치를 모두 요구하도록 이중 잠금했다. 브라우저 클라이언트에는 체크포인트 접근 권한이 없다.
- 회사 설정의 이전 생성 방식 UI는 새 자동화 설정으로 이동하는 안내로 통합해 두 설정이 충돌하지 않게 했다.

## 데이터와 안전 경계

- 추가 마이그레이션: `20261004131203_content_publication_approval_checkpoints.sql`
- 마이그레이션은 추가형이며 `drop`, `delete`, `truncate`, 기존 데이터 갱신이 없다.
- 개발·운영 DB 어디에도 적용하지 않았다. 마이그레이션 무결성은 통과했지만 승인 대기 상태다.
- 기본값은 `META_MODE=mock`, `PUBLICATION_APPROVAL_CHECKPOINTS_ENABLED=false`, `META_LIVE_PUBLISH_ENABLED=false`, `CHANNEL_SYNC_ENABLED=false`, 자동 수집 꺼짐이다.
- 로컬 모의 QA에서 실제 OS/외부 서비스 데이터는 변경하지 않았다.
- 자동화 설정의 내부 요청 기준을 새 외부 전송 경로에 연결하지 않았다. API 직접 생성의 기존 전송 계약도 넓히지 않았다.

## 검증

- `npm test`: 560/560 통과
- `npx tsc --noEmit --incremental false`: 통과
- `npm run lint`: 오류 0, 기존 `publication-settings-panel.tsx`의 `<img>` 최적화 경고 1
- `npm run build`: 통과
- `npm run db:migrations:verify`: 무결성 통과, 활성 30개, 신규 포함 승인 대기 16개, 실제 적용 없음
- `npm run env:check -- --mode local --file .env.example`: 로컬 모의 환경 통과
- 로컬 브라우저 모의 QA: 자동화 8개 화면 데스크톱, 설정 390×844 모바일, 설정·카드뉴스 시안 저장 흐름 통과
- 브라우저 오류 오버레이·콘솔 오류·가로 넘침 없음

## 미검증·남은 관문

- 실제 Supabase 마이그레이션/RLS와 실제 계정 데이터 읽기·쓰기
- 실제 YouTube Analytics 권한 재동의 및 D1/D7/D28 수집
- 실제 Meta 게시·답글·숨김, Instagram 중첩 답글/첫 댓글 계약
- 일반 직원 계정의 실제 권한 QA
- DEV 마이그레이션 적용과 환경 스위치는 별도 승인 필요
- 운영 병합·환경값·배포·사후 확인은 별도 승인 필요

## Git·배포

- 작업 경로: `/Users/ricky/.codex/worktrees/content-automation/brandyaction-os`
- 브랜치: `codex/content-automation-os-20261004`
- 기준 커밋: `b9331c6d23f6d580f1190efaaf8f424d8aba1b57`
- 구현 커밋: `3028629897e8ddc4ae3014330fa62602c3c8d27b`
- PR: https://github.com/brandyaction-ricky/OS/pull/140
- 기준 PR: #139 위 stacked PR
- 실제 배포 상태: Vercel Preview 생성 중, 운영 배포 없음
- 되돌리기: PR의 구현·기록 커밋을 되돌리고 신규 환경 스위치를 꺼진 기본값으로 유지한다.

## OS 동기화

로컬 환경 이전 기간의 운영 쓰기 금지 규칙에 따라 회사 OS 개발 관리에는 자동 기록하지 않았다. 이 파일을 로컬 완료 정본으로 보존하며 OS 동기화는 대기 상태다.
