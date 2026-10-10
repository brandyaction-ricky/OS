# 콘텐츠 자동화 v0.7 개발 인계 (DEV DB 검증 전)

- 작업 위치: `/Users/ricky/Projects/brandyaction-os/.worktrees/content-automation-v07-20261010`
- 브랜치: `codex/content-automation-v07-20261010`
- 기반 커밋: `9346cb1543668aa7c9e8a12305597c3f51ad3c69` (선행 회사 문서 작업 브랜치)
- 구현 커밋: `1613699` (인계 파일 비공개), `67c644a` (메뉴·주소), `acff2b8` (v0.7 화면·API·추가형 SQL), `ae34f0a` (작업 예정 표시·개인 버전 복원 경계)
- PR: https://github.com/brandyaction-ricky/OS/pull/166 — 선행 PR #165를 기준으로 한 초안

## 구현 및 검증

10개 콘텐츠 자동화 메뉴, 개인 주제·채널 콘텐츠·AI 작업함, Chrome 전용 AI 작업 화면, 최종 확인 기록, 수동 게시 기록, 댓글·성과 화면, 예약 알림, 개인 공간 API·RLS 경계를 추가했다. 회사 문서의 본문·소유자·폴더·상태를 변경하는 코드는 없다. 새 SQL은 `20261011002800_content_automation_v07.sql` 1건이며 기존 행의 이관·백필을 자동 실행하지 않는다. 마이그레이션 무결성 검사를 위해 `migration-baseline.json`에 SHA-256을 등록했다.

- `npm run verify`: 통과. 단위검사 765건 통과, 빌드 통과. 기존 `publication-settings-panel.tsx`의 이미지 요소 경고 1건은 남았다.
- `npx playwright test --workers=3` (빌드된 로컬 서버): 152건 통과, 외부 로그인·DB가 필요한 8건 건너뜀.
- 최종 수정 후 관련 Playwright 9건 재검사: 통과.
- `npm run db:migrations:verify`: 무결성 통과, 적용 승인은 보류 상태(`readyToApply: false`).
- 실제 DEV 로그인 두 계정의 개인 공간 격리, Claude in Chrome 실행, 실 DB 기록·발행·성과 수집, 알림 크론은 미검증.

## 환경과 출시 상태

GitHub 브랜치는 원격에 올라갔고 Vercel Preview는 첫 구현 커밋으로 빌드 완료됐다. 후속 커밋의 Preview는 별도로 확인한다. DEV 고정 주소와 DEV Supabase에는 반영하지 않았다. 운영 DB·운영 앱에도 변경이 없다. BrandyAction DEV Supabase 프로젝트가 현재 연결된 Supabase 도구 목록에 없으므로, 대상 식별과 별도 승인 전에는 SQL을 적용하지 않는다. 선행 PR #165가 열려 있으므로 병합 순서도 유지해야 한다.

## 남은 검증과 기능 범위

1. DEV Supabase 연결과 마이그레이션 적용 승인 후 실제 계정 2개로 개인 기록 읽기·쓰기 차단, 직접 확인, 게시 이벤트, worker 잠금·재시도·일일 한도를 검증한다.
2. 실제 Chrome의 Claude in Chrome으로 등록→가져오기→결과 제출→종료를 1회 시험한다. AI 화면은 지시문으로 운영하므로 사람이 아닌 AI가 다른 화면으로 이동하는 것을 서버가 판별할 수 없다.
3. 수동 게시 URL만으로 외부 API의 게시물 식별자와 계정 연결을 확정할 수 없어 자동 성과·댓글 수집을 보장하지 않는다. 연결 계정·외부 ID 매칭과 실제 게시 흐름은 DEV에서 검증·보완해야 한다.
4. 첨부 시안의 서버 CSV API, 스킬 버전 복원, 로그인 만료 시각 표시, 모든 모달의 초점 순환, 10개 화면 전 조합 캡처는 아직 완료되지 않았다. 작업별 처리 예정(`queueInfo`)은 서버 계산과 작업 목록 표시에 추가했다. 이 PR은 DEV 완료 전 초안으로 둔다.
5. DEV 완료·사용자 확인 후 운영 DB 변경과 병합·배포는 별도 범위 승인을 받는다.

회사 OS 개발 관리에는 로컬 환경 전환 기간의 쓰기 제한에 따라 기록하지 않았다. OS 동기화는 보류한다.
