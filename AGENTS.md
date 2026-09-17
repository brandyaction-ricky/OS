# Development completion records

- At the end of every development task, update the matching project in the company OS development management workspace. This is part of completion, not an optional follow-up.
- Resolve the project by its existing repository mapping. Keep OS, Edu, and Myin requests and development logs under their own project IDs; never create duplicates or store another project's work under OS by default.
- Record the change, verification performed and not performed, local commit, remote PR if created, environment, actual deployment state, and remaining work. Never infer deployment from a local build or mark unresolved work complete.
- Update the original request when applicable using its current version. Also save a development log linked to the same project and request. Read the saved record back before claiming it was recorded.
- Use authorized OS connectors or APIs. If access is read-only or a write is rejected, do not bypass it. Preserve the prepared completion note locally and clearly report that OS recording is pending.
- Do not publish employee data, request contents, internal identifiers, or secrets in public GitHub documentation. This instruction does not grant new deployment, publication, or credential permissions.

## Codex 실행 원칙 (로컬 개발환경 설정, 2026-09-17)

- 작업 시작 시 현재 branch, status, remote, worktree 목록과 기존 AGENTS.md 및 관련 하위 지침을 읽는다. 기존 파일·사용자 변경·브랜치를 삭제하거나 덮어쓰지 않는다. reset --hard, clean, 강제 push를 임의로 실행하지 않는다.
- main/master 및 공유 develop에서 직접 수정·커밋·push하지 않는다. 작업마다 codex/<task> 또는 기존 work/<task> 관례의 별도 브랜치와 격리 worktree를 사용한다. 작업 중인 다른 worktree의 브랜치를 전환하지 않는다.
- DEV: 범위와 완료 조건을 정하고 로컬/검증된 개발 환경에서 구현한다.
- QA: 실제 변경 커밋 기준으로 관련 테스트와 diff를 확인하고 수행/미수행 항목을 구분한다. 테스트 성공은 운영 승인이나 배포 성공을 의미하지 않는다.
- BUGFIX: QA 실패를 작업 브랜치에서 수정한 뒤 QA를 다시 통과한다. 결함이 없으면 해당 없음으로 기록한다.
- RELEASE: DEV → QA → BUGFIX(필요 시) → QA 재검증 후 릴리스 후보를 보고한다. main 병합, 원격 push로 유발되는 배포, 운영 배포는 대상·커밋·영향을 명시한 별도 사용자 승인 전 실행하지 않는다. 자동 배포 연결 여부도 먼저 확인한다.
- Production/운영 DB의 데이터·스키마·정책·설정은 임의 변경 금지. migration/seed/reset 명령을 자동 실행하지 않는다. 이번 환경 설정은 모든 DB 변경·배포·실결제 실행을 허가하지 않는다.
- 라이브 결제·환불·운영 webhook 호출·운영 배포/승격 및 운영 환경변수 변경 금지. 테스트도 실제 연결 대상이 확인된 개발 DB/샌드박스 결제만 사용한다. 불명확하면 외부 쓰기를 중단하고 로컬 검증을 수행한다.
- 비밀값을 문서·Git·로그·채팅에 기록하지 않는다. 운영 환경변수를 자동 복사하거나 다운로드하지 않는다.
- 종료 보고: 실제 repo/worktree 경로, branch, 기준 및 결과 commit, 미커밋 변경, PR(없으면 없음), 테스트 결과/미수행 사유, deployment(미실행/검증 여부), 남은 게이트와 사용자 필요 조치를 명확히 구분한다. 보고는 한국어로 한다.
- 이 지침은 실행 규칙이며 서버 측 브랜치 보호나 기술적 배포 차단을 설치한 것은 아니다.

### 프로젝트 식별

- 제품: BrandyAction OS
- 기존 Development completion records 지침을 유지한다. 이번 설정에서는 사용자 요청에 따라 운영 DB/API에 기록을 쓰지 않고 로컬 완료 기록을 남긴다. OS 운영 기록 반영은 보류 상태로 보고한다.
