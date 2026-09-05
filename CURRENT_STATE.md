# BrandyAction OS 인수인계

기록 시점: 2026-09-05 UTC. 직원 수정요청·개발 관리 운영 반영 완료. 로그인 브라우저 E2E·시각 검수는 아직 미완료다. 최신 원격 코드와 실제 배포 상태를 별도로 확인한다.

## 기준 코드

- 저장소: `brandyaction-ricky/OS`
- 착수 시 확인한 원격 `main`: `5f2beb1`
- 인계받은 개발 관리 기반: PR #23, `a6c2ae18` (`58fe81c`의 개발 관리 기능과 스타일 복구 포함)
- 구현 브랜치: `codex/os-request-workflow-20260905`, 구현 커밋 `2e75164`
- PR #24 병합 완료: <https://github.com/brandyaction-ricky/OS/pull/24>
- 운영 기능 반영 커밋: `2ae34fcbe0cce59ae9fded37a02c3b8a11e8f0a0`
- 이후 인수인계 문서만 갱신한 커밋이 있을 수 있다. 기능 반영 SHA와 문서 커밋을 구분한다.
- 운영 주소: <https://brandyaction-os.vercel.app>
- 원격 `main`, 작업 브랜치, 실제 운영 배포 SHA를 각각 확인한다. 위 SHA만으로 현재 운영 상태를 단정하지 않는다.

## 이번 작업 범위

1. 직원이 화면에서 수정 요청을 남기고 `/knowledge/development`에서 추적하는 흐름.
2. 요청별 Work용 요청문 복사, 관리자 처리 상태·해결 내용, 브랜치·커밋·PR·배포 URL 연결.
3. 개발 로그·배포 결과를 OS에서 직접 남기는 화면과 역할별 API 보호.
4. 기존 OS 구성에 맞춘 Linear 참고 UI와 실제 기능 점검.
5. [개발 운영 안내](docs/DEVELOPMENT_WORKFLOW.md)와 PR 템플릿으로 다음 채팅에서 이어가기.

현재 범위는 요청 접수와 Work 인수인계다. 상시 자동 감시나 요청 등록 즉시 AI가 코드를 수정·배포하는 연결을 완료했다고 가정하지 않는다.

## 데이터와 기존 기능

- PR #23에는 프로젝트 맥락 API와 `development_log`, `deployment` 운영 기록 유형 및 migration `202609040013_development_operations.sql`이 포함되어 있다.
- 수정 요청은 기존 `ai_job` 유형과 `metadata.kind = development_request`로 식별한다.
- 요청 상태는 `backlog`(접수), `active`(수정 중), `review`(검수 요청), `done`(해결), `blocked`(보류)다.
- 운영 migration 적용 여부는 실제 DB 이력으로 확인해야 한다. 새 요청 권한 보호 migration도 검토·적용 여부를 기록한다.
- 운영 데이터, 직원 계정, 기존 연결을 보존한다. 비밀값과 개인정보는 이 파일에 기록하지 않는다.

## 검증·운영 반영 상태

- 자동 테스트 112개 통과(API 정책·권한·충돌·링크·Work 인수인계 함수 테스트 포함).
- ESLint, TypeScript, 로컬 Production build 통과. 구현 PR validate #97 및 main validate 통과: <https://github.com/brandyaction-ricky/OS/actions/runs/33974146284>.
- 36개 메뉴의 코드 연결 확인. 브라우저 클릭 동작·모바일·라이트/다크 시각 검수는 미실시: 원격 브라우저 CDP 탭 조회가 시간 초과됨.
- 운영 DB 변경은 최초 자동 승인 검토에서 거부됐으나 사용자의 구체적 변경·배포 승인 후 적용 완료. migration 이력 `20260905150938 / development_operations_requests`가 저장소 migration 013에 대응한다.
- 기존 record_type은 모두 유지하고 development_log/deployment, 요청 권한 트리거, 이력/요청 인덱스만 추가했다. 기존 데이터 건수 보존과 QA 요청 0건을 확인했다. 직원 계정 변경 없음.
- migration 013은 미병합 초안이므로 이번 요청 보호 트리거를 같은 파일에 통합했다. 실제 마이그레이션 이력과 SQL 제약조건을 모두 대조할 것(기존 수동 적용으로 이력과 차이가 있음).
- tests/development-request-rls.sql 실제 운영 DB 실행 통과: 직원 작성·수정, 임의 해결/유형변경/실행 URL 차단, 관리자 해결, 직원 재요청. QA 요청/이벤트는 ROLLBACK 완료.
- Vercel이 GitHub에 main 배포 성공을 보고함: <https://vercel.com/brandyaction-os/brandyaction-os/3JhxoTAvdx71CjDf27eCc7VLJyMW>.
- 운영 HTTP 검증: /api/v1/health 200 및 DB·auth·accountPassword ready, /knowledge/development 200, 신규 요청 GET/POST/PATCH 비로그인 401. 인증 후 사용자 흐름 검증과는 구분한다.
- Vercel 연결 계정의 brandyaction-os 팀 접근은 403. 런타임 로그·배포 세부 정보는 확인하지 못했다. GitHub 배포 체크와 공개 운영 HTTP를 검증 근거로 사용했다.
- 회사 OS 프로젝트 등록 완료: `35bd6f94-836d-454e-9f01-45591a811f35`. 기존 MYIN 프로젝트는 변경하지 않았다.
- 개발 로그 `2467f7f6-1740-4ef7-9551-a31b012c1704`, 배포 기록 `8adca132-0636-4b4f-afc1-82c3918d82b4`를 프로젝트에 연결해 저장했다. 사용자 승인에 따른 관리 DB 경로 기록이며 브라우저 폼 저장 검증은 아니다.
- 보안 advisor의 기존 SECURITY DEFINER 실행 권한 경고와 유출 비밀번호 보호 미설정은 후속 검토 대상. 이번 트리거는 SECURITY INVOKER이며 직접 실행 권한을 회수했다. 기존 정책을 임의로 넓히거나 제거하지 않는다. [권한 점검 기준](https://supabase.com/docs/guides/database/database-linter?lint=0028_anon_security_definer_function_executable).

## 다음 실행 순서

1. 최신 main 및 운영 배포 SHA와 OS의 최근 개발·배포 기록을 확인한다. PR #23의 기반 변경도 #24에 포함됐으므로 중복 병합하지 않는다. migration 013이나 회사 OS 프로젝트를 다시 생성하지 않는다.
2. 브라우저 연결이 복구되면 직원·관리자 세션으로 요청 생성→상세→결과 저장→새로고침 유지→재요청, 검색/필터/모달·모바일·테마를 검수한다. Preview 데모 검수와 운영 영속 저장 검증을 구분한다.
3. 직원 수정요청을 우선순위대로 처리하고 요청별 Work 인수인계로 작업을 시작한다. 전체 기존 페이지 버튼 QA는 여전히 미완료 범위다.
4. 작업마다 기능 브랜치·검증·PR·배포 결과를 OS에 기록한다. 로그인/키/결제/기존 운영 데이터는 요청 범위 밖에서 변경하지 않는다.

현재 Work MCP를 상시 실행시키는 자동 수정·배포는 구성하지 않았다. 상단 요청 배지/메뉴는 열린 화면에서 60초 및 탭 복귀 시 갱신하며, Work는 복사한 인수인계 또는 기존 OS MCP로 작업을 시작한다.
