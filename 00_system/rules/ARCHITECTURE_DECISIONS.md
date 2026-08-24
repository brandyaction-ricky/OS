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

Pilot 확인 결과 팀원이 Terminal에서 BA CLI를 직접 사용하는 방식은 운영 마찰이 크다. Content 상세 화면에 `작업 시작`, `작업 제출`을 제공한다. Web Pull은 현재 단계에 필요한 Markdown을 하나의 `WORK_PACKAGE.md`로 내려받는다. Web Push는 Vercel Server Function이 입력을 검증한 뒤 GitHub Git Data API로 artifact, `CONTENT.md`, 이전 최신본의 `is_latest`를 하나의 Commit으로 갱신한다. 대용량 자산은 Push하지 않고 Asset ID와 checksum만 기록한다. 별도 결재함 대신 사람 확인이 필요한 결정은 해당 공정 화면 안에 둔다. GitHub 토큰과 작업 코드는 Vercel 환경변수에만 두고, YouTube 화면에서는 코드를 반복 입력하지 않도록 HttpOnly 팀 세션을 사용한다.

## ADR-009 · Raw에서 Wiki로의 승격은 작성자가 직접 한다 — 폐기

초기에는 회사 OS에도 Raw를 저장하는 것으로 결정했으나 개인 메모와 회사 정본의 경계가 흐려지는 문제가 확인됐다. ADR-012가 이 결정을 대체한다.

## ADR-010 · Skill 파일 정본은 별도 서버가 아니라 Git Repository다

Skill의 Markdown, Template, Check는 용량이 작고 변경 이력·비교·복구가 중요하다. 초기에는 GitHub Repository를 정본으로 유지하고 Vercel은 최신본을 읽어 보여주고 내려받게 하는 Projection과 Gateway 역할만 한다. MP4, WAV, PNG 같은 대용량 자산은 Skill에 넣지 않고 Drive, NAS 또는 Object Storage에 저장한다. 동시 편집과 세밀한 권한이 Git 운영 한계를 넘을 때만 별도 DB·서비스를 검토한다.

## ADR-011 · Skill ID와 저장 폴더를 분리한다

Skill이 늘어나면 `04_skills/{skill_id}` 평면 구조는 탐색과 책임 구분이 어렵다. 실제 파일은 `04_skills/{category_id}/{folder_id}/{skill_id}`에 보관하고 분류 정본은 `CATEGORIES.json`으로 관리한다. Process는 위치가 바뀌어도 변하지 않는 `skill_id`만 참조하며 CLI와 웹 빌드는 `SKILL.md`를 재귀 탐색한다. 이 방식은 폴더 재분류가 기존 공정을 깨뜨리는 문제를 막는다.

## ADR-012 · 개인 Raw는 Obsidian에, 회사 OS에는 공유 Wiki만 둔다

Raw는 기억하고 싶은 인사이트를 빠르게 기록하는 개인 영역이다. 이를 회사 Repository에 저장하면 정리되지 않은 개인 맥락과 공정의 정본이 섞인다. 각 직원은 개인 Obsidian에서 Raw와 개인 Wiki를 관리하고, 회사 공정에서 재사용할 내용만 Company Wiki로 공유한다. 회사 OS의 `08_people`에는 개인 원문이 아니라 담당 업무와 공유 연결만 저장한다.

## ADR-013 · Skill은 실행 규격이 아니라 OS Context Loader다

업무 방법과 품질 기준을 Skill과 Wiki에 동시에 저장하면 어느 쪽이 최신 정본인지 모호해진다. 실무 지식과 판단 기준은 Process Wiki에 두고, Skill은 현재 Content Run에 필요한 최신 Wiki와 입력 포인터를 찾아 Context Bundle로 반환한다. 실제 결과물 생성과 판단은 각 직원의 AI와 사람이 담당한다.

## ADR-014 · 회사 회의록은 06_meetings에서 Markdown으로 관리한다

개인 Raw와 회사 회의 기록을 같은 공간에 두면 공유 범위와 정본 여부가 불명확해진다. 회의 중 메모와 녹음 전사 결과는 회사 공용 업무 기록이므로 `06_meetings`에 저장한다. 문서는 `inbox → organized → decisions`로 이동하며 검토·승인 단계는 두지 않는다. 녹음 원본은 Git에 넣지 않고 짧은 구간으로 전사한 뒤 전사문과 정리된 Markdown만 남긴다. 반복해서 사용할 의사결정이나 실무 기준만 작성자가 Company Wiki로 별도 승격한다.

