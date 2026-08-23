# BrandyAction OS 처음 시작하기

이 문서는 개발 문서가 아니라 실제 사용 순서만 설명한다.

## 먼저 이해할 네 가지

1. **GitHub OS 저장소**는 회사의 최신 상태와 업무 결과를 보관하는 정본이다.
2. **`ba pull`**은 내가 지금 해야 할 업무 자료만 내 컴퓨터로 가져온다.
3. **`.workspace/`**는 Claude Code, Codex, Obsidian 등으로 실제 작업하는 임시 공간이다.
4. **`ba push`**는 검증된 결과를 회사 정본에 새 버전으로 반영한다.

```text
GitHub 최신화 → 업무 Pull → 내 컴퓨터에서 작업 → 결과 Push → 다음 담당자
```

## 1. 처음 한 번만 설치

터미널을 열고 아래 명령을 순서대로 실행한다.

```bash
git clone https://github.com/brandyaction-ricky/OS.git
cd OS
./setup.sh ricky
```

`ricky` 부분은 본인의 OS 작업자 이름으로 바꾼다.

설치가 끝나면 아래 두 명령으로 상태를 확인한다.

```bash
source .venv/bin/activate
ba doctor
```

모든 항목이 `정상`이면 사용할 준비가 끝난 것이다.

## 2. 업무를 시작할 때

항상 최신 파일부터 받는다.

```bash
ba sync
ba status
```

특정 콘텐츠의 다음 행동을 확인한다.

```bash
ba guide BA-0268
```

`BA-0268`은 콘텐츠마다 부여되는 업무 번호다.

## 3. 내 컴퓨터로 업무 가져오기

```bash
ba pull BA-0268
ba guide BA-0268
```

그러면 아래 폴더가 생긴다.

```text
.workspace/BA-0268/
├─ CONTEXT.md       현재 콘텐츠의 상태와 맥락
├─ SKILL.md         이 단계의 작업 방법
├─ input/           작업에 필요한 이전 결과물
└─ output/          내가 수정해야 할 결과물
```

직접 수정하는 곳은 원칙적으로 `output/`이다. `05_contents/`의 정본 파일은 직접 덮어쓰지 않는다.

## 4. Claude Code나 Codex에서 작업

AI 도구에 다음처럼 요청한다.

```text
현재 저장소의 .workspace/BA-0268/CONTEXT.md와 SKILL.md,
input 폴더의 자료를 읽고 SKILL.md의 OUTPUT CONTRACT에 맞춰
output 폴더의 Markdown 결과물을 완성해줘.
정본인 05_contents 폴더는 직접 수정하지 마.
```

실제 영상·이미지·음원은 Premiere, Flow 등 기존 도구에서 만든다. Markdown에는 결과 파일의 저장 위치, `asset_id`, `checksum` 등을 기록한다.

## 5. 작업 결과 반영

먼저 현재 단계와 수정할 파일을 확인한다.

```bash
ba guide BA-0268
```

검수 요청 단계라면 output Markdown의 Frontmatter를 다음처럼 바꾼다.

```yaml
status: waiting_approval
approval_status: pending
```

승인까지 끝난 결과라면 다음처럼 기록한다.

```yaml
status: approved
approval_status: approved
```

촬영·게시·성과 회수처럼 완료 상태를 쓰는 단계는 Process 규격에 따라 `completed`를 사용한다.

검사하고 Push한다.

```bash
ba validate
ba push BA-0268
```

Push가 성공하면 Git commit과 GitHub 반영까지 자동으로 진행된다.

## 6. 새 롱폼 콘텐츠 만들기

권한이 있는 운영자가 실행한다.

```bash
ba new content --type longform --title "실제 콘텐츠 제목"
```

생성된 번호를 확인한 뒤 다음처럼 시작한다.

```bash
ba status BA-0269
ba guide BA-0269
ba pull BA-0269
```

## 매일 기억할 명령 다섯 개

```bash
ba sync                  # 회사 최신 상태 받기
ba status                # 전체 업무 보기
ba guide BA-0268         # 지금 할 일 확인
ba pull BA-0268          # 내 작업 공간 만들기
ba push BA-0268          # 결과를 회사 정본에 반영
```

문제가 생기면 먼저 실행한다.

```bash
ba doctor
```

오류 메시지는 자동 덮어쓰기 대신 작업을 중단시키는 안전장치다. 현재 output 파일을 삭제하지 말고 오류 내용을 담당자에게 전달한다.
