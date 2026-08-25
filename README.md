# BrandyAction OS

BrandyAction OS의 Git + Markdown 기반 Source of Truth와 로컬 실행 환경을 연결하는 첫 번째 실제 저장소다.

처음 사용하는 사람은 **[`START_HERE.md`](START_HERE.md)**부터 읽는다.

## 핵심 구조

- **OS Repository**: 회사 맥락, 상태, 결재, 버전의 정본
- **Company Wiki**: 회사 공정과 AI가 참고하는 최신 공유 정본
- **OS Access Skill**: 현재 업무에 필요한 Wiki와 데이터를 불러오는 Context Loader
- **Automation Recipe**: 불러온 Context로 API·Worker·사람 확인을 실행하는 공정 레이어
- **Personal Obsidian**: 개인 Raw, 개인 Wiki와 AI 작업 맥락
- **Local Workspace**: Claude Code, Codex, ChatGPT, Obsidian, Premiere 등 실제 실행 환경
- **BA CLI**: Pull → Work → Validate → Push 동기화 계층

`CONTENT.md`는 현재 상태와 최신 산출물 포인터를 갖는 가변 인덱스다. 실제 산출물은 `*_vN.md`로 누적하며 본문을 덮어쓰지 않는다. 새 버전 생성 시 이전 버전에 허용되는 유일한 변경은 `is_latest: true`를 `false`로 전환하는 것이다.

## 요구 환경

- Python 3.11 이상
- Git 2.x

## 설치

가장 간단한 설치 방법:

```bash
./setup.sh ricky
source .venv/bin/activate
ba guide
```

`ricky`는 각자의 작업자 이름으로 바꾼다.

수동 설치가 필요한 경우:

```bash
python3 -m venv .venv
source .venv/bin/activate
python3 -m pip install -e .
```

설치하지 않고 저장소 안에서 바로 실행할 수도 있다.

```bash
./bin/ba status
```

작업자 식별자는 `--by`, `BA_USER`, Git 사용자명 순으로 결정한다.

```bash
export BA_USER=ricky
```

## 기본 사용법

```bash
ba status
ba setup --user ricky
ba doctor
ba sync
ba guide
ba guide BA-0268
ba status BA-0268
ba pull BA-0268
ba skill BA-0268 brandyaction-video-ppt
ba push BA-0268 --step edit
ba validate
ba new content --type longform --title "새 콘텐츠"
```

`ba pull`은 `.workspace/CONTENT_ID/`에 현재 Context, 필요한 Input, Skill, 다음 버전 Output 초안을 만든다. AI 또는 사람이 `output/`의 Markdown을 작업한 뒤 Frontmatter의 상태와 승인값을 갱신하고 `ba push`한다.

## Push 안전장치

Push는 다음 순서로 실패 우선 검증한다.

1. Pull 당시 저장소 스냅샷과 현재 상태 비교
2. Git upstream이 있으면 원격 최신 상태 확인
3. Frontmatter Schema 검사
4. 필수 Output과 `content_id` 검사
5. 버전 번호와 파일명 검사
6. 최신 포인터, 상태, 담당자 갱신
7. Completion Condition 평가와 다음 Step 전환
8. Git commit 및 upstream이 있으면 push

원격 또는 저장소가 Pull 이후 바뀌면 자동 병합하지 않고 중단한다. 네트워크 없이 로컬 Git에만 기록할 때는 `--offline`을 사용한다.

## Longform Pilot

기획 → 축 → 설계/원고 → 촬영 → 편집 → 썸네일 → 최종 승인 → 게시 → 성과 회수

공정의 기계 판독 규격과 사람이 읽는 설명은 [`03_processes/longform/PROCESS.md`](03_processes/longform/PROCESS.md) 한 파일에서 관리한다.
후반작업부터 성과 학습까지의 실행 상세는 `YOUTUBE_PIPELINE.json`과 Automation Recipe가 담당한다. 사용자 화면은 PDF 원본 8공정을 각각 독립 실행 Stage로 포함한 총 20개 Stage를 표시하며, 상위 구분은 탐색용으로만 사용한다. 썸네일은 `아이디어 → AI 생성 → AI 평가 → 사람 승인 → 업로드 → CTR 측정 → 학습` 폐쇄 루프로 관리한다.

## Web UI

Vercel 배포 시 Node 빌드 스크립트가 Repository의 Process, Content, Skill Markdown을 읽어 `web/data/os-index.json`을 생성한다. 웹 UI는 이 인덱스로 다음 화면을 제공한다.

- 전체 업무 공정
- 내가 할 일
- 콘텐츠 Run
- 회의 노트
- 유튜브 제작
- 멀티채널 확장
- 직원 워크스페이스
- Company Wiki
- OS Access Skills

