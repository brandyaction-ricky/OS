# Architecture Decisions v1.0

## ADR-001 · CONTENT.md는 가변 인덱스다

`CONTENT.md`가 현재 상태를 대표하면서 동시에 불변 버전 파일이면 두 역할이 충돌한다. `CONTENT.md`는 갱신 가능한 인덱스로 두고 `version`과 Git 이력으로 변경을 추적한다. 실제 산출물은 `*_vN.md`로 누적한다.

## ADR-002 · Process 정본은 PROCESS.md Frontmatter다

사람용 표만으로는 CLI가 Input, Output, 완료 조건, 다음 Step을 안정적으로 판단할 수 없다. 별도 DB나 중복 YAML을 만들지 않고 `PROCESS.md` Frontmatter에 기계 판독 정의를 넣는다. 본문 표는 설명용이다.

## ADR-003 · 확정된 Status 목록만 사용한다

`editing`, `not_started`처럼 별도 표현을 추가하면 Validator와 웹 UI가 서로 다른 상태를 해석한다. 진행 중은 `in_progress`, 시작 전은 `locked`, 시작 가능은 `ready`로 정규화한다.

## ADR-004 · is_latest 변경은 제한된 예외다

새 버전이 생겼는데 이전 파일의 `is_latest`를 유지하면 최신본이 여러 개가 된다. 이전 산출물에서 허용되는 유일한 수정은 `is_latest: true → false`다. 최신본 판단은 `CONTENT.md` 포인터가 우선한다.

## ADR-005 · Workspace Snapshot으로 충돌을 막는다

`ba pull`이 관련 파일의 SHA-256과 Git upstream commit을 `workspace.json`에 기록한다. `ba push`는 같은 범위가 바뀌었으면 자동 merge하지 않고 중단한다.

## ADR-006 · 분산 ID 할당은 MVP 밖이다

MVP의 `ba new content`는 저장소 내 최대 `BA-NNNN` 다음 번호를 사용한다. 여러 복제본에서 동시에 ID를 발급하는 시점에는 중앙 allocator 또는 충돌 없는 ID 체계가 필요하다.

## ADR-007 · Web UI는 Repository의 읽기 전용 Projection으로 시작한다

Vercel Build가 Process, Content, Skill Markdown을 읽어 정적 JSON 인덱스를 생성하고 웹은 이를 조회한다. 초기부터 별도 DB를 정본처럼 운영하면 Git/Markdown과 상태가 이중화되기 때문이다. 웹에서 상태를 직접 수정하거나 승인하지 않으며, 변경은 BA CLI를 통해서만 정본에 반영한다. Pilot에서 필요성이 검증되면 서버 API가 Git commit을 생성하는 방식으로 확장한다.

## ADR-008 · Web Pull/Push Gateway를 추가한다

Pilot 확인 결과 팀원이 Terminal에서 BA CLI를 직접 사용하는 방식은 운영 마찰이 크다. Content 상세 화면에 `작업 시작`, `작업 제출`, `승인 요청`을 제공한다. Web Pull은 현재 단계에 필요한 Markdown을 하나의 `WORK_PACKAGE.md`로 내려받는다. Web Push는 Vercel Server Function이 입력을 검증한 뒤 GitHub Git Data API로 artifact, `CONTENT.md`, 이전 최신본의 `is_latest`를 하나의 Commit으로 갱신한다. 대용량 자산은 Push하지 않고 외부 asset URL, asset ID, checksum만 기록한다. GitHub 토큰과 작업 코드는 Vercel 환경변수에만 둔다.
