# BrandyAction OS 인수인계

기록 시점: 2026-09-05. 직원 수정요청·개발 관리 구현 완료, 운영 반영 전. 최신 원격 코드와 실제 배포 상태를 별도로 확인한다.

## 기준 코드

- 저장소: `brandyaction-ricky/OS`
- 착수 시 확인한 원격 `main`: `5f2beb1`
- 인계받은 개발 관리 기반: PR #23, `a6c2ae18` (`58fe81c`의 개발 관리 기능과 스타일 복구 포함)
- 현재 작업 브랜치: `codex/os-request-workflow-20260905`
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
- ESLint, TypeScript, 로컬 Production build 통과. 마지막 변경분의 전체 빌드와 원격 CI는 PR에서 재확인한다.
- 36개 메뉴의 코드 연결 확인. 브라우저 클릭 동작·모바일·라이트/다크 시각 검수는 미실시: 원격 브라우저 CDP 탭 조회가 시간 초과됨.
- 실제 OS Supabase는 연결 가능하며 기존 os_records 제약조건에 development_log/deployment는 없음. 회사 OS 프로젝트도 아직 등록 전이며 기존 MYIN 프로젝트는 보존해야 한다.
- 운영 DB migration 적용 시도는 자동 승인 검토에서 거부됨. 사유: 제약조건·권한 트리거·인덱스 변경의 구체적 운영 범위 승인 필요. DB 변경·직원 계정 변경·main 병합·Production 배포 없음.
- migration 013은 미병합 초안이므로 이번 요청 보호 트리거를 같은 파일에 통합했다. 실제 마이그레이션 이력과 SQL 제약조건을 모두 대조할 것(기존 수동 적용으로 이력과 차이가 있음).
- tests/development-request-rls.sql은 migration 적용 후 실행하며, 테스트 요청/이벤트는 ROLLBACK한다. 아직 실제 DB에서 실행하지 않음.

## 다음 실행 순서

1. 이번 작업 브랜치의 PR·Preview·GitHub Actions 결과 확인. PR #23의 기반 변경도 포함되어 있으므로 중복 병합하지 않는다.
2. 연결이 복구된 브라우저로 Preview의 요청 생성→상세→결과 저장→재요청, 검색/필터/모달·모바일·테마를 검수한다. Preview가 데모 환경이면 운영 저장 검증과 구분한다.
3. 사용자가 구체적인 운영 변경 범위를 승인하면 migration 013(기존 유형 유지·로그/배포 유형 추가·요청 권한 트리거·인덱스) 적용 후 롤백 DB 테스트를 실행한다.
4. main 통합·CI·Production Ready와 배포 SHA 확인. 계정/DB 데이터 초기화 없이 진행한다.
5. 기존 중복 여부 확인 후 브랜디액션 OS 프로젝트를 등록하고 저장소 brandyaction-ricky/OS, 운영 URL을 연결한다. 이번 변경의 개발 로그와 실제 배포 기록을 남긴다.
6. 직원·관리자 세션으로 저장과 새로고침 유지, 처리 권한, 재요청을 검증한다. 모든 기존 페이지의 버튼 QA는 별도 미완료 범위로 계속한다.

현재 Work MCP를 상시 실행시키는 자동 수정·배포는 구성하지 않았다. 상단 요청 배지/메뉴는 열린 화면에서 60초 및 탭 복귀 시 갱신하며, Work는 복사한 인수인계 또는 기존 OS MCP로 작업을 시작한다.