웹 UI의 Content 상세 화면에서 `작업 시작 → 작업 제출`을 수행할 수 있다. 작업 시작은 현재 Context와 Skill을 `WORK_PACKAGE.md`로 내려받고, 제출은 결과 요약·외부 자산 링크·선택 Markdown을 검증해 Git Commit으로 반영한다. 판단이 필요한 YouTube 설정은 별도 결재함이 아니라 해당 제작 Stage 안에서 바로 확인한다.

회의 노트 화면에서는 노션형 Markdown 편집, 브라우저 마이크 녹음, 구간별 전사, AI 회의록 정리와 `06_meetings/inbox → organized → decisions` 이동을 수행한다. 녹음 원본은 Git에 저장하지 않는다. 전사와 요약에는 Vercel의 `OPENAI_API_KEY`, Markdown 저장에는 기존 GitHub 연결과 OS 작업 코드를 사용한다.

각 직원의 Raw와 개인 전용 Wiki는 개인 Obsidian에 둔다. 회사 OS의 직원 Workspace에는 담당 공정, 현재 업무, 공유 Wiki와 Access Skill 연결만 저장한다. 회사에 공유하기로 선택한 Wiki는 `company`, `process`, `people` 영역의 최신 정본으로 관리한다.

Access Skill Markdown의 정본은 GitHub Repository다. Skill은 업무 결과물을 직접 만들지 않고 최신 Company Wiki, Content Run과 입력 포인터를 찾아 Context Bundle로 반환한다. 실제 실행과 판단은 각자의 AI와 사람이 담당한다.

유튜브 제작 화면은 PDF의 자막·덱·사진·렌더·캡처카드·미디어·XML·업로드 자산 8공정을 왼쪽 전체 실행공정의 독립 단계로 표시한다. 단계별 화면에서 개인 PC 자동화 실행값 또는 사람 판단을 기록하고, OS 서버는 유튜브 자산 초안, 최종 MP4·SRT 인계 이후 완료본 검증, 썸네일 AI 생성·평가, 숏폼 구간·게시 문안 생성, FFmpeg Worker 숏폼 렌더, YouTube API 게시, CTR 회수와 학습을 담당한다. 대용량 파일은 Object Storage로 직접 전송하고 Git에는 Asset ID만 기록한다.

멀티채널 확장은 완료본 검증과 유튜브 자산 확정 후 별도 Run으로 시작한다. Content DNA와 원본 타임코드가 연결된 Atom을 공통 정본으로 만든 뒤, 숏츠 3개를 YouTube Shorts·Instagram Reels에 동시 발행하고 카드뉴스 1개·Threads 3개를 병렬 생성한다. 사람은 각 채널 Stage의 미리보기에서 개별 제외·수정·예약을 확정하며, 성과는 Atom·훅 단위로 다음 Run에 학습한다.

Skill Library는 `04_skills/{category_id}/{folder_id}/{skill_id}` 구조로 관리한다. Process는 폴더 경로가 아니라 고유한 `skill_id`를 참조하므로 카테고리를 옮겨도 기존 공정 연결이 유지된다. 카테고리 목록과 표시 순서는 `04_skills/CATEGORIES.json`에서 관리한다.

```bash
npm run build
python3 -m http.server 8080 --directory web
```

## 테스트

```bash
python3 -m unittest discover -s tests -v
```

`main` Push와 Pull Request에서도 GitHub Actions가 동일한 Validator와 테스트를 자동 실행한다.

## 운영 문서

- [처음 시작하기](START_HERE.md)
- [Longform Pilot 운영 가이드](docs/TEAM_PILOT_GUIDE.md)
- [자주 생기는 문제](docs/TROUBLESHOOTING.md)

## 현재 MVP 경계

- Markdown과 Git이 정본이며 DB는 아직 인덱스로 사용하지 않는다.
- 대용량 미디어와 서명 URL은 저장하지 않고 산출물 Markdown에 불투명 `asset_id`, `asset://` 참조, `checksum`만 기록한다.
- 회사 회의록은 공개 OS Repository에 저장하지 않는다. 별도 비공개 `MEETING_REPOSITORY`와 저장소 전용 `MEETING_GITHUB_TOKEN`이 연결되기 전에는 목록·저장이 차단된다.
- Headless Chrome·FFmpeg·Premiere·YouTube 대용량 업로드는 별도 Worker/Bridge 연결 전에는 시뮬레이션이 아니라 `연결 필요` 상태로 표시한다.
- 회의 녹음은 전사 처리 후 브라우저 세션에만 남고 Repository에는 회의록 Markdown만 저장한다.
- 브라우저 작업자 선택은 아직 실제 계정 로그인이 아니다. YouTube 게시에는 별도 `YOUTUBE_PUBLISH_APPROVAL_SECRET`과 서버 고정 승인자를 요구하지만, 전체 개인별 강제 권한은 전용 인증 도입 후 적용한다.
- 자동 ID는 현재 저장소에서 가장 큰 `BA-NNNN` 다음 번호를 사용한다. 여러 복제본에서 동시에 생성하는 중앙 ID 할당은 후속 단계다.
