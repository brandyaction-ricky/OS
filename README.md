# BrandyAction OS

BrandyAction OS의 Git + Markdown 기반 Source of Truth와 로컬 실행 환경을 연결하는 첫 번째 실제 저장소다.

처음 사용하는 사람은 **[`START_HERE.md`](START_HERE.md)**부터 읽는다.

## 핵심 구조

- **OS Repository**: 회사 맥락, 상태, 결재, 버전의 정본
- **Skill**: Context + Procedure + Output Contract + Quality Criteria
- **Local Workspace**: Claude Code, Codex, Obsidian, Premiere 등 실제 실행 환경
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
- 대용량 미디어는 저장하지 않고 산출물 Markdown에 `asset_id`, `path`, `checksum`을 기록한다.
- Soft Lock 명령과 서버 Worker, 웹 UI는 후속 단계다.
- 자동 ID는 현재 저장소에서 가장 큰 `BA-NNNN` 다음 번호를 사용한다. 여러 복제본에서 동시에 생성하는 중앙 ID 할당은 후속 단계다.