## ADR-015 · Skill과 Automation Recipe를 분리한다

Skill은 OS에서 최신 Wiki·Content Run·자산 포인터를 불러오는 Context Loader다. API 호출, 장시간 렌더, 외부 업로드와 상태 전이를 Skill에 넣으면 정본 지식과 실행 로직이 다시 섞인다. 실제 실행은 `07_automations`의 Recipe가 담당하고, 공정 정의·프롬프트 버전·어댑터·사람 확인 지점·실패 처리 규칙을 기록한다.

## ADR-018 · 개인 PC 제작과 서버 배포 자동화 분리

자막·덱·이미지·Premiere 메인 편집처럼 개인 AI 토큰과 고사양 편집 도구를 많이 쓰는 공정은 직원 PC에서 수행한다. 회사 OS는 최신 Wiki와 작업 패키지를 제공하고 PDF의 8개 세부 공정 완료 상태를 기록한다. 실행 서버는 최종 마스터가 인계된 뒤 완료본 검증, 썸네일 생성·평가, 숏폼 생성, YouTube 업로드, 성과 회수와 학습을 담당한다. 대용량 파일은 브라우저에서 Object Storage로 직접 업로드하며 GitHub와 Vercel 함수에는 Asset ID와 manifest만 남긴다.

## ADR-016 · 대용량 영상 처리는 Vercel 밖에서 실행한다

Vercel Function은 공정 관제, 짧은 AI 요청, Git 상태 기록과 Worker 호출만 담당한다. Headless Chrome, FFmpeg, Premiere, 대용량 YouTube 업로드는 별도 Render Worker 또는 편집자 Mac Bridge에서 수행하고 callback으로 OS 상태를 갱신한다. MP4·WAV·PNG 묶음은 Git에 넣지 않고 Object Storage·Drive·NAS의 참조만 저장한다.

## ADR-017 · PDF 후반작업과 YouTube 게시 완료를 구분한다

브랜디액션 제작공정 PDF는 컷편집 MP4와 SRT를 받아 Premiere XML과 업로드 문안을 만드는 후반작업 공정이다. 최종 MP4 렌더·QA·제목·썸네일·실제 업로드·URL 기록은 문서에 없다. OS는 원문 8단계와 확장 게시 단계를 시각적으로 구분하고, XML 생성만으로 `YouTube 게시 완료`를 표시하지 않는다.

## ADR-019 · 원본 공정은 축약하지 않고 상위 구분은 탐색에만 사용한다

업무 화면을 다섯 개 결과 단계만으로 단순화하면 PDF의 실제 작업 순서·도구·산출물·절대 규칙이 보이지 않아 정본 역할을 잃는다. `YOUTUBE_PIPELINE.json`에 PDF 원본 8공정과 11개 절대 규칙을 구조화해 보존하고, 웹은 전체 실행 Stage를 항상 표시한다. 상위 구분은 공정을 대체하지 않는 탐색 폴더다.

## ADR-020 · 썸네일은 CTR 학습까지 닫힌 루프로 관리한다

썸네일 제작을 승인 시점에 끝내면 AI 평가와 실제 성과의 차이를 다음 제작에 재사용할 수 없다. `아이디어 → AI 생성 → AI 평가 → 사람 승인 → 업로드 → CTR 측정 → 학습`을 같은 Content Run에 기록한다. AI 총점은 사람 승인을 대체하지 않으며, 학습 결과는 다음 Content Run의 아이디어 생성 Context로 자동 포함한다.

## ADR-021 · PDF 8공정은 각각 독립 실행 Stage다

원본 8공정을 하나의 상세 체크리스트 안에 넣으면 개별 공정의 상태, 선행조건, 실행 결과와 사람 판단을 자동화 그래프가 추적할 수 없다. 자막 검수·요약 덱·사진 프롬프트·렌더와 사진 삽입·캡처카드·미디어 처리·XML 조립·유튜브 자산을 전체 실행공정의 독립 Stage로 관리한다. 각 Stage는 현재 공정에 필요한 UI만 표시하며, `PDF 원본 실행공정` 같은 상위 구분은 탐색 폴더로만 사용한다. 기존 통합 `pc_main_edit` 완료 이력은 배포 시 8개 독립 Stage 완료 이력으로 변환해 진행률을 보존한다.
